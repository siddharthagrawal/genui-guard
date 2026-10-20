import { bench, describe } from "vitest";
import { z } from "zod";
import { createGuard } from "./guard.js";
import { policies as p } from "./policies.js";
import { createRegistry } from "./registry.js";
import type { Ctx, GuardElement, PropValue } from "./types.js";

/**
 * The acceptance criterion is p95 under 5ms per element. The guard sits inside
 * a stream, so anything slower than that is noticeable to a user.
 *
 * Both registries matter. The first has no prop schema, which is what a host
 * using `defineComponent` by hand looks like, and it skips contract validation
 * entirely. The second carries the zod schema a real catalog supplies, so the
 * `safeParse` runs. Without that second case the published figure would
 * exclude the most expensive check in the pipeline, which is how a latency
 * claim quietly stops being true.
 */

const FARES = Array.from({ length: 20 }, (_, i) => ({
  fareId: `HA-${1000 + i}`,
  airline: "Harbor Air",
  price: 300 + i * 17,
  stops: i % 3,
  seatsLeft: i % 5,
  fareRules: { refundable: i % 2 === 0 },
}));

const guard = createGuard({
  registry: createRegistry([
    { name: "FlightCard", entity: "fares", key: "fareId", bound: ["airline", "price", "stops"] },
  ]),
  policies: [
    p.requireBinding(),
    p.dropUnsourcedClaims({
      topics: ["free cancellation", "refundable", "bag included"],
      supportedBy: ["fareRules"],
    }),
    p.excludeWhere("fares", (f) => f.seatsLeft === 0),
    p.annotateWhere("fares", (f, ctx) => Number(f.price) > Number(ctx.budget), "Over budget"),
    p.requireRole(["RefundOverride"], "support_agent"),
    p.confirmActions(["book"]),
    p.safeUrls({ imageHosts: ["img.travel-demo.test"] }),
    p.restrictInputs({ allow: ["PaymentForm"] }),
    p.maskFields(["loyaltyId"]),
  ],
});

guard.recordToolResult({
  turnId: "bench",
  toolName: "searchFlights",
  entity: "fares",
  key: "fareId",
  data: FARES,
});

/** The same guard, with the prop schema a json-render catalog would hand over. */
const schemaGuard = createGuard({
  registry: createRegistry([
    {
      name: "FlightCard",
      entity: "fares",
      key: "fareId",
      bound: ["airline", "price", "stops"],
      props: z.object({
        airline: z.string(),
        price: z.number(),
        stops: z.number(),
        badges: z.array(z.string()).nullable(),
        note: z.string().nullable(),
      }),
    },
  ]),
  policies: [
    p.requireBinding(),
    p.dropUnsourcedClaims({
      topics: ["free cancellation", "refundable", "bag included"],
      supportedBy: ["fareRules"],
    }),
    p.excludeWhere("fares", (f) => f.seatsLeft === 0),
    p.annotateWhere("fares", (f, ctx) => Number(f.price) > Number(ctx.budget), "Over budget"),
    p.requireRole(["RefundOverride"], "support_agent"),
    p.confirmActions(["book"]),
    p.safeUrls({ imageHosts: ["img.travel-demo.test"] }),
    p.restrictInputs({ allow: ["PaymentForm"] }),
    p.maskFields(["loyaltyId"]),
  ],
});

schemaGuard.recordToolResult({
  turnId: "bench",
  toolName: "searchFlights",
  entity: "fares",
  key: "fareId",
  data: FARES,
});

const ref = (path: string): PropValue => ({ kind: "ref", path });
const CTX: Ctx = { turnId: "bench", session: { role: "customer" }, budget: 500 };

const ok: GuardElement = {
  id: "f1",
  type: "FlightCard",
  props: {
    airline: ref("fares.HA-1001.airline"),
    price: ref("fares.HA-1001.price"),
    stops: ref("fares.HA-1001.stops"),
    badge: { kind: "literal", value: "Nonstop" },
    src: { kind: "literal", value: "https://img.travel-demo.test/a.png" },
  },
  children: [],
};

const bad: GuardElement = {
  ...ok,
  id: "f2",
  props: { ...ok.props, price: { kind: "literal", value: 189 } },
};

/** A card whose props validate against the catalog's schema. */
const schemaOk: GuardElement = {
  id: "f3",
  type: "FlightCard",
  props: {
    airline: ref("fares.HA-1001.airline"),
    price: ref("fares.HA-1001.price"),
    stops: ref("fares.HA-1001.stops"),
    badges: { kind: "literal", value: ["Nonstop"] },
    note: { kind: "literal", value: null },
  },
  children: [],
};

describe("check latency", () => {
  bench("allowed element, nine policies", () => {
    guard.check(ok, CTX);
  });

  bench("blocked element, nine policies", () => {
    guard.check(bad, CTX);
  });

  bench("allowed element, nine policies and contract validation", () => {
    schemaGuard.check(schemaOk, CTX);
  });
});
