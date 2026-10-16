import type { GuardElement } from "./types.js";

/**
 * Blocking is a tree edit, not a filter. Removing an element means removing
 * every reference to it, or the renderer receives a dangling id and the host's
 * own validator rejects the spec. Blocking a container therefore removes its
 * subtree, which the trace has to say rather than reporting unrelated blocks.
 */
export type Tree = {
  set(element: GuardElement): void;
  get(id: string): GuardElement | undefined;
  has(id: string): boolean;
  setRoot(id: string): void;
  root(): string | undefined;
  /**
   * Removes `id`, prunes it from every parent's children, and cascades to
   * everything that existed only inside it. Returns the ids removed, with `id`
   * first, so a caller can trace each one back to this decision.
   */
  remove(id: string): string[];
  /** Ids that are no longer reachable from the root. */
  orphans(): string[];
  ids(): string[];
};

export function createTree(): Tree {
  const elements = new Map<string, GuardElement>();
  let rootId: string | undefined;

  const descendants = (id: string, seen = new Set<string>()): string[] => {
    const el = elements.get(id);
    if (!el) return [];
    const out: string[] = [];
    for (const child of el.children) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child, ...descendants(child, seen));
    }
    return out;
  };

  return {
    set(element) {
      elements.set(element.id, element);
    },

    get: (id) => elements.get(id),
    has: (id) => elements.has(id),

    setRoot(id) {
      rootId = id;
    },

    root: () => rootId,

    remove(id) {
      if (!elements.has(id)) return [];

      const removed = [id, ...descendants(id)];
      for (const gone of removed) elements.delete(gone);

      // Prune every reference, not just the parent we expect, because a
      // malformed spec can reference one element from two places.
      const goneSet = new Set(removed);
      for (const [elId, el] of elements) {
        if (!el.children.some((c) => goneSet.has(c))) continue;
        elements.set(elId, {
          ...el,
          children: el.children.filter((c) => !goneSet.has(c)),
        });
      }

      if (rootId !== undefined && goneSet.has(rootId)) rootId = undefined;
      return removed;
    },

    orphans() {
      if (rootId === undefined) return [...elements.keys()];
      const reachable = new Set<string>([rootId, ...descendants(rootId)]);
      return [...elements.keys()].filter((id) => !reachable.has(id));
    },

    ids: () => [...elements.keys()],
  };
}

/** True when no element references an id that is not in the tree. */
export function hasDanglingRefs(tree: Tree): boolean {
  for (const id of tree.ids()) {
    const el = tree.get(id);
    if (!el) continue;
    for (const child of el.children) {
      if (!tree.has(child)) return true;
    }
  }
  return false;
}
