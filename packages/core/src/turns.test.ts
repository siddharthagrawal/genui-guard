import { describe, expect, it } from "vitest";
import { GuardError } from "./errors.js";
import { createGuard } from "./guard.js";
import { createRegistry } from "./registry.js";
import type { Ctx, Guard, GuardElement, PropValue } from "./types.js";

/**
 * Turn boundaries, which nothing in the eval suites can see: every case there
 * is a single turn, so the whole of this behaviour was unmeasured.
 *
 * A turn is one round of the conversation. The user asks, the host searches,
 * the model composes, the page appears. Trust is scoped to that round, and the
 * two failures worth testing are its edges: a follow-up that searches nothing,
 * and data that is still around long after it was fetched.
 */

const FARES = [{ fareId: "A", airline: "Harbor Air", price: 412, seatsLeft: 4 }];

const registry = createRegistry([
  { name: "FlightCard", entity: "fares", key: "fareId", bound: ["price"] },
]);

const ref = (path: string): PropValue => ({ kind: "ref", path });
const card = (id = "c1"): GuardElement => ({
  id,
  type: "FlightCard",
  props: { price: ref("fares.A.price") },
  children: [],
});

function record(guard: Guard, turnId: string, at?: number, price = 412): void {
  guard.recordToolResult({
    turnId,
    toolName: "searchFlights",
    entity: "fares",
    key: "fareId",
    data: [{ ...FARES[0]!, price }],
    ...(at === undefined ? {} : { at }),
  });
}

describe("a follow-up turn that searches nothing", () => {
  /** "Book the second one." The host did nothing wrong. */
  it("explains that re-recording is how data carries forward", () => {
    const guard = createGuard({ registry });
    record(guard, "turn-1");

    try {
      guard.check(card(), { turnId: "turn-2" });
      expect.unreachable();
    } catch (e) {
      const err = e as GuardError;
      expect(err.code).toBe("GUARD_E_NO_TOOL_RESULT");
      expect(err.hint).toContain("book the second one");
      expect(err.hint).toContain("re-recording");
    }
  });

  it("works once the host hands the same results over again", () => {
    const guard = createGuard({ registry });
    record(guard, "turn-1");
    record(guard, "turn-2");

    expect(guard.check(card(), { turnId: "turn-2" }).decision).toBe("allow");
  });

  /** Replaying a previous turn's results is not a conflict. */
  it("accepts the same data recorded twice in one turn", () => {
    const guard = createGuard({ registry });
    record(guard, "turn-1");

    expect(() => record(guard, "turn-1")).not.toThrow();
    expect(guard.check(card(), { turnId: "turn-1" }).decision).toBe("allow");
  });

  it("still refuses two different results claiming one namespace", () => {
    const guard = createGuard({ registry });
    record(guard, "turn-1", undefined, 412);

    try {
      record(guard, "turn-1", undefined, 999);
      expect.unreachable();
    } catch (e) {
      expect((e as GuardError).code).toBe("GUARD_E_DUPLICATE_ENTITY");
    }
  });
});

describe("data that is older than the host tolerates", () => {
  const minute = 60_000;

  function aged(ageMs: number, staleAfterMs?: number): ReturnType<Guard["check"]> {
    const guard = createGuard({
      registry,
      ...(staleAfterMs === undefined ? {} : { staleAfterMs }),
    });
    const loadedAt = 1_000_000;
    record(guard, "t", loadedAt);
    const ctx: Ctx = { turnId: "t", now: loadedAt + ageMs };
    return guard.check(card(), ctx);
  }

  /**
   * Annotated, never blocked. The card is probably still right, hiding it
   * leaves an unexplained gap, and the authoritative check belongs at the
   * transaction. See docs/decisions.md.
   */
  it("annotates rather than withholding", () => {
    const { decision, element } = aged(9 * minute, 5 * minute);

    expect(decision).toBe("annotate");
    expect(element).not.toBeNull();
  });

  it("says how old the data is and what the limit was", () => {
    const { trace } = aged(9 * minute, 5 * minute);
    const reason = trace.results.find((r) => r.policy === "freshness")?.reason ?? "";

    expect(reason).toContain("9m");
    expect(reason).toContain("5m");
    expect(reason).toContain("fares");
  });

  it("leaves fresh data alone", () => {
    expect(aged(minute, 5 * minute).decision).toBe("allow");
  });

  it("checks nothing when the host set no tolerance", () => {
    expect(aged(10 * 60 * minute).decision).toBe("allow");
  });

  it("checks nothing when the host did not say when it loaded the data", () => {
    const guard = createGuard({ registry, staleAfterMs: 1 });
    record(guard, "t");
    expect(guard.check(card(), { turnId: "t", now: 9_999_999 }).decision).toBe("allow");
  });

  /** Core reads no clock, so the same turn replays to the same verdict. */
  it("checks nothing when the host did not supply a time", () => {
    const guard = createGuard({ registry, staleAfterMs: 1 });
    record(guard, "t", 1_000);
    expect(guard.check(card(), { turnId: "t" }).decision).toBe("allow");
  });
});

