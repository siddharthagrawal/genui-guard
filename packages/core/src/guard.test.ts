import { beforeEach, describe, expect, it } from "vitest";
import { GuardError } from "./errors.js";
import { createGuard } from "./guard.js";
import { policies as p } from "./policies.js";
import { createRegistry } from "./registry.js";
import type { ComponentSpec, Ctx, Guard, GuardElement, GuardEvent, PropValue } from "./types.js";

const FARES = [
  { fareId: "HA-2041", airline: "Harbor Air", price: 412, stops: 1, seatsLeft: 4, fareRules: { refundable: false } },
  { fareId: "HA-5500", airline: "Harbor Air", price: 540, stops: 0, seatsLeft: 3, fareRules: { refundable: true } },
  { fareId: "HA-3388", airline: "Coastline", price: 655, stops: 0, seatsLeft: 0, fareRules: { refundable: true } },
];

const HOTELS = [
  { hotelId: "H-1", name: "Azul Rooms", nightly: 120, roomsLeft: 3, imageAlt: "", loyaltyId: "9912348877" },
  // Nothing on this record can supply alt text, which is the only way the a11y
  // check should reach a block once it can read bound values.
  { hotelId: "H-2", name: "", nightly: 90, roomsLeft: 2, imageAlt: "" },
];

const SPECS: ComponentSpec[] = [
  { name: "Stack" },
  { name: "FlightCard", entity: "fares", key: "fareId", bound: ["airline", "price", "stops"] },
  {
    name: "HotelCard",
    entity: "hotels",
    key: "hotelId",
    bound: ["name"],
    a11y: { requireAlt: ["imageAlt"] },
  },
  { name: "TripSummary" },
  { name: "RefundOverride" },
  { name: "PaymentForm" },
  { name: "TextField" },
];

const ref = (path: string): PropValue => ({ kind: "ref", path });
const lit = (value: unknown): PropValue => ({ kind: "literal", value });

const flight = (over: Record<string, PropValue> = {}, id = "f1"): GuardElement => ({
  id,
  type: "FlightCard",
  props: {
    airline: ref("fares.HA-2041.airline"),
    price: ref("fares.HA-2041.price"),
    stops: ref("fares.HA-2041.stops"),
    ...over,
  },
  children: [],
});

const CTX: Ctx = { turnId: "t1", session: { role: "customer" }, budget: 500 };

function build(extra: Parameters<typeof createGuard>[0]["policies"] = []): Guard {
  const guard = createGuard({
    registry: createRegistry(SPECS),
    policies: extra,
  });
  guard.recordToolResult({ turnId: "t1", toolName: "searchFlights", entity: "fares", key: "fareId", data: FARES });
  guard.recordToolResult({ turnId: "t1", toolName: "searchHotels", entity: "hotels", key: "hotelId", data: HOTELS });
  return guard;
}

let guard: Guard;
beforeEach(() => {
  guard = build([
    p.requireBinding(),
    p.dropUnsourcedClaims({ topics: ["free cancellation", "refundable"], supportedBy: ["fareRules"] }),
    p.excludeWhere("fares", (f) => f.seatsLeft === 0, "it is sold out"),
    p.annotateWhere("fares", (f, ctx) => Number(f.price) > Number(ctx.budget), "Over your stated budget"),
    p.requireRole(["RefundOverride"], "support_agent"),
    p.confirmActions(["book"]),
    p.safeUrls({ imageHosts: ["img.travel-demo.test"] }),
    p.restrictInputs({ allow: ["PaymentForm"] }),
    p.maskFields(["loyaltyId"]),
  ]);
});

