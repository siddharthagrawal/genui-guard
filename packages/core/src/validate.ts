import { guardError } from "./errors.js";
import type { GuardElement, GuardEvent, PropValue } from "./types.js";

/**
 * The boundary between a host and the guard.
 *
 * Everything the guard decides about model content is a decision, traced and
 * recoverable. Everything wrong with the *shape* of what a host hands over is a
 * programming error in the integration, and those fail immediately with a code
 * and a fix, because the alternative is a TypeError thrown from inside a
 * published `dist` with a stack trace into code the developer has never read.
 *
 * An outside developer wiring their own transport hit exactly that three times
 * in a row, which is how these came to exist. The expensive one was passing a
 * renderer's own `{ "$state": "..." }` notation straight through, since that is
 * the notation every example in the README is written in.
 */

const KINDS = new Set(["root", "element", "state", "drop"]);
const PROP_KINDS = new Set(["literal", "ref", "expr"]);

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "an array";
  if (typeof value !== "object") return `a ${typeof value}`;

  const keys = Object.keys(value as object);
  return keys.length > 0 ? `an object with keys [${keys.join(", ")}]` : "an empty object";
}

export function assertEvent(event: unknown): asserts event is GuardEvent {
  const kind = (event as { kind?: unknown } | null)?.kind;

  if (typeof kind !== "string" || !KINDS.has(kind)) {
    throw guardError("GUARD_E_MALFORMED_EVENT", { received: describe(kind) });
  }

  if (kind === "root" && typeof (event as { id?: unknown }).id !== "string") {
    throw guardError("GUARD_E_MALFORMED_EVENT", { received: `root without an id` });
  }

  if (kind === "state" && typeof (event as { path?: unknown }).path !== "string") {
    throw guardError("GUARD_E_MALFORMED_EVENT", { received: `state without a path` });
  }

  if (kind === "element") {
    const element = (event as { element?: unknown }).element;
    if (element === null || typeof element !== "object") {
      throw guardError("GUARD_E_MALFORMED_EVENT", {
        received: `element whose element field is ${describe(element)}`,
      });
    }
    assertElement(element);
  }
}

export function assertElement(element: unknown): asserts element is GuardElement {
  const e = element as Partial<GuardElement> | null;
  const id = typeof e?.id === "string" ? e.id : "(no id)";

  const missing: string[] = [];
  if (typeof e?.id !== "string") missing.push("an id");
  if (typeof e?.type !== "string") missing.push("a type");
  if (e?.props === null || typeof e?.props !== "object") missing.push("a props object");

  if (missing.length > 0) {
    throw guardError("GUARD_E_MALFORMED_ELEMENT", { id, missing: missing.join(", ") });
  }

  for (const [prop, value] of Object.entries(e!.props!)) {
    assertPropValue(value, prop, e!.type!);
  }
}

export function assertPropValue(
  value: unknown,
  prop: string,
  component: string,
): asserts value is PropValue {
  const kind = (value as { kind?: unknown } | null)?.kind;
  if (typeof kind === "string" && PROP_KINDS.has(kind)) {
    if (kind === "ref" && typeof (value as { path?: unknown }).path !== "string") {
      throw guardError("GUARD_E_UNCLASSIFIED_PROP", {
        prop,
        component,
        received: "a ref with no path",
      });
    }
    return;
  }

  throw guardError("GUARD_E_UNCLASSIFIED_PROP", {
    prop,
    component,
    received: describe(value),
  });
}
