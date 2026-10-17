import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createGuard } from "./guard.js";
import { createRegistry } from "./registry.js";
import type { Ctx, GuardElement, PropValue } from "./types.js";

/**
 * The eval suites found that prop validation was never wired in. The check
 * order in docs/build-plan.md has always said an unknown prop is stripped and
 * an invalid one blocks; only the unknown-component half was implemented, and a
 * fully passing unit suite never noticed because no test sent a bad prop
 * through the guard.
 */

const FARES = [{ fareId: "HA-2041", airline: "Harbor Air", price: 412, stops: 1 }];

const registry = createRegistry([
  { name: "Stack", props: z.object({ gap: z.number().nullable() }) },
  {
    name: "FlightCard",
    entity: "fares",
    key: "fareId",
    bound: ["price"],
    props: z.object({
      airline: z.string(),
      price: z.number(),
      badges: z.array(z.string()).nullable(),
      note: z.string().nullable(),
    }),
  },
  { name: "Unschemad" },
]);

const CTX: Ctx = { turnId: "t1" };
const ref = (path: string): PropValue => ({ kind: "ref", path });
const lit = (value: unknown): PropValue => ({ kind: "literal", value });

function build() {
  const guard = createGuard({ registry });
  guard.recordToolResult({
    turnId: "t1",
    toolName: "searchFlights",
    entity: "fares",
    key: "fareId",
    data: FARES,
  });
  return guard;
}

const card = (props: Record<string, PropValue>): GuardElement => ({
  id: "c1",
  type: "FlightCard",
  props: {
    airline: lit("Harbor Air"),
    price: ref("fares.HA-2041.price"),
    badges: lit(null),
    note: lit(null),
    ...props,
  },
  children: [],
});

describe("contract", () => {
  it("removes a prop the catalog does not declare, and keeps the element", () => {
    const { decision, element } = build().check(card({ subtitle: lit("Our top pick") }), CTX);

    expect(decision).toBe("repair");
    expect(element?.props.subtitle).toBeUndefined();
    expect(element?.props.airline).toEqual(lit("Harbor Air"));
  });

  it("names the removed props in the reason", () => {
    const { trace } = build().check(
      card({ subtitle: lit("Our top pick"), urgency: lit("high") }),
      CTX,
    );
    const reason = trace.results.find((r) => r.policy === "contract")?.reason ?? "";

    expect(reason).toContain('"subtitle"');
    expect(reason).toContain('"urgency"');
    expect(reason).toContain("removed");
  });

  it("blocks a prop of the wrong type", () => {
    const { decision, trace } = build().check(card({ badges: lit("Cheapest option") }), CTX);

    expect(decision).toBe("block");
    expect(trace.results.some((r) => r.policy === "contract")).toBe(true);
  });

  it("explains which prop was wrong", () => {
    const { trace } = build().check(card({ badges: lit("Cheapest option") }), CTX);
    const reason = trace.results.find((r) => r.policy === "contract")?.reason ?? "";

    expect(reason).toContain("badges");
    expect(reason).toContain("FlightCard");
  });

  it("validates the value behind a ref, not the ref itself", () => {
    const { decision } = build().check(
      card({ airline: ref("fares.HA-2041.airline") }),
      CTX,
    );
    expect(decision).toBe("allow");
  });

  it("skips a prop it cannot read rather than calling it invalid", () => {
    const { decision } = build().check(
      card({ note: { kind: "expr", raw: { $template: "Departs {{/fares/HA-2041/depart}}" } } }),
      CTX,
    );
    expect(decision).toBe("allow");
  });

  it("does not report a type error for a ref that resolves to nothing, which provenance owns", () => {
    const { trace } = build().check(card({ price: ref("fares.HA-9999.price") }), CTX);

    expect(trace.results.some((r) => r.policy === "contract")).toBe(false);
    expect(trace.results.some((r) => r.policy === "requireBinding")).toBe(true);
  });

  /**
   * The adapter's contract tests against the real json-render caught this.
   * Its validator accepts a spec that omits a nullable prop, so blocking one
   * here would make the guard stricter than the renderer it protects.
   */
  it("does not block a prop the schema declares and the model omitted", () => {
    const { decision } = build().check(
      {
        id: "c2",
        type: "FlightCard",
        props: { airline: lit("Harbor Air"), price: ref("fares.HA-2041.price") },
        children: [],
      },
      CTX,
    );
    expect(decision).toBe("allow");
  });

  it("checks nothing when the host supplied no schema", () => {
    const { decision, element } = build().check(
      { id: "u1", type: "Unschemad", props: { anything: lit(1) }, children: [] },
      CTX,
    );

    expect(decision).toBe("allow");
    expect(element?.props.anything).toEqual(lit(1));
  });

  it("still blocks a component the registry has never heard of", () => {
    const { decision } = build().check(
      { id: "x1", type: "UrgencyBanner", props: {}, children: [] },
      CTX,
    );
    expect(decision).toBe("block");
  });
});