describe("contract", () => {
  it("allows a well formed, fully bound card", () => {
    const { decision, element } = guard.check(flight(), CTX);
    expect(decision).toBe("allow");
    expect(element).not.toBeNull();
  });

  it("blocks a component that is not in the registry", () => {
    const { decision, trace } = guard.check(
      { id: "x", type: "MysteryWidget", props: {}, children: [] },
      CTX,
    );
    expect(decision).toBe("block");
    expect(trace.results[0]?.reason).toContain("not in the registry");
  });

  it("traces allowed elements too, so the guard can prove it looked", () => {
    guard.check(flight(), CTX);
    const entries = guard.traces("t1").filter((e) => "component" in e);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ final: "allow", component: "FlightCard" });
  });
});

describe("provenance through the guard", () => {
  it("blocks a literal price", () => {
    const { decision, trace } = guard.check(flight({ price: lit(189) }), CTX);
    expect(decision).toBe("block");
    expect(trace.results.some((r) => r.reason.includes("literal"))).toBe(true);
  });

  it("blocks a nonstop label that contradicts the source", () => {
    // stops is bound, so the model cannot write 0 over a source value of 1.
    const { decision } = guard.check(flight({ stops: lit(0) }), CTX);
    expect(decision).toBe("block");
  });

  it("throws a setup error when no tool result was recorded", () => {
    const bare = createGuard({ registry: createRegistry(SPECS) });
    try {
      bare.check(flight(), CTX);
      expect.unreachable();
    } catch (e) {
      expect((e as GuardError).code).toBe("GUARD_E_NO_TOOL_RESULT");
    }
  });
});

