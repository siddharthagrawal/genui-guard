import { defineCatalog, defineSchema, resolveElementProps, validateSpec } from "@json-render/core";
import { createGuard, policies as p } from "@genui-guard/core";
import type { Ctx } from "@genui-guard/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { guardSpec } from "./guard-spec.js";
import { fromJsonRender } from "./registry.js";
import { specToEvents, type JsonRenderSpec } from "./spec.js";

/**
 * Contract tests against the real @json-render/core, pinned at 0.21.0.
 *
 * json-render is pre-1.0, so these exist to make an upgrade fail loudly here
 * rather than quietly in the demo. If this file breaks after a bump, the
 * adapter needs attention and nothing else does.
 */

const schema = defineSchema((s) => ({
  spec: s.object({
    root: s.object({
      type: s.ref("catalog.components"),
      props: s.propsOf("catalog.components"),
      children: s.array(s.string()),
    }),
  }),
  catalog: s.object({
    components: s.map({ props: s.zod(), description: s.string() }),
    actions: s.map({ description: s.string() }),
  }),
}));

const catalog = defineCatalog(schema, {
  components: {
    Stack: { props: z.object({ gap: z.number().nullable() }), description: "A column" },
    FlightCard: {
      props: z.object({
        airline: z.string(),
        price: z.number(),
        stops: z.number(),
        badge: z.string().nullable(),
      }),
      description: "One flight option",
    },
    TripSummary: {
      props: z.object({ total: z.number().nullable() }),
      description: "Itinerary totals",
    },
  },
  actions: {
    book: { description: "Books the itinerary" },
  },
});

const FARES = [
  { fareId: "HA-2041", airline: "Harbor Air", price: 412, stops: 1, seatsLeft: 4 },
];

const CTX: Ctx = { turnId: "t1", session: { role: "customer" }, budget: 900 };

function buildGuard() {
  const guard = createGuard({
    registry: fromJsonRender(catalog, {
      FlightCard: { entity: "fares", key: "fareId", bound: ["airline", "price", "stops"] },
    }),
    policies: [
      p.requireBinding(),
      p.dropUnsourcedClaims({ topics: ["free cancellation"] }),
      p.confirmActions(["book"]),
    ],
  });
  guard.recordToolResult({
    turnId: "t1",
    toolName: "searchFlights",
    entity: "fares",
    key: "fareId",
    data: FARES,
  });
  return guard;
}

const bound = {
  airline: { $state: "/fares/HA-2041/airline" },
  price: { $state: "/fares/HA-2041/price" },
  stops: { $state: "/fares/HA-2041/stops" },
};

function spec(flightProps: Record<string, unknown>): JsonRenderSpec {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: { gap: 2 }, children: ["card", "summary"] },
      card: { type: "FlightCard", props: flightProps },
      summary: {
        type: "TripSummary",
        props: { total: null },
        on: { press: { action: "book" } },
      },
    },
    state: { fares: { "HA-2041": FARES[0] } },
  };
}

describe("reading a real json-render catalog", () => {
  it("picks up every component name", () => {
    const registry = fromJsonRender(catalog);
    expect(registry.names().sort()).toEqual(["FlightCard", "Stack", "TripSummary"]);
  });

  it("reuses the catalog's own zod schemas rather than asking for them again", () => {
    const registry = fromJsonRender(catalog);
    const spec = registry.get("FlightCard");

    expect(spec?.props).toBeDefined();
    // The schema has to be the real thing, since lintRegistry reads its shape.
    expect(Object.keys((spec?.props as { shape: object }).shape).sort()).toEqual([
      "airline",
      "badge",
      "price",
      "stops",
    ]);
  });

  it("merges genui-guard rules on top of the catalog entry", () => {
    const registry = fromJsonRender(catalog, {
      FlightCard: { entity: "fares", key: "fareId", bound: ["price"] },
    });
    const spec = registry.get("FlightCard");

    expect(spec).toMatchObject({ name: "FlightCard", entity: "fares", key: "fareId" });
    expect(spec?.props).toBeDefined();
  });

  it("refuses rules for a component the catalog does not have", () => {
    expect(() => fromJsonRender(catalog, { Nope: { entity: "x" } })).toThrow(/not in the json-render catalog/);
  });

  it("catches a typo in bound against the catalog's real schema", () => {
    // The prop is "price", so this is the failure that otherwise looks like
    // protection that is not there.
    expect(() =>
      createGuard({
        registry: fromJsonRender(catalog, {
          FlightCard: { entity: "fares", key: "fareId", bound: ["prise"] },
        }),
      }),
    ).toThrow(/prise/);
  });
});

describe("spec translation against the real shape", () => {
  it("walks children and emits the root first", () => {
    const events = specToEvents(spec(bound));

    expect(events[0]).toEqual({ kind: "root", id: "root" });
    const ids = events.filter((e) => e.kind === "element").map((e) => e.id);
    expect(ids).toEqual(["root", "card", "summary"]);
  });

  it("reads json-render's $state pointers as refs", () => {
    const events = specToEvents(spec(bound));
    const card = events.find((e) => e.kind === "element" && e.id === "card");

    expect(card && "element" in card ? card.element.props.price : null).toEqual({
      kind: "ref",
      path: "fares.HA-2041.price",
    });
  });

  it("reads an action binding's name from json-render's `action` field", () => {
    const events = specToEvents(spec(bound));
    const summary = events.find((e) => e.kind === "element" && e.id === "summary");

    expect(summary && "element" in summary ? summary.element.on?.press : null).toMatchObject({
      name: "book",
    });
  });
});

