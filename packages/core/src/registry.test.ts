import { describe, expect, it } from "vitest";
import { createRegistry, defineComponent, lintRegistry } from "./registry.js";
import type { ComponentSpec } from "./types.js";

/** A minimal stand-in for a zod object, which only needs a `shape` accessor. */
const schema = (keys: string[]) => ({
  shape: Object.fromEntries(keys.map((k) => [k, {}])),
}) as unknown as ComponentSpec["props"];

describe("registry", () => {
  it("looks components up by name", () => {
    const r = createRegistry([{ name: "FlightCard" }, { name: "HotelCard" }]);

    expect(r.has("FlightCard")).toBe(true);
    expect(r.has("Nope")).toBe(false);
    expect(r.get("HotelCard")?.name).toBe("HotelCard");
    expect(r.get("Nope")).toBeUndefined();
    expect(r.names().sort()).toEqual(["FlightCard", "HotelCard"]);
  });

  it("lets a later spec replace an earlier one of the same name", () => {
    const r = createRegistry([
      { name: "FlightCard", entity: "old" },
      { name: "FlightCard", entity: "new" },
    ]);

    expect(r.get("FlightCard")?.entity).toBe("new");
    expect(r.names()).toHaveLength(1);
  });

  it("passes a spec through defineComponent unchanged", () => {
    const spec = defineComponent({ name: "X", entity: "xs", key: "xId", bound: ["a"] });
    expect(spec).toEqual({ name: "X", entity: "xs", key: "xId", bound: ["a"] });
  });
});

describe("config linting", () => {
  it("says nothing about a correct registry", () => {
    const r = createRegistry([
      { name: "Stack" },
      { name: "FlightCard", entity: "fares", key: "fareId", bound: ["price"] },
    ]);

    expect(lintRegistry(r)).toEqual([]);
  });

  it("ignores components with no bound props", () => {
    expect(lintRegistry(createRegistry([{ name: "Stack" }]))).toEqual([]);
    expect(lintRegistry(createRegistry([{ name: "Stack", bound: [] }]))).toEqual([]);
  });

  it("catches bound props with no entity, and names them", () => {
    const [err] = lintRegistry(
      createRegistry([{ name: "FlightCard", bound: ["price", "stops"] }]),
    );

    expect(err?.code).toBe("GUARD_E_BOUND_WITHOUT_ENTITY");
    expect(err?.message).toContain("price, stops");
    expect(err?.hint).toContain("entity");
  });

  it("catches an entity with no key", () => {
    const [err] = lintRegistry(
      createRegistry([{ name: "FlightCard", entity: "fares", bound: ["price"] }]),
    );

    expect(err?.code).toBe("GUARD_E_BOUND_WITHOUT_KEY");
    expect(err?.message).toContain("fares");
  });

  it("reports only the entity error when both entity and key are missing", () => {
    // Telling someone to add a key before they have an entity is noise.
    const errs = lintRegistry(createRegistry([{ name: "F", bound: ["price"] }]));

    expect(errs).toHaveLength(1);
    expect(errs[0]?.code).toBe("GUARD_E_BOUND_WITHOUT_ENTITY");
  });

  it("catches a bound prop that is not in the schema, because a typo looks like protection", () => {
    const [err] = lintRegistry(
      createRegistry([
        {
          name: "FlightCard",
          entity: "fares",
          key: "fareId",
          bound: ["prise"],
          props: schema(["price", "airline"]),
        },
      ]),
    );

    expect(err?.code).toBe("GUARD_E_UNKNOWN_BOUND_PROP");
    expect(err?.message).toContain("prise");
  });

  it("accepts bound props that are in the schema", () => {
    const errs = lintRegistry(
      createRegistry([
        {
          name: "FlightCard",
          entity: "fares",
          key: "fareId",
          bound: ["price", "airline"],
          props: schema(["price", "airline", "stops"]),
        },
      ]),
    );

    expect(errs).toEqual([]);
  });

  it("skips the schema check when the host gave no schema", () => {
    const errs = lintRegistry(
      createRegistry([
        { name: "FlightCard", entity: "fares", key: "fareId", bound: ["anything"] },
      ]),
    );

    expect(errs).toEqual([]);
  });

  it("tolerates a props value that is not a zod object", () => {
    for (const props of [null, undefined, 42, {}, { shape: null }, { shape: 7 }]) {
      const errs = lintRegistry(
        createRegistry([
          {
            name: "F",
            entity: "fares",
            key: "fareId",
            bound: ["price"],
            props: props as ComponentSpec["props"],
          },
        ]),
      );
      expect(errs).toEqual([]);
    }
  });

  it("collects errors across several components", () => {
    const errs = lintRegistry(
      createRegistry([
        { name: "A", bound: ["x"] },
        { name: "B", entity: "bs", bound: ["y"] },
        { name: "C", entity: "cs", key: "cId", bound: ["z"] },
      ]),
    );

    expect(errs.map((e) => e.code)).toEqual([
      "GUARD_E_BOUND_WITHOUT_ENTITY",
      "GUARD_E_BOUND_WITHOUT_KEY",
    ]);
  });
});