describe("policies through the guard", () => {
  it("removes a claim the fare rules do not support", () => {
    const { decision, element } = guard.check(flight({ badge: lit("Free cancellation") }), CTX);
    expect(decision).toBe("repair");
    expect(element?.props.badge).toEqual({ kind: "literal", value: null });
  });

  it("keeps a claim the source supports", () => {
    const supported = flight(
      {
        airline: ref("fares.HA-3388.airline"),
        price: ref("fares.HA-3388.price"),
        stops: ref("fares.HA-3388.stops"),
        badge: lit("Refundable"),
      },
      "f2",
    );
    // HA-3388 is sold out, so it blocks, but not for the claim.
    const { trace } = guard.check(supported, CTX);
    expect(trace.results.some((r) => r.policy === "dropUnsourcedClaims")).toBe(false);
  });

  /**
   * A reviewer found this and it was the worst kind of wrong: the guard was
   * deleting honest warnings. "Non-refundable" contains the configured topic,
   * the field said false, and the old rule read that as unsupported, so the
   * badge protecting the buyer came off the card. A claim can deny its topic as
   * well as assert it, and the source has to agree with whichever was meant.
   */
  it("keeps a denial the source agrees with", () => {
    const { decision, element } = guard.check(flight({ badge: lit("Non-refundable") }), CTX);

    expect(decision).toBe("allow");
    expect(element?.props.badge).toEqual({ kind: "literal", value: "Non-refundable" });
  });

  it("keeps a denial written as separate words", () => {
    const { element } = guard.check(flight({ badge: lit("Not refundable") }), CTX);
    expect(element?.props.badge).toEqual({ kind: "literal", value: "Not refundable" });
  });

  /**
   * The asymmetry question, settled deliberately. These fares carry no
   * cancellation field at all, so "No free cancellation" is as unverifiable as
   * its opposite, and it still comes off. A denial is the milder failure, since
   * it under-promises rather than inducing a purchase on false terms, but the
   * policy is called dropUnsourcedClaims and a denial about a field that does
   * not exist is the model inventing a fact with a minus sign in front of it.
   */
  it("removes a denial the source cannot speak to either way", () => {
    const { decision, element } = guard.check(flight({ badge: lit("No free cancellation") }), CTX);

    expect(decision).toBe("repair");
    expect(element?.props.badge).toEqual({ kind: "literal", value: null });
  });

  it("removes a denial the source contradicts", () => {
    const refundable = flight(
      {
        airline: ref("fares.HA-5500.airline"),
        price: ref("fares.HA-5500.price"),
        stops: ref("fares.HA-5500.stops"),
        badge: lit("Non-refundable"),
      },
      "f9",
    );
    const { decision, element } = guard.check(refundable, CTX);

    expect(decision).toBe("repair");
    expect(element?.props.badge).toEqual({ kind: "literal", value: null });
  });

  /** The negation has to attach to the topic, not to anything nearby. */
  it("does not read a negation that belongs to a different claim", () => {
    const { decision } = guard.check(flight({ badge: lit("Refundable, no change fees") }), CTX);
    expect(decision).toBe("repair");
  });

  it("keeps the denial and drops the fabrication in one list", () => {
    const { element } = guard.check(
      flight({ badges: lit(["Non-refundable", "Free cancellation"]) }),
      CTX,
    );
    expect(element?.props.badges).toEqual({ kind: "literal", value: ["Non-refundable"] });
  });

  it("blocks a sold out fare", () => {
    const soldOut = flight(
      {
        airline: ref("fares.HA-3388.airline"),
        price: ref("fares.HA-3388.price"),
        stops: ref("fares.HA-3388.stops"),
      },
      "f3",
    );
    const { decision, trace } = guard.check(soldOut, CTX);
    expect(decision).toBe("block");
    expect(trace.results.some((r) => r.reason.includes("sold out"))).toBe(true);
  });

  it("annotates an over budget fare and still renders it", () => {
    const { decision, element, trace } = guard.check(flight(), { ...CTX, budget: 300 });
    expect(decision).toBe("annotate");
    expect(element).not.toBeNull();
    expect(trace.results.some((r) => r.note === "Over your stated budget")).toBe(true);
  });

  it("blocks a staff only component for a customer", () => {
    const { decision, trace } = guard.check(
      { id: "r1", type: "RefundOverride", props: {}, children: [] },
      CTX,
    );
    expect(decision).toBe("block");
    expect(trace.results[0]?.reason).toContain("support_agent");
  });

  it("allows the same component for the right role", () => {
    const { decision } = guard.check(
      { id: "r1", type: "RefundOverride", props: {}, children: [] },
      { ...CTX, session: { role: "support_agent" } },
    );
    expect(decision).toBe("allow");
  });

  it("gates a booking action", () => {
    const { decision, trace } = guard.check(
      {
        id: "s1",
        type: "TripSummary",
        props: {},
        children: [],
        on: { press: { name: "book" } },
      },
      CTX,
    );
    expect(decision).toBe("gate");
    expect(trace.results.find((r) => r.policy === "confirmActions")?.gatedActions).toEqual(["book"]);
  });

  it("removes a javascript: url", () => {
    const { decision, element } = guard.check(
      { id: "h1", type: "TripSummary", props: { href: lit("javascript:alert(1)") }, children: [] },
      CTX,
    );
    expect(decision).toBe("repair");
    expect(element?.props.href).toEqual({ kind: "literal", value: null });
  });

  it("removes an image from an unapproved host", () => {
    const { decision, element } = guard.check(
      {
        id: "h2",
        type: "TripSummary",
        props: { src: lit("https://evil.example.com/a.png") },
        children: [],
      },
      CTX,
    );
    expect(decision).toBe("repair");
    expect(element?.props.src).toEqual({ kind: "literal", value: null });
  });

  it("keeps an image from an approved host", () => {
    const { decision } = guard.check(
      {
        id: "h3",
        type: "TripSummary",
        props: { src: lit("https://img.travel-demo.test/a.png") },
        children: [],
      },
      CTX,
    );
    expect(decision).toBe("allow");
  });

  it("blocks a password field outside an approved component", () => {
    const { decision, trace } = guard.check(
      { id: "i1", type: "TextField", props: { type: lit("password") }, children: [] },
      CTX,
    );
    expect(decision).toBe("block");
    expect(trace.results[0]?.reason).toContain("PaymentForm");
  });

  it("allows a password field inside an approved component", () => {
    const { decision } = guard.check(
      { id: "i2", type: "PaymentForm", props: { type: lit("password") }, children: [] },
      CTX,
    );
    expect(decision).toBe("allow");
  });

  it("masks a loyalty number", () => {
    const { decision, element } = guard.check(
      { id: "m1", type: "TripSummary", props: { loyaltyId: lit("9912348877") }, children: [] },
      CTX,
    );
    expect(decision).toBe("repair");
    expect(element?.props.loyaltyId).toEqual({ kind: "literal", value: "••••••8877" });
  });

  it("blocks rather than passing through when a policy throws", () => {
    const broken = build([
      {
        name: "explodes",
        check: () => {
          throw new Error("boom");
        },
      },
    ]);
    const { decision, trace } = broken.check(flight(), CTX);
    expect(decision).toBe("block");
    expect(trace.results.some((r) => r.policy === "explodes")).toBe(true);
  });
});

