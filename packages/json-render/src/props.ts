import type { PropValue } from "@genui-guard/core";
import { pathToPointer, pointerToPath } from "./paths.js";

/**
 * json-render supports eight prop expression forms as of 0.21.0. Only two of
 * them are a direct reference to a state path, and those are the only ones a
 * bound prop may use.
 *
 * Everything else becomes `expr`, which core blocks in a bound prop. A template
 * can interpolate a model-written fragment and a computed value runs a function,
 * so neither can be attributed to a record in the tool results. That is strict,
 * and the evals will say whether it is too strict.
 */
const DIRECT_REF = ["$state", "$bindState"] as const;
const OTHER_EXPRESSIONS = [
  "$item",
  "$index",
  "$bindItem",
  "$cond",
  "$computed",
  "$template",
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function toPropValue(raw: unknown): PropValue {
  if (!isRecord(raw)) return { kind: "literal", value: raw };

  for (const key of DIRECT_REF) {
    const pointer = raw[key];
    if (typeof pointer === "string") {
      return { kind: "ref", path: pointerToPath(pointer) };
    }
  }

  for (const key of OTHER_EXPRESSIONS) {
    if (key in raw) return { kind: "expr", raw };
  }

  // A plain object prop, such as a style bag, is a literal value.
  return { kind: "literal", value: raw };
}

/** Back to json-render's shape, preserving which of the two ref forms was used. */
export function fromPropValue(value: PropValue, original: unknown): unknown {
  if (value.kind === "literal") return value.value;
  if (value.kind === "expr") return value.raw;

  const key =
    isRecord(original) && typeof original.$bindState === "string" ? "$bindState" : "$state";
  return { [key]: pathToPointer(value.path) };
}

export function toProps(props: Record<string, unknown>): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const [key, raw] of Object.entries(props)) out[key] = toPropValue(raw);
  return out;
}

export function fromProps(
  props: Record<string, PropValue>,
  originals: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    out[key] = fromPropValue(value, originals[key]);
  }
  return out;
}
