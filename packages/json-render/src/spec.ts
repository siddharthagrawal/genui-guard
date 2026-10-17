import type { ActionBinding, GuardElement, GuardEvent, PropValue } from "@genui-guard/core";
import { pointerToPath } from "./paths.js";
import { fromProps, toProps } from "./props.js";

/**
 * json-render's spec shape as of 0.21.0, declared structurally so the adapter
 * does not depend on its generic parameters. Verified against its published
 * type declarations; the contract tests check it against the real package.
 */
export type JsonRenderSpec = {
  root: string;
  elements: Record<string, JsonRenderElement>;
  state?: Record<string, unknown>;
};

export type JsonRenderElement = {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
  slots?: Record<string, string[]>;
  visible?: unknown;
  on?: Record<string, JsonRenderAction | JsonRenderAction[]>;
  repeat?: unknown;
  watch?: Record<string, unknown>;
};

export type JsonRenderAction = {
  action: string;
  params?: Record<string, unknown>;
  confirm?: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "default" | "danger";
  };
  [key: string]: unknown;
};

/**
 * Children live in two places. `children` is the default slot and `slots` holds
 * named ones, so a cascade has to account for both or blocking a container
 * leaves half its subtree rendered.
 */
export function childIdsOf(element: JsonRenderElement): string[] {
  const named = Object.values(element.slots ?? {}).flat();
  return [...(element.children ?? []), ...named];
}

export function toGuardElement(id: string, element: JsonRenderElement): GuardElement {
  const on: Record<string, ActionBinding> = {};
  for (const [event, binding] of Object.entries(element.on ?? {})) {
    // An event can bind several actions. Core reasons about one action per
    // event, so the first is what it sees and the rest are preserved untouched.
    const first = Array.isArray(binding) ? binding[0] : binding;
    if (!first) continue;
    on[event] = {
      name: first.action,
      ...(first.params ? { params: toProps(first.params) } : {}),
    };
  }

  return {
    id,
    type: element.type,
    props: toProps(element.props ?? {}),
    children: childIdsOf(element),
    ...(Object.keys(on).length > 0 ? { on } : {}),
  };
}

/** Root first, then every element, so a parent is always checked before its children. */
export function specToEvents(spec: JsonRenderSpec): GuardEvent[] {
  const events: GuardEvent[] = [{ kind: "root", id: spec.root }];
  const seen = new Set<string>();

  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const element = spec.elements[id];
    if (!element) return;
    events.push({ kind: "element", id, element: toGuardElement(id, element) });
    for (const child of childIdsOf(element)) visit(child);
  };
  visit(spec.root);

  // Orphans still get checked. An element no parent references should not reach
  // the renderer unexamined just because the spec was malformed.
  for (const id of Object.keys(spec.elements)) visit(id);

  // State is emitted as patches so the guard can screen it, which is the whole
  // point: the model supplies some of this.
  //
  // Keys are normalised first. A state key arrives as a plain key, a dotted
  // path or a JSON Pointer depending on how the model wrote it, and passing a
  // pointer through unnormalised meant "/fares/HA-2041/price" had a root
  // segment of "/fares/HA-2041/price" rather than "fares". Core then found no
  // reserved namespace for it and let the write through, so the fabrication a
  // bound ref resolves against arrived by simply spelling the path differently.
  for (const [key, value] of Object.entries(spec.state ?? {})) {
    events.push({ kind: "state", path: normaliseStateKey(key), value });
  }

  return events;
}

/**
 * Rebuilds a json-render spec from guarded events, preserving every element
 * field core does not model, and pruning dropped ids from `children` and from
 * every named slot.
 */
export function eventsToSpec(
  original: JsonRenderSpec,
  events: GuardEvent[],
  /** Element id to the action names the guard gated, read from its traces. */
  gated: Map<string, string[]> = new Map(),
): { spec: JsonRenderSpec; dropped: string[] } {
  const kept = new Map<string, Record<string, PropValue>>();
  const dropped = new Set<string>();
  const state: Record<string, unknown> = {};
  let root = original.root;

  // Keys were normalised on the way in, so an allowed patch is written back
  // under the key the renderer was given rather than under the guard's form of
  // it. Screening a path is not a licence to rewrite the host's state keys.
  const originalKeys = new Map<string, string>();
  for (const key of Object.keys(original.state ?? {})) {
    originalKeys.set(normaliseStateKey(key), key);
  }

  for (const event of events) {
    if (event.kind === "root") root = event.id;
    else if (event.kind === "element") kept.set(event.id, event.element.props);
    else if (event.kind === "drop") dropped.add(event.id);
    else if (event.kind === "state") {
      state[originalKeys.get(event.path) ?? event.path] = event.value;
    }
  }

  const elements: Record<string, JsonRenderElement> = {};
  for (const [id, props] of kept) {
    const source = original.elements[id];
    if (!source) continue;

    const element: JsonRenderElement = {
      ...source,
      props: fromProps(props, source.props ?? {}),
    };

    if (source.children) {
      element.children = source.children.filter((c) => !dropped.has(c));
    }
    if (source.slots) {
      element.slots = Object.fromEntries(
        Object.entries(source.slots).map(([slot, ids]) => [
          slot,
          ids.filter((c) => !dropped.has(c)),
        ]),
      );
    }

    const gatedActions = gated.get(id);
    if (gatedActions && element.on) element.on = applyConfirm(element.on, gatedActions);

    elements[id] = element;
  }

  return {
    spec: {
      root: dropped.has(root) ? "" : root,
      elements,
      ...(Object.keys(state).length > 0 ? { state } : {}),
    },
    dropped: [...dropped],
  };
}

/**
 * Gating reuses json-render's own confirmation field rather than inventing a
 * second mechanism. The renderer already knows how to show this.
 */
export function applyConfirm(
  on: Record<string, JsonRenderAction | JsonRenderAction[]>,
  actionNames: string[],
): Record<string, JsonRenderAction | JsonRenderAction[]> {
  const names = new Set(actionNames);

  const decorate = (binding: JsonRenderAction): JsonRenderAction =>
    names.has(binding.action) && !binding.confirm
      ? {
          ...binding,
          confirm: {
            title: "Please confirm",
            message: `This will ${binding.action}. Nothing happens until you confirm.`,
            confirmLabel: `Yes, ${binding.action}`,
            cancelLabel: "Cancel",
            variant: "danger" as const,
          },
        }
      : binding;

  return Object.fromEntries(
    Object.entries(on).map(([event, binding]) => [
      event,
      Array.isArray(binding) ? binding.map(decorate) : decorate(binding),
    ]),
  );
}

/** json-render state keys are JSON Pointers in some contexts and plain keys in others. */
export function normaliseStateKey(key: string): string {
  return key.startsWith("/") ? pointerToPath(key) : key;
}
