import type { GuardEvent } from "@genui-guard/core";
import { describe, expect, it } from "vitest";
import { pathToPointer, pointerToPath } from "./paths.js";
import { fromPropValue, toPropValue } from "./props.js";
import {
  applyConfirm,
  childIdsOf,
  eventsToSpec,
  specToEvents,
  toGuardElement,
  type JsonRenderSpec,
} from "./spec.js";

describe("JSON Pointer translation", () => {
  it("round-trips an ordinary path", () => {
    expect(pointerToPath("/fares/HA-2041/price")).toBe("fares.HA-2041.price");
    expect(pathToPointer("fares.HA-2041.price")).toBe("/fares/HA-2041/price");
  });

  it("handles RFC 6901 escapes, which appear in ids with slashes", () => {
    expect(pointerToPath("/fares/HA~12041/price")).toBe("fares.HA/2041.price");
    expect(pointerToPath("/a~0b")).toBe("a~b");
    expect(pathToPointer("fares.HA/2041")).toBe("/fares/HA~12041");
    expect(pathToPointer("a~b")).toBe("/a~0b");
  });

  it("tolerates empty and root pointers", () => {
    expect(pointerToPath("")).toBe("");
    expect(pointerToPath("/")).toBe("");
    expect(pathToPointer("")).toBe("");
  });
});

describe("prop expression classification", () => {
  it("treats $state and $bindState as references", () => {
    expect(toPropValue({ $state: "/fares/A/price" })).toEqual({
      kind: "ref",
      path: "fares.A.price",
    });
    expect(toPropValue({ $bindState: "/form/name" })).toEqual({
      kind: "ref",
      path: "form.name",
    });
  });

  it("treats every other expression form as an expression, not a reference", () => {
    const forms = [
      { $item: "price" },
      { $index: true },
      { $bindItem: "qty" },
      { $cond: {}, $then: 1, $else: 2 },
      { $computed: "sum", args: {} },
      { $template: "${/fares/A/price}" },
    ];

    for (const form of forms) {
      expect(toPropValue(form).kind, JSON.stringify(form)).toBe("expr");
    }
  });

  it("treats scalars and plain objects as literals", () => {
    expect(toPropValue(412)).toEqual({ kind: "literal", value: 412 });
    expect(toPropValue("Harbor Air")).toEqual({ kind: "literal", value: "Harbor Air" });
    expect(toPropValue(null)).toEqual({ kind: "literal", value: null });
    expect(toPropValue({ padding: 4 })).toEqual({ kind: "literal", value: { padding: 4 } });
  });

  it("writes a reference back in the form it arrived in", () => {
    const asState = fromPropValue({ kind: "ref", path: "a.b" }, { $state: "/a/b" });
    const asBind = fromPropValue({ kind: "ref", path: "a.b" }, { $bindState: "/a/b" });

    expect(asState).toEqual({ $state: "/a/b" });
    expect(asBind).toEqual({ $bindState: "/a/b" });
  });
});

