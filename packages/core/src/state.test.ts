import { describe, expect, it } from "vitest";
import { GuardError } from "./errors.js";
import { createTurnState, recordPrefix, splitPath } from "./state.js";

const FARES = [
  { fareId: "HA-2041", airline: "Harbor Air", price: 412, stops: 1, seatsLeft: 4 },
  { fareId: "HA-3388", airline: "Harbor Air", price: 655, stops: 0, seatsLeft: 0 },
];

const record = (over = {}) => ({
  turnId: "t1",
  toolName: "searchFlights",
  entity: "fares",
  key: "fareId",
  data: FARES,
  ...over,
});

describe("reserved state namespaces", () => {
  it("resolves a bound path against host data", () => {
    const s = createTurnState("t1");
    s.reserve(record());

    expect(s.resolveHost("fares.HA-2041.price")).toEqual({ found: true, value: 412 });
    expect(s.resolveHost("fares.HA-2041.airline").value).toBe("Harbor Air");
  });

  it("reports a path outside any reserved namespace", () => {
    const s = createTurnState("t1");
    s.reserve(record());

    expect(s.isReserved("fares.HA-2041.price")).toBe(true);
    expect(s.isReserved("ui.dialogOpen")).toBe(false);
    expect(s.ownerEntity("fares.anything")).toBe("fares");
    expect(s.ownerEntity("hotels.anything")).toBeUndefined();
  });

  it("accepts data already keyed by identifier", () => {
    const s = createTurnState("t1");
    s.reserve(record({ data: { "HA-9": { fareId: "HA-9", price: 100 } }, key: undefined }));

    expect(s.resolveHost("fares.HA-9.price").value).toBe(100);
  });

  it("refuses an array with no key, because position is what a model gets wrong", () => {
    const s = createTurnState("t1");
    expect(() => s.reserve(record({ key: undefined }))).toThrow(GuardError);
  });

  it("refuses a scalar where a collection belongs, and says what to pass", () => {
    const s = createTurnState("t1");
    try {
      s.reserve(record({ data: 42 }));
      expect.unreachable();
    } catch (e) {
      const err = e as GuardError;
      expect(err.code).toBe("GUARD_E_ENTITY_NOT_COLLECTION");
      expect(err.hint).toContain("collection");
    }
  });

  it("refuses two results claiming one namespace", () => {
    const s = createTurnState("t1");
    s.reserve(record());
    try {
      s.reserve(record({ toolName: "searchFlightsAgain" }));
      expect.unreachable();
    } catch (e) {
      expect((e as GuardError).code).toBe("GUARD_E_DUPLICATE_ENTITY");
    }
  });
});

/**
 * The invariant everything else rests on. See docs/concepts.md and the
 * state-ownership entry in docs/decisions.md.
 */
describe("model state patches", () => {
  it("rejects a patch that changes data in a reserved namespace", () => {
    const s = createTurnState("t1");
    s.reserve(record());

    expect(s.applyModelPatch("fares.HA-2041.price", 189)).toBe("rejected");
  });

  it("calls a patch redundant when it repeats what the host loaded", () => {
    // Not a violation. The model re-sent the same value, so nothing was
    // fabricated, and reporting it as a block would overstate what happened.
    const s = createTurnState("t1");
    s.reserve(record());

    expect(s.applyModelPatch("fares.HA-2041.price", 412)).toBe("redundant");
    expect(s.applyModelPatch("fares.HA-2041", FARES[0])).toBe("redundant");
  });

  it("leaves host data intact after a rejected patch", () => {
    const s = createTurnState("t1");
    s.reserve(record());
    s.applyModelPatch("fares.HA-2041.price", 189);

    // The whole point: the bound ref still resolves to what the API said.
    expect(s.resolveHost("fares.HA-2041.price").value).toBe(412);
    expect(s.resolveAny("fares.HA-2041.price").value).toBe(412);
  });

  it("rejects a patch that would create a new record in a reserved namespace", () => {
    const s = createTurnState("t1");
    s.reserve(record());

    expect(s.applyModelPatch("fares.INVENTED", { fareId: "INVENTED", price: 1 })).toBe(
      "rejected",
    );
    expect(s.resolveHost("fares.INVENTED.price").found).toBe(false);
  });

  it("rejects a patch replacing the whole namespace", () => {
    const s = createTurnState("t1");
    s.reserve(record());

    expect(s.applyModelPatch("fares", {})).toBe("rejected");
    expect(s.resolveHost("fares.HA-2041.price").value).toBe(412);
  });

  it("allows patches outside reserved namespaces, so interactive state still works", () => {
    const s = createTurnState("t1");
    s.reserve(record());

    expect(s.applyModelPatch("ui.dialogOpen", true)).toBe("allowed");
    expect(s.applyModelPatch("search.query", "Lisbon")).toBe("allowed");
    expect(s.resolveAny("ui.dialogOpen").value).toBe(true);
    expect(s.resolveAny("search.query").value).toBe("Lisbon");
  });

  it("creates intermediate objects for a nested unreserved path", () => {
    const s = createTurnState("t1");
    expect(s.applyModelPatch("a.b.c", 1)).toBe("allowed");
    expect(s.resolveAny("a.b.c").value).toBe(1);
  });

  it("rejects an empty path", () => {
    const s = createTurnState("t1");
    expect(s.applyModelPatch("", 1)).toBe("rejected");
  });
});

describe("path helpers", () => {
  it("splits and ignores empty segments", () => {
    expect(splitPath("fares.HA-2041.price")).toEqual(["fares", "HA-2041", "price"]);
    expect(splitPath("..a..b..")).toEqual(["a", "b"]);
  });

  it("takes the record prefix, which is how coherence is checked", () => {
    expect(recordPrefix("fares.HA-2041.price")).toBe("fares.HA-2041");
    expect(recordPrefix("fares.HA-2041")).toBe("fares.HA-2041");
    expect(recordPrefix("fares")).toBeUndefined();
  });

  it("resolves array indices but not names", () => {
    const s = createTurnState("t1");
    s.reserve({
      turnId: "t1",
      toolName: "x",
      entity: "bag",
      data: { items: [{ n: 1 }, { n: 2 }] },
    });

    expect(s.resolveHost("bag.items.1.n").value).toBe(2);
    expect(s.resolveHost("bag.items.nope.n").found).toBe(false);
    expect(s.resolveHost("bag.items.9.n").found).toBe(false);
  });

  it("reports a missing field rather than guessing", () => {
    const s = createTurnState("t1");
    s.reserve(record());

    expect(s.resolveHost("fares.HA-2041.refundable").found).toBe(false);
    expect(s.resolveHost("fares.NOPE.price").found).toBe(false);
  });

  it("tracks whether anything was recorded at all", () => {
    const s = createTurnState("t1");
    expect(s.hasAnyResult()).toBe(false);
    s.reserve(record());
    expect(s.hasAnyResult()).toBe(true);
    expect(s.reservedNamespaces()).toEqual(["fares"]);
  });
});