/**
 * The most valuable test here. A guarded spec has to satisfy json-render's own
 * validator, which is what proves blocking left no dangling reference behind.
 */
describe("guarded specs satisfy json-render's validator", () => {
  it("accepts an untouched spec", async () => {
    const { spec: out } = await guardSpec(buildGuard(), spec(bound), CTX);
    const issues = validateSpec(out as never);

    expect(issues.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(issues.valid).toBe(true);
  });

  it("leaves no dangling child reference after a block", async () => {
    // A literal price blocks the card, so root.children must no longer name it.
    const { spec: out, dropped } = await guardSpec(
      buildGuard(),
      spec({ ...bound, price: 189 }),
      CTX,
    );

    expect(dropped).toContain("card");
    expect(out.elements.root?.children).not.toContain("card");
    expect(out.elements.card).toBeUndefined();

    const issues = validateSpec(out as never);
    expect(issues.issues.filter((i) => i.code === "missing_child")).toEqual([]);
    expect(issues.valid).toBe(true);
  });

  it("keeps the rest of the page when one card is blocked", async () => {
    const { spec: out } = await guardSpec(buildGuard(), spec({ ...bound, price: 189 }), CTX);

    expect(out.elements.root).toBeDefined();
    expect(out.elements.summary).toBeDefined();
    expect(out.root).toBe("root");
  });
});

describe("repairs and gates round-trip into json-render's own shapes", () => {
  it("writes a removed claim back as a literal null", async () => {
    const { spec: out } = await guardSpec(
      buildGuard(),
      spec({ ...bound, badge: "Free cancellation" }),
      CTX,
    );

    expect(out.elements.card?.props.badge).toBeNull();
  });

  it("preserves a $state pointer through the round trip", async () => {
    const { spec: out } = await guardSpec(buildGuard(), spec(bound), CTX);

    expect(out.elements.card?.props.price).toEqual({ $state: "/fares/HA-2041/price" });
  });

  it("gates a booking using json-render's own confirm field", async () => {
    const { spec: out } = await guardSpec(buildGuard(), spec(bound), CTX);
    const press = out.elements.summary?.on?.press;
    const binding = Array.isArray(press) ? press[0] : press;

    expect(binding?.action).toBe("book");
    expect(binding?.confirm).toMatchObject({ variant: "danger" });
    expect(binding?.confirm?.message).toContain("book");
  });

  it("produces props json-render can still resolve", async () => {
    const { spec: out } = await guardSpec(buildGuard(), spec(bound), CTX);

    // The real resolver, against the state the host loaded.
    const resolved = resolveElementProps(out.elements.card?.props ?? {}, {
      stateModel: { fares: { "HA-2041": FARES[0] } },
    });

    expect(resolved.price).toBe(412);
    expect(resolved.airline).toBe("Harbor Air");
  });
});

/**
 * An annotation is reported, not applied: the element renders as the model
 * composed it and the note travels beside the spec, which is the same division
 * of labour as `dropped`. The guard says what it found; the host decides what
 * the interface does about it.
 */
describe("annotations travel beside the spec", () => {
  function overBudgetGuard() {
    const guard = createGuard({
      registry: fromJsonRender(catalog, {
        FlightCard: { entity: "fares", key: "fareId", bound: ["airline", "price", "stops"] },
      }),
      policies: [
        p.requireBinding(),
        p.annotateWhere(
          "fares",
          (fare, ctx) => Number(fare.price) > Number(ctx.budget ?? Infinity),
          "Over your stated budget",
        ),
      ],
    });
    guard.recordToolResult({
      turnId: "t1",
      toolName: "searchFlights",
      entity: "fares",
      key: "fareId",
      data: FARES,
    });
    return guard;
  }

  const tight: Ctx = { turnId: "t1", session: { role: "customer" }, budget: 100 };

  it("keyed by element id, with the element untouched", async () => {
    const { spec: out, annotations, dropped } = await guardSpec(
      overBudgetGuard(),
      spec(bound),
      tight,
    );

    expect(annotations).toEqual({ card: ["Over your stated budget"] });
    expect(dropped).toEqual([]);
    // Reported, not applied: every prop is exactly as it arrived.
    expect(out.elements.card?.props).toEqual(bound);
  });

  it("is empty when nothing was annotated", async () => {
    const { annotations } = await guardSpec(overBudgetGuard(), spec(bound), {
      ...tight,
      budget: 10_000,
    });

    expect(annotations).toEqual({});
  });

  it("leaves out an element that was withheld, since there is nothing to annotate", async () => {
    const { annotations, dropped } = await guardSpec(
      overBudgetGuard(),
      spec({ ...bound, price: 189 }),
      tight,
    );

    expect(dropped).toContain("card");
    expect(annotations.card).toBeUndefined();
  });

  it("does not disturb the guarded spec's validity", async () => {
    const { spec: out } = await guardSpec(overBudgetGuard(), spec(bound), tight);
    expect(validateSpec(out as never).valid).toBe(true);
  });
});