describe("accessibility", () => {
  it("fills missing alt text from the element's own name", () => {
    const { decision, element } = guard.check(
      {
        id: "ht1",
        type: "HotelCard",
        props: { name: ref("hotels.H-1.name"), imageAlt: lit(""), title: lit("Azul Rooms") },
        children: [],
      },
      CTX,
    );
    expect(decision).toBe("repair");
    expect(element?.props.imageAlt).toEqual({ kind: "literal", value: "Azul Rooms" });
  });

  // The eval suites found this one. In any real catalog the name beside an
  // image is bound rather than typed, so reading literals alone meant the
  // repair almost never fired and the card was withheld instead.
  it("fills missing alt text from a bound name, not only from a typed one", () => {
    const { decision, element } = guard.check(
      {
        id: "ht3",
        type: "HotelCard",
        props: { name: ref("hotels.H-1.name"), imageAlt: lit("") },
        children: [],
      },
      CTX,
    );
    expect(decision).toBe("repair");
    expect(element?.props.imageAlt).toEqual({ kind: "literal", value: "Azul Rooms" });
  });

  it("blocks when nothing on the element can supply alt text", () => {
    const { decision, trace } = guard.check(
      {
        id: "ht2",
        type: "HotelCard",
        props: { name: ref("hotels.H-2.name"), imageAlt: lit("") },
        children: [],
      },
      CTX,
    );
    expect(decision).toBe("block");
    expect(trace.results.some((r) => r.policy === "accessibility")).toBe(true);
  });
});

describe("config errors at setup", () => {
  it("refuses a bound prop with no entity", () => {
    expect(() =>
      createGuard({ registry: createRegistry([{ name: "Bad", bound: ["price"] }]) }),
    ).toThrow(/GUARD_E_BOUND_WITHOUT_ENTITY|bound props/);
  });

  it("refuses a bound prop with no key", () => {
    expect(() =>
      createGuard({
        registry: createRegistry([{ name: "Bad", entity: "fares", bound: ["price"] }]),
      }),
    ).toThrow(GuardError);
  });

  it("refuses a hold timeout that would never expire", () => {
    expect(() =>
      createGuard({ registry: createRegistry(SPECS), holdTimeoutMs: 0 }),
    ).toThrow(GuardError);
  });
});

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

