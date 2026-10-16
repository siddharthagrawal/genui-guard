import type { GuardEvent } from "@genui-guard/core";
import { pointerToPath } from "./paths.js";
import { toGuardElement, type JsonRenderElement } from "./spec.js";

/**
 * json-render asks the model for JSONL RFC 6902 patches rather than a whole
 * spec, so the interface fills in progressively as it streams. Its generated
 * prompt shows the shape:
 *
 *   {"op":"add","path":"/root","value":"main"}
 *   {"op":"add","path":"/elements/card","value":{"type":"FlightCard",...}}
 *   {"op":"add","path":"/state/fares","value":{...}}
 *
 * Those three forms map onto the guard's three input events, which is why the
 * guard can sit on a live stream without buffering the whole turn.
 */
export type JsonRenderPatch = {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
};

export function isPatch(value: unknown): value is JsonRenderPatch {
  if (value === null || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return typeof p.op === "string" && typeof p.path === "string";
}

/** Returns null for a patch the guard has no event for, such as a removal. */
export function patchToEvent(patch: JsonRenderPatch): GuardEvent | null {
  const segments = patch.path.split("/").filter((s) => s.length > 0);
  const [head, ...rest] = segments;

  if (head === "root") {
    return typeof patch.value === "string" ? { kind: "root", id: patch.value } : null;
  }

  if (head === "elements") {
    const id = rest[0];
    if (!id || patch.op === "remove") return null;
    if (patch.value === null || typeof patch.value !== "object") return null;

    // A patch addressing a field inside an element, rather than the whole
    // element, cannot be checked on its own. Blocking it is the safe default.
    if (rest.length > 1) return null;

    return {
      kind: "element",
      id,
      element: toGuardElement(id, patch.value as JsonRenderElement),
    };
  }

  if (head === "state") {
    if (rest.length === 0 || patch.op === "remove") return null;
    return { kind: "state", path: rest.join("."), value: patch.value };
  }

  return null;
}

/** Parses one JSONL line. Returns null for blank lines and malformed JSON. */
export function parsePatchLine(line: string): JsonRenderPatch | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isPatch(parsed) ? parsed : null;
  } catch {
    // A live model does emit malformed lines. Skipping one is better than
    // failing the turn, and the line never reaches the renderer either way.
    return null;
  }
}

/**
 * Splits a growing buffer into complete lines, returning the events for the
 * complete ones and whatever remains unterminated. Lets a caller feed model
 * output to the guard as it arrives.
 */
export function drainPatchBuffer(buffer: string): {
  events: GuardEvent[];
  rest: string;
} {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: GuardEvent[] = [];

  for (const line of lines) {
    const patch = parsePatchLine(line);
    if (!patch) continue;
    const event = patchToEvent(patch);
    if (event) events.push(event);
  }

  return { events, rest };
}

/** Whole-text convenience for a non-streaming response. */
export function patchesToEvents(jsonl: string): GuardEvent[] {
  const { events, rest } = drainPatchBuffer(jsonl.endsWith("\n") ? jsonl : `${jsonl}\n`);
  if (rest.trim().length > 0) {
    const patch = parsePatchLine(rest);
    const event = patch ? patchToEvent(patch) : null;
    if (event) events.push(event);
  }
  return events;
}

/** json-render state pointers are absolute; the guard uses dotted paths. */
export function statePointerToPath(pointer: string): string {
  return pointerToPath(pointer);
}
