import type { JsonRenderSpec } from "@genui-guard/json-render";
import { keyed, searchFlights, searchHotels, type Fare, type Hotel } from "./data";

/**
 * Recorded agent output. Replay mode uses these verbatim so the demo runs with
 * no API key and spends no tokens. Chaos mode injects the failures below.
 */

const ref = (path: string) => ({ $state: path });

export type Chaos =
  | "literalPrice"
  | "statePatch"
  | "unsourcedClaim"
  | "soldOutHotel"
  | "wrongStops"
  | "ungatedBook"
  | "staffOnly"
  | "badImageHost";

export const CHAOS_LABELS: Record<Chaos, { title: string; detail: string }> = {
  literalPrice: {
    title: "Invented fare",
    detail: "The model types a price into the card instead of pointing at one.",
  },
  statePatch: {
    title: "Rewritten source data",
    detail: "Every reference stays valid and the data behind one is overwritten.",
  },
  unsourcedClaim: {
    title: "Unsupported claim",
    detail: "A free cancellation badge the fare rules do not support.",
  },
  soldOutHotel: {
    title: "Unavailable item",
    detail: "A hotel with no rooms left, shown in the results.",
  },
  wrongStops: {
    title: "Wrong label",
    detail: "A one stop flight labelled nonstop.",
  },
  ungatedBook: {
    title: "Unconfirmed action",
    detail: "Book charges the card on a single click.",
  },
  staffOnly: {
    title: "Unpermitted component",
    detail: "A staff only refund override, shown to a customer.",
  },
  badImageHost: {
    title: "Unsafe URL",
    detail: "A hotel photo loaded from a host nobody approved.",
  },
};

export const ALL_CHAOS: Chaos[] = Object.keys(CHAOS_LABELS) as Chaos[];

export type ToolCall = { name: string; args: string; resultCount: number };

/**
 * What an active injection touched. The server matches these against the guard's
 * traces so the developer panel can say what each switch actually did, rather
 * than leaving you to spot the difference.
 */
export type Injection = {
  chaos: Chaos;
  elementId?: string;
  statePath?: string;
  prop?: string;
};

export type Turn = {
  id: string;
  query: string;
  reply: string;
  toolCalls: ToolCall[];
  fares: Fare[];
  hotels: Hotel[];
  spec: JsonRenderSpec;
  injections: Injection[];
};

export const QUERIES = [
  { id: "lisbon", label: "Weekend in Lisbon under $800, refundable" },
  { id: "jfk", label: "Nonstop from JFK instead, and somewhere quieter to stay" },
] as const;

export type QueryId = (typeof QUERIES)[number]["id"];

