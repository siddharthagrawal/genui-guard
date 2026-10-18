/**
 * The README quickstart, kept compiling so the copy-paste path cannot rot. If
 * you are reading this to check the README, these two files are the same code.
 *
 * The `declare const` lines stand for what your application already has: the
 * turn's identifier, the session, the user's stated budget, the tool result you
 * loaded, and the stream of interface events coming back from the model.
 */
import { createGuard, policies as p, type GuardEvent } from "@genui-guard/core";
import { fromJsonRender } from "@genui-guard/json-render";
import { catalog } from "./catalog"; // your existing json-render catalog

declare const turnId: string;
declare const session: { role: string };
declare const budget: number;
declare const fares: { fareId: string; price: number; seatsLeft: number }[];
declare const specStream: ReadableStream<GuardEvent>;

export const guard = createGuard({
  registry: fromJsonRender(catalog, {
    FlightCard: {
      entity: "fares", // backed by searchFlights results
      key: "fareId", // identifies one record, and ties every bound prop to the same one
      bound: ["airline", "price", "stops"], // must reference verified fare data
    },
  }),
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
});

// Any transport, whether SSE, the AI SDK, AG-UI or WebSockets.
export const safe = specStream.pipeThrough(guard.stream({ turnId, session, budget }));