describe("children across default and named slots", () => {
  it("collects ids from children and every slot", () => {
    expect(
      childIdsOf({
        type: "Layout",
        props: {},
        children: ["a"],
        slots: { header: ["h1"], footer: ["f1", "f2"] },
      }),
    ).toEqual(["a", "h1", "f1", "f2"]);
  });

  it("reports children to core so a cascade reaches slotted elements", () => {
    const element = toGuardElement("l1", {
      type: "Layout",
      props: {},
      slots: { header: ["h1"] },
    });

    expect(element.children).toEqual(["h1"]);
  });

  /** Blocking has to prune both, or half the subtree stays referenced. */
  it("prunes dropped ids from named slots as well as children", () => {
    const spec: JsonRenderSpec = {
      root: "root",
      elements: {
        root: {
          type: "Layout",
          props: {},
          children: ["body"],
          slots: { header: ["h1", "h2"] },
        },
        body: { type: "Stack", props: {} },
        h1: { type: "Stack", props: {} },
        h2: { type: "Stack", props: {} },
      },
    };

    const events: GuardEvent[] = [
      { kind: "root", id: "root" },
      { kind: "element", id: "root", element: toGuardElement("root", spec.elements.root!) },
      { kind: "element", id: "h2", element: toGuardElement("h2", spec.elements.h2!) },
      { kind: "drop", id: "h1", reason: "blocked" },
      { kind: "drop", id: "body", reason: "blocked" },
    ];

    const { spec: out, dropped } = eventsToSpec(spec, events);

    expect(dropped.sort()).toEqual(["body", "h1"]);
    expect(out.elements.root?.slots?.header).toEqual(["h2"]);
    expect(out.elements.root?.children).toEqual([]);
  });

  it("preserves element fields core does not model", () => {
    const spec: JsonRenderSpec = {
      root: "root",
      elements: {
        root: {
          type: "Stack",
          props: { gap: 2 },
          children: [],
          visible: { path: "/ui/open", equals: true },
          repeat: { statePath: "/items" },
          watch: { "/a": { action: "refresh" } },
        },
      },
    };

    const { spec: out } = eventsToSpec(spec, specToEvents(spec));

    expect(out.elements.root?.visible).toEqual({ path: "/ui/open", equals: true });
    expect(out.elements.root?.repeat).toEqual({ statePath: "/items" });
    expect(out.elements.root?.watch).toEqual({ "/a": { action: "refresh" } });
  });

  it("checks orphaned elements rather than letting them through unexamined", () => {
    const spec: JsonRenderSpec = {
      root: "root",
      elements: {
        root: { type: "Stack", props: {}, children: [] },
        stray: { type: "Stack", props: {} },
      },
    };

    const ids = specToEvents(spec)
      .filter((e) => e.kind === "element")
      .map((e) => e.id);

    expect(ids).toContain("stray");
  });

  it("survives a cycle in children", () => {
    const spec: JsonRenderSpec = {
      root: "a",
      elements: {
        a: { type: "Stack", props: {}, children: ["b"] },
        b: { type: "Stack", props: {}, children: ["a"] },
      },
    };

    expect(() => specToEvents(spec)).not.toThrow();
    expect(specToEvents(spec).filter((e) => e.kind === "element")).toHaveLength(2);
  });

  it("empties the root when the root itself was dropped", () => {
    const spec: JsonRenderSpec = {
      root: "root",
      elements: { root: { type: "Stack", props: {} } },
    };

    const { spec: out } = eventsToSpec(spec, [
      { kind: "root", id: "root" },
      { kind: "drop", id: "root", reason: "blocked" },
    ]);

    expect(out.root).toBe("");
    expect(out.elements).toEqual({});
  });
});

describe("gating via json-render's confirm field", () => {
  it("adds a confirmation to a gated action", () => {
    const out = applyConfirm({ press: { action: "book" } }, ["book"]);
    const binding = out.press as { confirm?: { title: string; variant?: string } };

    expect(binding.confirm?.variant).toBe("danger");
    expect(binding.confirm?.title).toBe("Please confirm");
  });

  it("leaves actions that were not gated alone", () => {
    const out = applyConfirm({ press: { action: "filter" } }, ["book"]);
    expect((out.press as { confirm?: unknown }).confirm).toBeUndefined();
  });

  it("does not overwrite a confirmation the host already wrote", () => {
    const existing = { title: "Host's own", message: "Keep me" };
    const out = applyConfirm({ press: { action: "book", confirm: existing } }, ["book"]);

    expect((out.press as { confirm?: unknown }).confirm).toEqual(existing);
  });

  it("handles an event bound to several actions", () => {
    const out = applyConfirm({ press: [{ action: "log" }, { action: "book" }] }, ["book"]);
    const bindings = out.press as { action: string; confirm?: unknown }[];

    expect(bindings[0]?.confirm).toBeUndefined();
    expect(bindings[1]?.confirm).toBeDefined();
  });

  it("reads the first action of an array into the guard's view", () => {
    const element = toGuardElement("s1", {
      type: "TripSummary",
      props: {},
      on: { press: [{ action: "book" }, { action: "log" }] },
    });

    expect(element.on?.press?.name).toBe("book");
  });
});

/**
 * The eval suites found this. A model that writes a state key as a JSON Pointer
 * rather than as a plain key used to skip the reserved-namespace screen
 * entirely, because the whole pointer became the root segment and core found no
 * namespace by that name. The fabrication then sat behind a bound ref, which is
 * the failure that looks most legitimate.
 */
describe("state keys, however the model spells them", () => {
  const forms = {
    plain: "fares",
    dotted: "fares.HA-2041.price",
    pointer: "/fares/HA-2041/price",
  };

  it("normalises every form to a dotted path before core sees it", () => {
    for (const key of Object.values(forms)) {
      const events = specToEvents({ root: "r", elements: {}, state: { [key]: 1 } });
      const state = events.find((e) => e.kind === "state");

      expect(state).toBeDefined();
      expect(state?.kind === "state" && state.path.startsWith("fares")).toBe(true);
      expect(state?.kind === "state" && state.path.includes("/")).toBe(false);
    }
  });

  it("writes an allowed patch back under the key the renderer was given", () => {
    const spec: JsonRenderSpec = {
      root: "root",
      elements: { root: { type: "Stack", props: {}, children: [] } },
      state: { "/ui/tab": "flights" },
    };

    const { spec: out } = eventsToSpec(spec, specToEvents(spec));

    expect(out.state).toEqual({ "/ui/tab": "flights" });
  });
});