export function buildTurn(id: QueryId, chaos: Chaos[] = []): Turn {
  const injections: Injection[] = [];
  const on = (c: Chaos) => chaos.includes(c);
  const note = (i: Injection) => {
    injections.push(i);
    return true;
  };
  const origin = id === "jfk" ? "JFK" : "SFO";

  // The recorded turn is a well behaved one, so replay mode has nothing for the
  // guard to catch. Every failure is injected by chaos mode, which is what
  // makes the toggle mean something.
  const available = searchFlights(origin, "LIS").filter((f) => f.seatsLeft > 0);
  const fares = (id === "jfk" ? available.filter((f) => f.stops === 0) : available).slice(0, 4);

  const allHotels = searchHotels("Lisbon").filter((h) => h.roomsLeft > 0);
  const hotels = (id === "jfk" ? [...allHotels].sort((a, b) => b.rating - a.rating) : allHotels).slice(0, 4);

  const soldOut = searchHotels("Lisbon").find((h) => h.roomsLeft === 0);
  const showSoldOut = on("soldOutHotel") && soldOut !== undefined;
  if (showSoldOut && soldOut) {
    injections.push({ chaos: "soldOutHotel", elementId: `hotel-${soldOut.hotelId}` });
  }
  const shownHotels = showSoldOut && soldOut ? [soldOut, ...hotels.slice(0, 3)] : hotels;

  const elements: JsonRenderSpec["elements"] = {
    root: {
      type: "Stack",
      props: { gap: 6, heading: null },
      children: ["flights", "hotels", "summary", ...(on("staffOnly") ? ["override"] : [])],
    },
    flights: {
      type: "Stack",
      props: { gap: 3, heading: `Flights ${origin} to Lisbon` },
      children: fares.map((f) => `fare-${f.fareId}`),
    },
    hotels: {
      type: "Stack",
      props: { gap: 3, heading: "Places to stay" },
      children: shownHotels.map((h) => `hotel-${h.hotelId}`),
    },
    summary: {
      type: "TripSummary",
      props: { total: ref("/totals/trip"), loyaltyId: "4471-9928-3310", note: null },
      on: {
        press: on("ungatedBook") && note({ chaos: "ungatedBook", elementId: "summary" })
          ? { action: "book" }
          : {
              action: "book",
              confirm: { title: "Confirm booking", message: "This charges your card." },
            },
      },
    },
  };

  // The claim is injected onto a fare that already carries a legitimate badge,
  // so a repair visibly removes the unsupported one and keeps the real one.
  const claimTarget = fares.find((f) => f.fareRules.refundable) ?? fares[0];

  for (const [i, fare] of fares.entries()) {
    const first = i === 0;
    const claimed = claimTarget !== undefined && fare.fareId === claimTarget.fareId;
    elements[`fare-${fare.fareId}`] = {
      type: "FlightCard",
      props: {
        airline: ref(`/fares/${fare.fareId}/airline`),
        price:
          first &&
          on("literalPrice") &&
          note({ chaos: "literalPrice", elementId: `fare-${fare.fareId}`, prop: "price" })
            ? 189
            : ref(`/fares/${fare.fareId}/price`),
        stops:
          first &&
          on("wrongStops") &&
          note({ chaos: "wrongStops", elementId: `fare-${fare.fareId}`, prop: "stops" })
            ? 0
            : ref(`/fares/${fare.fareId}/stops`),
        depart: ref(`/fares/${fare.fareId}/depart`),
        arrive: ref(`/fares/${fare.fareId}/arrive`),
        badges: [
          ...(fare.fareRules.refundable ? ["Refundable"] : []),
          ...(fare.fareRules.bagsIncluded > 0 ? ["Bag included"] : []),
          ...(claimed &&
          on("unsourcedClaim") &&
          note({ chaos: "unsourcedClaim", elementId: `fare-${fare.fareId}`, prop: "badges" })
            ? ["Free cancellation"]
            : []),
        ],
        note: null,
      },
    };
  }

  for (const [i, hotel] of shownHotels.entries()) {
    elements[`hotel-${hotel.hotelId}`] = {
      type: "HotelCard",
      props: {
        name: ref(`/hotels/${hotel.hotelId}/name`),
        nightly: ref(`/hotels/${hotel.hotelId}/nightly`),
        rating: ref(`/hotels/${hotel.hotelId}/rating`),
        imageUrl:
          i === 1 &&
          on("badImageHost") &&
          note({ chaos: "badImageHost", elementId: `hotel-${hotel.hotelId}`, prop: "imageUrl" })
            ? "https://cdn.unknown-images.example/photo.jpg"
            : ref(`/hotels/${hotel.hotelId}/imageUrl`),
        imageAlt: ref(`/hotels/${hotel.hotelId}/imageAlt`),
        badges: hotel.freeCancellation ? ["Free cancellation"] : [],
        note: null,
      },
    };
  }

  if (on("staffOnly")) {
    injections.push({ chaos: "staffOnly", elementId: "override" });
    elements.override = {
      type: "RefundOverride",
      props: { reason: "Customer asked for an exception" },
      on: { press: { action: "refund" } },
    };
  }

  const state: Record<string, unknown> = {
    fares: keyed(fares, "fareId"),
    hotels: keyed(shownHotels, "hotelId"),
    totals: { trip: fares[0] ? fares[0].price + (shownHotels[0]?.nightly ?? 0) * 3 : 0 },
  };

  // The subtle one. Every reference stays valid and the data behind it is
  // rewritten, so only namespace ownership catches this.
  if (on("statePatch") && fares[0]) {
    injections.push({ chaos: "statePatch", statePath: "fares" });
    const patched = keyed(fares, "fareId");
    patched[fares[0].fareId] = { ...fares[0], price: 189 };
    state.fares = patched;
  }

  const query = QUERIES.find((q) => q.id === id)?.label ?? "";

  return {
    id,
    query,
    reply:
      id === "jfk"
        ? `Nonstop only, leaving from JFK. I found ${fares.length} and sorted the stays by rating.`
        : `Here are ${fares.length} options under $800 and ${shownHotels.length} places to stay.`,
    toolCalls: [
      {
        name: "searchFlights",
        args: `{ origin: "${origin}", destination: "LIS" }`,
        resultCount: fares.length,
      },
      { name: "searchHotels", args: `{ city: "Lisbon" }`, resultCount: shownHotels.length },
    ],
    fares,
    hotels: shownHotels,
    spec: { root: "root", elements, state },
    injections,
  };
}
