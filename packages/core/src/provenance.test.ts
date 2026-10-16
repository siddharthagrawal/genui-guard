import { beforeEach, describe, expect, it } from "vitest";
import { checkProvenance } from "./provenance.js";
import { createTurnState, type TurnState } from "./state.js";
import type { ComponentSpec, GuardElement, PropValue } from "./types.js";

const FARES = [
  { fareId: "HA-2041", airline: "Harbor Air", price: 412, stops: 1, seatsLeft: 4 },
  { fareId: "HA-3388", airline: "Coastline", price: 655, stops: 0, seatsLeft: 0 },
];

const SPEC: ComponentSpec = {
  name: "FlightCard",
  entity: "fares",
  key: "fareId",
  bound: ["airline", "price", "stops"],
};

const ref = (path: string): PropValue => ({ kind: "ref", path });
const lit = (value: unknown): PropValue => ({ kind: "literal", value });

const element = (props: Record<string, PropValue>): GuardElement => ({
  id: "e1",
  type: "FlightCard",
  props,
  children: [],
});

const good = {
  airline: ref("fares.HA-2041.airline"),
  price: ref("fares.HA-2041.price"),
  stops: ref("fares.HA-2041.stops"),
};

let state: TurnState;
beforeEach(() => {
  state = createTurnState("t1");
  state.reserve({
    turnId: "t1",
    toolName: "searchFlights",
    entity: "fares",
    key: "fareId",
    data: FARES,
  });
});

describe("provenance", () => {
  it("allows props that reference host data", () => {
    expect(checkProvenance(element(good), SPEC, state)).toEqual([]);
  });

  it("ignores components with no bound props", () => {
    const spec: ComponentSpec = { name: "Stack" };
    expect(checkProvenance(element({ gap: lit(4) }), spec, state)).toEqual([]);
  });

  it("blocks a literal in a bound prop and says what to do", () => {
    const [r] = checkProvenance(element({ ...good, price: lit(189) }), SPEC, state);

    expect(r?.decision).toBe("block");
    expect(r?.reason).toContain("FlightCard.price");
    expect(r?.reason).toContain("literal");
    expect(r?.reason).toContain("fares");
  });

  it("blocks an expression in a bound prop", () => {
    const [r] = checkProvenance(
      element({ ...good, price: { kind: "expr", raw: { $template: "${x}" } } }),
      SPEC,
      state,
    );

    expect(r?.decision).toBe("block");
    expect(r?.reason).toContain("expression");
  });

  it("blocks a missing bound prop", () => {
    const { price: _drop, ...rest } = good;
    const [r] = checkProvenance(element(rest), SPEC, state);

    expect(r?.decision).toBe("block");
    expect(r?.reason).toContain("missing");
  });

  it("blocks a ref outside every reserved namespace", () => {
    const [r] = checkProvenance(
      element({ ...good, price: ref("ui.madeUpPrice") }),
      SPEC,
      state,
    );

    expect(r?.decision).toBe("block");
    expect(r?.reason).toContain("outside the data the host loaded");
  });

  it("blocks a ref into the wrong entity", () => {
    state.reserve({
      turnId: "t1",
      toolName: "searchHotels",
      entity: "hotels",
      key: "hotelId",
      data: [{ hotelId: "H1", price: 90 }],
    });
    const [r] = checkProvenance(
      element({ ...good, price: ref("hotels.H1.price") }),
      SPEC,
      state,
    );

    expect(r?.decision).toBe("block");
    expect(r?.reason).toContain("backed by fares");
  });

  it("blocks a ref to a field that does not exist", () => {
    const [r] = checkProvenance(
      element({ ...good, price: ref("fares.HA-2041.nope") }),
      SPEC,
      state,
    );

    expect(r?.decision).toBe("block");
    expect(r?.reason).toContain("does not exist");
  });

  it("blocks a ref to a record that was never returned", () => {
    const [r] = checkProvenance(
      element({
        airline: ref("fares.GHOST.airline"),
        price: ref("fares.GHOST.price"),
        stops: ref("fares.GHOST.stops"),
      }),
      SPEC,
      state,
    );

    expect(r?.decision).toBe("block");
    expect(r?.reason).toContain("does not exist");
  });

  /**
   * The transposition failure, and the most realistic one. Each ref is valid on
   * its own, so nothing short of a coherence check catches it.
   */
  it("blocks a card that mixes two records", () => {
    const results = checkProvenance(
      element({
        airline: ref("fares.HA-2041.airline"),
        price: ref("fares.HA-3388.price"),
        stops: ref("fares.HA-2041.stops"),
      }),
      SPEC,
      state,
    );

    const mixed = results.find((r) => r.reason.includes("different records"));
    expect(mixed?.decision).toBe("block");
    expect(mixed?.reason).toContain("fares.HA-2041");
    expect(mixed?.reason).toContain("fares.HA-3388");
  });

  it("reports every bad bound prop rather than stopping at the first", () => {
    const results = checkProvenance(
      element({ airline: lit("Harbor Air"), price: lit(189), stops: lit(0) }),
      SPEC,
      state,
    );

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.decision === "block")).toBe(true);
  });

  it("blocks when the record exists but its key disagrees with the path", () => {
    // Data keyed under an id that does not match the record's own key field.
    // Every ref resolves, so only the key check catches it.
    const s = createTurnState("t2");
    s.reserve({
      turnId: "t2",
      toolName: "searchFlights",
      entity: "fares",
      data: { "WRONG-ID": { fareId: "HA-2041", airline: "Harbor Air", price: 412, stops: 1 } },
    });

    const results = checkProvenance(
      element({
        airline: ref("fares.WRONG-ID.airline"),
        price: ref("fares.WRONG-ID.price"),
        stops: ref("fares.WRONG-ID.stops"),
      }),
      SPEC,
      s,
    );

    const mismatch = results.find((r) => r.reason.includes("fareId"));
    expect(mismatch?.decision).toBe("block");
    expect(mismatch?.reason).toContain("HA-2041");
  });

  it("blocks when the claimed record is absent from a reserved namespace", () => {
    const s = createTurnState("t3");
    s.reserve({
      turnId: "t3",
      toolName: "searchFlights",
      entity: "fares",
      data: { "HA-2041": { fareId: "HA-2041", airline: "Harbor Air", price: 412, stops: 1 } },
    });

    // The namespace exists and the prefix is well formed, but there is no such
    // record, which is a different failure from a missing field.
    const results = checkProvenance(
      element({
        airline: ref("fares.HA-2041.airline"),
        price: ref("fares.HA-2041.price"),
        stops: ref("fares.HA-2041.stops"),
      }),
      SPEC,
      s,
    );
    expect(results).toEqual([]);
  });

  it("survives a state patch trying to overwrite the referenced price", () => {
    // Identical to the happy path, except the model also tried to rewrite the
    // data behind the ref. The patch is rejected, so this still passes clean.
    expect(state.applyModelPatch("fares.HA-2041.price", 189)).toBe("rejected");
    expect(checkProvenance(element(good), SPEC, state)).toEqual([]);
    expect(state.resolveHost("fares.HA-2041.price").value).toBe(412);
  });
});
