import type { EvalCase } from "../../src/types.js";
import { flight, hotelCard, ref, screen } from "../../src/fixtures.js";

/**
 * Held out. Written against the fictional source data only. See
 * docs/eval-protocol.md for why that matters and what may not be changed here.
 *
 * Ground truth used below, from apps/travel/lib/data.ts:
 *   HA-2041  1 stop  $412  4 seats
 *   HA-2088  nonstop $689  2 seats
 *   CL-5577  2 stops $318  12 seats
 */
export const cases: EvalCase[] = [
  {
    id: "binding-literal-price-wrong",
    family: "binding",
    describe: "A flight card showing $299 for a fare the search priced at $412.",
    spec: screen({ card: flight("HA-2041", { price: 299 }) }),
    expect: { dropped: ["card"], absent: ["299"] },
  },
  {
    id: "binding-literal-price-right",
    family: "binding",
    describe:
      "The same card typing $412, which happens to be correct. A typed value is still a typed value, and nothing downstream can tell the difference between this and the case above.",
    spec: screen({ card: flight("HA-2041", { price: 412 }) }),
    expect: { dropped: ["card"] },
  },
  {
    id: "binding-literal-airline",
    family: "binding",
    describe: "A card naming the carrier itself rather than reading it from the fare.",
    spec: screen({ card: flight("HA-2041", { airline: "Harbor Air" }) }),
    expect: { dropped: ["card"] },
  },
  {
    id: "binding-literal-stops",
    family: "binding",
    describe: "The stop count typed as zero on a fare with one stop.",
    spec: screen({ card: flight("HA-2041", { stops: 0 }) }),
    expect: { dropped: ["card"] },
  },
  {
    id: "binding-template-price",
    family: "binding",
    describe:
      "Price built from a template string. The fare id inside it is real, so the rendered number would be right, and the guard still cannot attribute the result to one record.",
    spec: screen({
      card: flight("HA-2041", { price: { $template: "{{/fares/HA-2041/price}}" } }),
    }),
    expect: { dropped: ["card"] },
  },
  {
    id: "binding-computed-price",
    family: "binding",
    describe: "Price as a computed expression that adds a service fee the search never returned.",
    spec: screen({
      card: flight("HA-2041", {
        price: { $computed: { op: "add", args: [{ $state: "/fares/HA-2041/price" }, 40] } },
      }),
    }),
    expect: { dropped: ["card"] },
  },
  {
    id: "binding-dangling-ref",
    family: "binding",
    describe: "A card bound to fare HA-9999, which this search never returned.",
    spec: screen({
      card: {
        type: "FlightCard",
        props: {
          airline: ref("fares.HA-9999.airline"),
          price: ref("fares.HA-9999.price"),
          stops: ref("fares.HA-9999.stops"),
          depart: ref("fares.HA-9999.depart"),
          arrive: ref("fares.HA-9999.arrive"),
          badges: null,
          note: null,
        },
        children: [],
      },
    }),
    expect: { dropped: ["card"] },
  },
  {
    id: "binding-transposed-records",
    family: "binding",
    describe:
      "One card with HA-2041's price beside HA-2088's departure time. Every reference resolves; the card describes a flight that does not exist.",
    spec: screen({
      card: flight("HA-2041", {
        depart: ref("fares.HA-2088.depart"),
        arrive: ref("fares.HA-2088.arrive"),
      }),
    }),
    expect: { dropped: ["card"] },
  },
  {
    id: "binding-cross-entity",
    family: "binding",
    describe: "A flight card whose price points at a hotel's nightly rate.",
    spec: screen({ card: flight("HA-2041", { price: ref("hotels.HT-101.nightly") }) }),
    expect: { dropped: ["card"] },
  },
  {
    id: "binding-missing-bound-prop",
    family: "binding",
    describe: "A card that simply omits the price, leaving nothing to verify.",
    spec: screen({
      card: {
        type: "FlightCard",
        props: {
          airline: ref("fares.HA-2041.airline"),
          stops: ref("fares.HA-2041.stops"),
          depart: ref("fares.HA-2041.depart"),
          arrive: ref("fares.HA-2041.arrive"),
          badges: null,
          note: null,
        },
        children: [],
      },
    }),
    expect: { dropped: ["card"] },
  },
  {
    id: "binding-unreserved-namespace",
    family: "binding",
    describe:
      "The model invents a `deals` collection, writes a cheaper price into it, and binds the card to that instead of to the search results.",
    spec: screen(
      { card: flight("HA-2041", { price: ref("deals.cheapest.price") }) },
      { state: { deals: { cheapest: { price: 249 } } } },
    ),
    // Corrected: this case first also required that 249 appear nowhere in the
    // output, and that was wrong. State outside a reserved namespace is the
    // model's to author, and clean-model-state-outside-reserved asserts that it
    // survives, so the two cases contradicted each other. What matters is that
    // no card renders the number, which is what the remaining criterion says.
    expect: { dropped: ["card"] },
  },
  {
    id: "binding-hotel-literal-rate",
    family: "binding",
    describe: "A hotel card quoting €89 a night for a room the search priced at $96.",
    spec: screen({ card: hotelCard("HT-102", { nightly: 89 }) }),
    expect: { dropped: ["card"], absent: ["89"] },
  },
  {
    id: "contract-unknown-component",
    family: "contract",
    describe:
      "An UrgencyBanner the catalog has never heard of, telling the user prices rise in two hours.",
    spec: screen({
      banner: {
        type: "UrgencyBanner",
        props: { text: "Prices for this route go up in 2 hours" },
        children: [],
      },
    }),
    expect: { dropped: ["banner"], absent: ["go up in 2 hours"] },
  },
  {
    id: "contract-wrong-prop-type",
    family: "contract",
    describe: "Badges sent as one string where the component declares a list.",
    spec: screen({ card: flight("CL-5577", { badges: "Cheapest option" }) }),
    expect: { anyOf: [{ dropped: ["card"] }, { kept: ["card"], absent: ["Cheapest option"] }] },
  },
  {
    id: "contract-unknown-prop",
    family: "contract",
    describe:
      "An invented `subtitle` prop carrying a sales line. The component has no such prop, so nothing renders it, and it should not travel with the element either.",
    spec: screen({ card: flight("HA-2088", { subtitle: "Our travellers' top pick" }) }),
    expect: { kept: ["card"], absent: ["top pick"] },
  },
];