async function run(guard: Guard, events: GuardEvent[], ctx: Ctx = CTX): Promise<GuardEvent[]> {
  const input = new ReadableStream<GuardEvent>({
    start(c) {
      for (const e of events) c.enqueue(e);
      c.close();
    },
  });

  const out: GuardEvent[] = [];
  const reader = input.pipeThrough(guard.stream(ctx)).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("streaming", () => {
  it("works over a plain ReadableStream in Node", async () => {
    const out = await run(guard, [
      { kind: "root", id: "root" },
      { kind: "element", id: "root", element: { id: "root", type: "Stack", props: {}, children: ["f1"] } },
      { kind: "element", id: "f1", element: flight() },
    ]);

    expect(out.map((e) => e.kind)).toEqual(["root", "element", "element"]);
  });

  it("emits a drop for a blocked element instead of the element", async () => {
    const out = await run(guard, [
      { kind: "root", id: "root" },
      { kind: "element", id: "f1", element: flight({ price: lit(189) }) },
    ]);

    const drops = out.filter((e) => e.kind === "drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ id: "f1" });
    expect(out.some((e) => e.kind === "element")).toBe(false);
  });

  it("drops a blocked container's whole subtree", async () => {
    const out = await run(guard, [
      { kind: "root", id: "root" },
      {
        kind: "element",
        id: "bad",
        element: { id: "bad", type: "MysteryWidget", props: {}, children: ["c1", "c2"] },
      },
    ]);

    const dropped = out.filter((e) => e.kind === "drop").map((e) => (e as { id: string }).id);
    expect(dropped.sort()).toEqual(["bad", "c1", "c2"]);
  });

  it("never emits an element that was already dropped by a cascade", async () => {
    const out = await run(guard, [
      { kind: "root", id: "root" },
      {
        kind: "element",
        id: "bad",
        element: { id: "bad", type: "MysteryWidget", props: {}, children: ["f1"] },
      },
      { kind: "element", id: "f1", element: flight() },
    ]);

    expect(out.some((e) => e.kind === "element" && e.id === "f1")).toBe(false);
  });

  /** The invariant. See docs/decisions.md on state ownership. */
  it("rejects a model state patch into a reserved namespace and keeps the host value", async () => {
    const out = await run(guard, [
      { kind: "root", id: "root" },
      { kind: "state", path: "fares.HA-2041.price", value: 189 },
      { kind: "element", id: "f1", element: flight() },
    ]);

    expect(out.some((e) => e.kind === "state")).toBe(false);

    const emitted = out.find((e) => e.kind === "element");
    expect(emitted).toBeDefined();

    const stateTrace = guard.traces("t1").find((t) => "path" in t && t.path === "fares.HA-2041.price");
    expect(stateTrace).toMatchObject({ final: "block" });
  });

  it("passes model state patches outside reserved namespaces through", async () => {
    const out = await run(guard, [
      { kind: "root", id: "root" },
      { kind: "state", path: "ui.drawerOpen", value: true },
    ]);

    expect(out.filter((e) => e.kind === "state")).toHaveLength(1);
  });

  it("holds an element until its source data arrives, then emits it", async () => {
    const late = createGuard({
      registry: createRegistry(SPECS),
      policies: [p.requireBinding()],
    });

    const input = new ReadableStream<GuardEvent>({
      start(c) {
        c.enqueue({ kind: "root", id: "root" });
        c.enqueue({ kind: "element", id: "f1", element: flight() });
        c.close();
      },
    });

    const reader = input.pipeThrough(late.stream(CTX)).getReader();

    // Nothing for f1 yet: the fare data has not arrived, so it is held rather
    // than rendered with an unverified price.
    const first = await reader.read();
    expect(first.value?.kind).toBe("root");

    late.recordToolResult({
      turnId: "t1",
      toolName: "searchFlights",
      entity: "fares",
      key: "fareId",
      data: FARES,
    });

    const rest: GuardEvent[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest.push(value);
    }

    // It was released on flush once the data existed.
    expect(rest.some((e) => e.kind === "element" && e.id === "f1")).toBe(true);
  });

  it("expires a hold that never resolves instead of hanging", async () => {
    const never = createGuard({
      registry: createRegistry(SPECS),
      policies: [p.requireBinding()],
    });

    const out = await run(never, [
      { kind: "root", id: "root" },
      { kind: "element", id: "f1", element: flight() },
    ]);

    const drop = out.find((e) => e.kind === "drop");
    expect(drop).toBeDefined();
    expect((drop as { reason: string }).reason).toContain("never arrived");

    const held = never.traces("t1").find(
      (t) => "results" in t && t.results.some((r) => r.policy === "holdUntilVerified"),
    );
    expect(held).toBeDefined();
  });

  it("wrap() behaves like stream() over an async iterable", async () => {
    async function* events(): AsyncGenerator<GuardEvent> {
      yield { kind: "root", id: "root" };
      yield { kind: "element", id: "f1", element: flight({ price: lit(189) }) };
    }

    const out: GuardEvent[] = [];
    for await (const e of guard.wrap(events(), CTX)) out.push(e);

    expect(out.filter((e) => e.kind === "drop")).toHaveLength(1);
  });
});

describe("false positives the travel demo surfaced", () => {
  /**
   * A claim the entity supports at its top level, rather than inside the field
   * named by supportedBy, was being stripped. The data backed the claim all
   * along, which makes it the worst kind of false block.
   */
  it("keeps a claim supported by a field on the entity root", () => {
    const g = createGuard({
      registry: createRegistry([
        { name: "HotelCard", entity: "hotels", key: "hotelId", bound: ["name"] },
      ]),
      policies: [
        p.dropUnsourcedClaims({ topics: ["free cancellation"], supportedBy: ["fareRules"] }),
      ],
    });
    g.recordToolResult({
      turnId: "t1",
      toolName: "searchHotels",
      entity: "hotels",
      key: "hotelId",
      data: [{ hotelId: "H-1", name: "Azul Rooms", freeCancellation: true }],
    });

    const { decision, element } = g.check(
      {
        id: "h1",
        type: "HotelCard",
        props: { name: ref("hotels.H-1.name"), badge: lit("Free cancellation") },
        children: [],
      },
      CTX,
    );

    expect(decision).toBe("allow");
    expect(element?.props.badge).toEqual({ kind: "literal", value: "Free cancellation" });
  });

  it("still strips the same claim when nothing supports it", () => {
    const g = createGuard({
      registry: createRegistry([
        { name: "HotelCard", entity: "hotels", key: "hotelId", bound: ["name"] },
      ]),
      policies: [p.dropUnsourcedClaims({ topics: ["free cancellation"] })],
    });
    g.recordToolResult({
      turnId: "t1",
      toolName: "searchHotels",
      entity: "hotels",
      key: "hotelId",
      data: [{ hotelId: "H-1", name: "Azul Rooms", freeCancellation: false }],
    });

    const { decision } = g.check(
      {
        id: "h1",
        type: "HotelCard",
        props: { name: ref("hotels.H-1.name"), badge: lit("Free cancellation") },
        children: [],
      },
      CTX,
    );

    expect(decision).toBe("repair");
  });
});

/**
 * Most catalogs model badges and tags as a list, not a single string. A policy
 * that only inspected strings gave those props no claim checking at all, and
 * nulling the whole prop would have discarded the claims the source supports.
 */
describe("claims inside a list prop", () => {
  const listGuard = () => {
    const g = createGuard({
      registry: createRegistry([
        { name: "FlightCard", entity: "fares", key: "fareId", bound: ["price"] },
      ]),
      policies: [
        p.dropUnsourcedClaims({
          topics: ["free cancellation", "refundable"],
          supportedBy: ["fareRules"],
        }),
      ],
    });
    g.recordToolResult({
      turnId: "t1",
      toolName: "searchFlights",
      entity: "fares",
      key: "fareId",
      data: [{ fareId: "F1", price: 412, fareRules: { refundable: true } }],
    });
    return g;
  };

  const card = (badges: unknown) => ({
    id: "c1",
    type: "FlightCard",
    props: { price: ref("fares.F1.price"), badges: lit(badges) },
    children: [],
  });

  it("removes only the unsupported claim and keeps the supported one", () => {
    const { decision, element, trace } = listGuard().check(
      card(["Refundable", "Free cancellation"]),
      CTX,
    );

    expect(decision).toBe("repair");
    // "Refundable" survives because fareRules.refundable is true.
    expect(element?.props.badges).toEqual({ kind: "literal", value: ["Refundable"] });
    expect(trace.results[0]?.reason).toContain("Free cancellation");
    expect(trace.results[0]?.reason).toContain("kept");
  });

  it("leaves a list alone when every claim is supported", () => {
    const { decision } = listGuard().check(card(["Refundable"]), CTX);
    expect(decision).toBe("allow");
  });

  it("empties the list when nothing in it is supported", () => {
    const { decision, element, trace } = listGuard().check(card(["Free cancellation"]), CTX);

    expect(decision).toBe("repair");
    expect(element?.props.badges).toEqual({ kind: "literal", value: [] });
    expect(trace.results[0]?.reason).toContain("emptied");
  });

  it("removes several unsupported claims at once", () => {
    const g = createGuard({
      registry: createRegistry([{ name: "FlightCard" }]),
      policies: [p.dropUnsourcedClaims({ topics: ["free cancellation", "bag included"] })],
    });

    const { element } = g.check(
      {
        id: "c1",
        type: "FlightCard",
        props: { badges: lit(["Nonstop", "Free cancellation", "Bag included"]) },
        children: [],
      },
      CTX,
    );

    expect(element?.props.badges).toEqual({ kind: "literal", value: ["Nonstop"] });
  });

  it("ignores a list that is not all strings", () => {
    const { decision } = listGuard().check(card([1, 2, 3]), CTX);
    expect(decision).toBe("allow");
  });

  it("still handles a single string claim", () => {
    const g = listGuard();
    const { decision, element } = g.check(
      {
        id: "c1",
        type: "FlightCard",
        props: { price: ref("fares.F1.price"), badge: lit("Free cancellation") },
        children: [],
      },
      CTX,
    );

    expect(decision).toBe("repair");
    expect(element?.props.badge).toEqual({ kind: "literal", value: null });
  });
});

/**
 * Field names and claim topics get written in different styles by different
 * people. A topic reads "bag included" while the field is `bagsIncluded`, and
 * matching the raw strings stripped claims the data supported all along.
 */
describe("matching a claim to the field that backs it", () => {
  const g = () => {
    const guard = createGuard({
      registry: createRegistry([
        { name: "FlightCard", entity: "fares", key: "fareId", bound: ["price"] },
      ]),
      policies: [
        p.dropUnsourcedClaims({
          topics: ["free cancellation", "refundable", "bag included"],
          supportedBy: ["fareRules"],
        }),
      ],
    });
    guard.recordToolResult({
      turnId: "t1",
      toolName: "searchFlights",
      entity: "fares",
      key: "fareId",
      data: [
        {
          fareId: "F1",
          price: 412,
          fareRules: { refundable: true, bagsIncluded: 2, changeFee: 0 },
        },
        { fareId: "F2", price: 99, fareRules: { refundable: false, bagsIncluded: 0 } },
      ],
    });
    return guard;
  };

  const card = (fareId: string, badges: string[]) => ({
    id: "c1",
    type: "FlightCard",
    props: { price: ref(`fares.${fareId}.price`), badges: lit(badges) },
    children: [],
  });

  it("matches a prose topic to a camelCase plural field", () => {
    // "bag included" against `bagsIncluded: 2`. Previously stripped.
    const { decision } = g().check(card("F1", ["Bag included"]), CTX);
    expect(decision).toBe("allow");
  });

  it("treats a positive number as support, not just true", () => {
    const { decision } = g().check(card("F1", ["Refundable", "Bag included"]), CTX);
    expect(decision).toBe("allow");
  });

  it("treats zero as no support", () => {
    const { decision, element } = g().check(card("F2", ["Bag included"]), CTX);
    expect(decision).toBe("repair");
    expect(element?.props.badges).toEqual({ kind: "literal", value: [] });
  });

  it("treats false as no support", () => {
    const { decision } = g().check(card("F2", ["Refundable"]), CTX);
    expect(decision).toBe("repair");
  });

  it("keeps the supported claims and drops only the invented one", () => {
    const { decision, element } = g().check(
      card("F1", ["Refundable", "Bag included", "Free cancellation"]),
      CTX,
    );

    expect(decision).toBe("repair");
    expect(element?.props.badges).toEqual({
      kind: "literal",
      value: ["Refundable", "Bag included"],
    });
  });
});
