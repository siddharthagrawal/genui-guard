import { describe, expect, it } from "vitest";
import { createTree, hasDanglingRefs, type Tree } from "./tree.js";
import type { GuardElement } from "./types.js";

const el = (id: string, children: string[] = []): GuardElement => ({
  id,
  type: "Stack",
  props: {},
  children,
});

/**
 *   root
 *   ├── results
 *   │   ├── card-a
 *   │   └── card-b
 *   └── sidebar
 *       └── summary
 */
function threeLevels(): Tree {
  const t = createTree();
  t.set(el("root", ["results", "sidebar"]));
  t.set(el("results", ["card-a", "card-b"]));
  t.set(el("card-a"));
  t.set(el("card-b"));
  t.set(el("sidebar", ["summary"]));
  t.set(el("summary"));
  t.setRoot("root");
  return t;
}

describe("blocking as a tree edit", () => {
  it("removes a leaf and prunes it from its parent", () => {
    const t = threeLevels();
    expect(t.remove("card-a")).toEqual(["card-a"]);

    expect(t.has("card-a")).toBe(false);
    expect(t.get("results")?.children).toEqual(["card-b"]);
    expect(hasDanglingRefs(t)).toBe(false);
  });

  it("cascades through a three level tree when a container is blocked", () => {
    const t = threeLevels();
    const removed = t.remove("results");

    expect(removed[0]).toBe("results");
    expect(removed.sort()).toEqual(["card-a", "card-b", "results"]);
    expect(t.get("root")?.children).toEqual(["sidebar"]);
    expect(hasDanglingRefs(t)).toBe(false);
  });

  it("never leaves a dangling reference behind", () => {
    const t = threeLevels();
    t.remove("sidebar");

    expect(hasDanglingRefs(t)).toBe(false);
    expect(t.ids().sort()).toEqual(["card-a", "card-b", "results", "root"]);
  });

  it("prunes an element referenced from two parents", () => {
    // A malformed spec can do this, so pruning cannot assume one parent.
    const t = createTree();
    t.set(el("root", ["a", "b"]));
    t.set(el("a", ["shared"]));
    t.set(el("b", ["shared"]));
    t.set(el("shared"));
    t.setRoot("root");

    t.remove("shared");

    expect(t.get("a")?.children).toEqual([]);
    expect(t.get("b")?.children).toEqual([]);
    expect(hasDanglingRefs(t)).toBe(false);
  });

  it("clears the root when the root itself is blocked", () => {
    const t = threeLevels();
    const removed = t.remove("root");

    expect(removed).toHaveLength(6);
    expect(t.root()).toBeUndefined();
    expect(t.ids()).toEqual([]);
  });

  it("is a no-op for an id that is not there", () => {
    const t = threeLevels();
    expect(t.remove("ghost")).toEqual([]);
    expect(t.ids()).toHaveLength(6);
  });

  it("survives a cycle rather than recursing forever", () => {
    const t = createTree();
    t.set(el("a", ["b"]));
    t.set(el("b", ["a"]));
    t.setRoot("a");

    expect(() => t.remove("a")).not.toThrow();
    expect(t.ids()).toEqual([]);
  });
});

describe("reachability", () => {
  it("finds nothing orphaned in a well formed tree", () => {
    expect(threeLevels().orphans()).toEqual([]);
  });

  it("reports an element no parent references", () => {
    const t = threeLevels();
    t.set(el("stray"));

    expect(t.orphans()).toEqual(["stray"]);
  });

  it("treats everything as orphaned with no root", () => {
    const t = createTree();
    t.set(el("a"));
    expect(t.orphans()).toEqual(["a"]);
  });

  it("detects a dangling reference when one is introduced", () => {
    const t = createTree();
    t.set(el("root", ["missing"]));
    t.setRoot("root");

    expect(hasDanglingRefs(t)).toBe(true);
  });
});
