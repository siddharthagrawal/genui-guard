import type {
  Ctx,
  Guard,
  GuardElement,
  GuardEvent,
  StateTraceEntry,
  TraceEntry,
} from "@genui-guard/core";
import {
  eventsToSpec,
  specToEvents,
  type JsonRenderElement,
  type JsonRenderSpec,
} from "./spec.js";

export type GuardedSpec = {
  spec: JsonRenderSpec;
  dropped: string[];
  traces: (TraceEntry | StateTraceEntry)[];
};

/**
 * Runs a whole json-render spec through the guard and returns one that is safe
 * to render. This is the single line a host adds, and deleting it is how a host
 * removes genui-guard.
 */
export async function guardSpec(
  guard: Guard,
  spec: JsonRenderSpec,
  ctx: Ctx,
): Promise<GuardedSpec> {
  const before = guard.traces(ctx.turnId).length;

  const input = new ReadableStream<GuardEvent>({
    start(controller) {
      for (const event of specToEvents(spec)) controller.enqueue(event);
      controller.close();
    },
  });

  const out: GuardEvent[] = [];
  const reader = input.pipeThrough(guard.stream(ctx)).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }

  const traces = guard.traces(ctx.turnId).slice(before);
  const result = eventsToSpec(spec, out, gatedActionsFrom(traces));

  return { ...result, traces };
}

/**
 * Gating is applied by the adapter rather than by core, because the way a
 * confirmation is expressed belongs to the renderer. json-render already has a
 * `confirm` field, so the gate sets theirs instead of inventing one.
 */
export function gatedActionsFrom(
  traces: (TraceEntry | StateTraceEntry)[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();

  for (const entry of traces) {
    if (!("results" in entry)) continue;
    const names = entry.results
      .filter((r) => r.decision === "gate")
      .flatMap((r) => r.gatedActions ?? []);
    if (names.length > 0) out.set(entry.elementId, [...new Set(names)]);
  }

  return out;
}

/**
 * Live mode variant. The model streams JSONL patches rather than a whole spec,
 * so there is no original spec to reassemble against. Elements are collected
 * from the guarded event stream itself.
 */
export async function guardEvents(
  guard: Guard,
  events: GuardEvent[],
  ctx: Ctx,
): Promise<GuardedSpec> {
  const before = guard.traces(ctx.turnId).length;

  const input = new ReadableStream<GuardEvent>({
    start(controller) {
      for (const event of events) controller.enqueue(event);
      controller.close();
    },
  });

  const out: GuardEvent[] = [];
  const reader = input.pipeThrough(guard.stream(ctx)).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }

  const traces = guard.traces(ctx.turnId).slice(before);
  const gated = gatedActionsFrom(traces);

  // Rebuild an original-shaped spec from the inbound events, so the existing
  // reassembly path can prune and apply confirmations exactly as it does for a
  // recorded turn.
  const original: JsonRenderSpec = { root: "", elements: {}, state: {} };
  for (const event of events) {
    if (event.kind === "root") original.root = event.id;
    else if (event.kind === "element") original.elements[event.id] = fromGuardElement(event.element);
    else if (event.kind === "state") (original.state ??= {})[event.path] = event.value;
  }

  const result = eventsToSpec(original, out, gated);
  return { ...result, traces };
}

/** Back to json-render's element shape, for the reassembly step. */
function fromGuardElement(element: GuardElement): JsonRenderElement {
  const on: Record<string, { action: string }> = {};
  for (const [event, binding] of Object.entries(element.on ?? {})) {
    on[event] = { action: binding.name };
  }
  return {
    // Props are left empty on purpose. The guarded event carries the checked
    // props, and reassembly writes those back; an original is only needed to
    // remember which of $state or $bindState a ref arrived as, and a live
    // stream has no earlier form to preserve.
    type: element.type,
    props: {},
    children: [...element.children],
    ...(Object.keys(on).length > 0 ? { on } : {}),
  };
}