describe("releasing turns", () => {
  it("forgets a turn on request", () => {
    const guard = createGuard({ registry });
    record(guard, "t1");
    guard.check(card(), { turnId: "t1" });
    expect(guard.traces("t1").length).toBeGreaterThan(0);

    guard.endTurn("t1");
    expect(guard.traces("t1")).toEqual([]);
  });

  /** A guard held for the life of a server used to keep every turn forever. */
  it("evicts the oldest turn once the bound is passed", () => {
    const guard = createGuard({ registry, maxTurns: 3 });
    for (const id of ["t1", "t2", "t3", "t4"]) record(guard, id);

    // t1 is gone, so its data no longer validates anything.
    expect(() => guard.check(card(), { turnId: "t1" })).toThrow(/No tool result/);
    expect(guard.check(card(), { turnId: "t4" }).decision).toBe("allow");
  });

  it("keeps the turns inside the bound", () => {
    const guard = createGuard({ registry, maxTurns: 3 });
    for (const id of ["t1", "t2", "t3"]) record(guard, id);

    for (const id of ["t1", "t2", "t3"]) {
      expect(guard.check(card(), { turnId: id }).decision).toBe("allow");
    }
  });

  it("refuses a bound that is not a whole number of turns", () => {
    expect(() => createGuard({ registry, maxTurns: 0 })).toThrow(GuardError);
    expect(() => createGuard({ registry, maxTurns: 2.5 })).toThrow(/whole number/);
  });
});

/**
 * Eviction used to take out turns that were still in flight, and worse, a check
 * against an evicted turn created an empty state for it, which evicted another
 * live turn, which was then checked. One eviction became total failure under
 * nothing more exotic than burst load.
 */
describe("eviction under load", () => {
  it("does not cascade when a turn has already been evicted", () => {
    const guard = createGuard({ registry, maxTurns: 3 });
    for (const id of ["r1", "r2", "r3"]) record(guard, id);
    record(guard, "r4");

    // r1 is gone, which is the documented cost of exceeding the bound.
    expect(() => guard.check(card(), { turnId: "r1" })).toThrow(/No tool result/);

    // The three turns inside the bound still work, which is the part that broke.
    for (const id of ["r2", "r3", "r4"]) {
      expect(guard.check(card(), { turnId: id }).decision).toBe("allow");
    }
  });

  it("never evicts the turn being opened", () => {
    const guard = createGuard({ registry, maxTurns: 1 });
    record(guard, "a");
    record(guard, "b");

    expect(guard.check(card(), { turnId: "b" }).decision).toBe("allow");
  });

  /**
   * It reaches onTrace and not traces("a"), because the turn is released in the
   * same breath. That is the contract: a released turn has no traces to read,
   * so an eviction has to be announced as it happens.
   */
  it("announces an eviction nobody asked for through onTrace", () => {
    const seen: string[] = [];
    const guard = createGuard({
      registry,
      maxTurns: 1,
      onTrace: (entry) => {
        if ("path" in entry) seen.push(entry.reason);
      },
    });
    record(guard, "a");
    record(guard, "b");

    expect(seen.join("\n")).toContain("raise maxTurns");
    expect(guard.traces("a")).toEqual([]);
  });

  /** Checking an unknown turn must not quietly take a slot from a live one. */
  it("does not open a turn on a read", () => {
    const guard = createGuard({ registry, maxTurns: 2 });
    record(guard, "a");
    record(guard, "b");

    for (const unknown of ["x", "y", "z"]) {
      expect(() => guard.check(card(), { turnId: unknown })).toThrow(/No tool result/);
    }

    expect(guard.check(card(), { turnId: "a" }).decision).toBe("allow");
    expect(guard.check(card(), { turnId: "b" }).decision).toBe("allow");
  });
});
