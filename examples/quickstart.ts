/**
 * The README quickstart, kept compiling so the copy-paste path cannot rot. If
 * you are reading this to check the README, these two files are the same code.
 *
 * The `declare const` lines stand for what your application already has: the
 * turn's identifier, the session, the user's stated budget, the tool result you
 * loaded, and whatever the model gave you back.
 */
import { createGuard, policies as p, type GuardEvent } from "@genui-guard/core";
import {
  fromJsonRender,
  guardEvents,
  guardSpec,
  patchesToEvents,
  type JsonRenderSpec,
} from "@genui-guard/json-render";
import { catalog } from "./catalog"; // your existing json-render catalog

declare const turnId: string;
declare const session: { role: string };
declare const budget: number;
declare const fares: { fareId: string; price: number; seatsLeft: number }[];

export const guard = createGuard({
  registry: fromJsonRender(catalog, {
    FlightCard: {
      entity: "fares", // backed by searchFlights results
      key: "fareId", // identifies one record, and ties every bound prop to the same one
      bound: ["airline", "price", "stops"], // must reference verified fare data
    },
    HotelCard: {
      entity: "hotels",
      key: "hotelId",
      bound: ["name", "nightly"],
      // Accessibility is registry-level rather than a policy, because what
      // needs alt text is a fact about the component, not about this turn.
      a11y: { requireAlt: ["imageAlt"] },
    },
  }),
  // How old this app lets its fare data get before a card is flagged for it.
  // Needs `at` on the tool result and `now` on the context, both below: core
  // reads no clock of its own.
  staleAfterMs: 5 * 60_000,

  policies: [
    p.requireBinding(), // on by default
    p.dropUnsourcedClaims({
      topics: ["free cancellation", "refundable", "bag included"],
      supportedBy: ["fareRules"], // nested objects that can support a claim
    }),
    p.excludeWhere("fares", (fare) => fare.seatsLeft === 0),
    p.annotateWhere(
      "fares",
      (fare, ctx) => Number(fare.price) > Number(ctx.budget ?? Infinity),
      "Over your stated budget",
    ),
    p.requireRole(["RefundOverride"], "support_agent"),
    p.confirmActions(["book"]),
    p.safeUrls({ imageHosts: ["img.travel-demo.test"] }),
    p.restrictInputs({ allow: ["PaymentForm"] }),
    p.maskFields(["loyaltyId"]), // all but the last four characters
  ],
});

// Source of truth for this turn. `entity` reserves the state namespace the
// guard owns, and `key` is required for an array so records are addressed by
// identity rather than by position.
guard.recordToolResult({
  turnId,
  toolName: "searchFlights",
  entity: "fares",
  key: "fareId",
  data: fares,
  // Optional. Only read when the config sets staleAfterMs and the context
  // carries `now`, because core never reads a clock of its own.
  at: Date.now(),
});

const ctx = { turnId, session, budget, now: Date.now() };

// ---------------------------------------------------------------------------
// Then one of three, depending on what the model handed you.
// ---------------------------------------------------------------------------

/** 1. A finished spec, which is what most hosts have. */
declare const modelSpec: JsonRenderSpec;

export async function guardAFinishedSpec() {
  // `spec` is safe to render. `dropped` is the ids that were withheld, and
  // `traces` is every decision including the allows.
  const { spec, dropped, annotations, traces } = await guardSpec(guard, modelSpec, ctx);
  return { spec, dropped, traces };
}

/** 2. json-render's JSONL patches, which is what a live model streams. */
declare const jsonl: string;

export async function guardStreamedPatches() {
  return guardEvents(guard, patchesToEvents(jsonl), ctx);
}

/**
 * 3. Your own transport. This is the lowest level and the only one that is
 * renderer-agnostic: a stream of already-classified guard events in, a safe
 * stream out. Deleting this one line is how you remove genui-guard.
 */
declare const specStream: ReadableStream<GuardEvent>;

export const safe = specStream.pipeThrough(guard.stream(ctx));

/**
 * When the turn is finished and its traces have been read. Turns are also
 * evicted oldest-first past `maxTurns`, so forgetting this leaks nothing
 * unbounded, but a long-lived guard is tidier with it.
 */
export function finished() {
  guard.endTurn(turnId);
}
