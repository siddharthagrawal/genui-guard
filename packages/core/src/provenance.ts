import { recordPrefix, type TurnState } from "./state.js";
import type { ComponentSpec, GuardElement, PolicyResult, PropValue } from "./types.js";

const POLICY = "requireBinding";

/**
 * Verifies that every bound prop references host-loaded data.
 *
 * A literal blocks, because the model authored a value it was not allowed to
 * author. An expression blocks too: a template can interpolate a model-written
 * fragment, and the guard cannot attribute the result to a source. That second
 * rule may be too strict and the evals will say so, which is why it is a
 * separate reason string.
 */
export function checkProvenance(
  element: GuardElement,
  spec: ComponentSpec | undefined,
  state: TurnState,
): PolicyResult[] {
  const bound = spec?.bound ?? [];
  if (!spec || bound.length === 0) return [];

  const entity = spec.entity;
  const results: PolicyResult[] = [];
  const prefixes = new Set<string>();

  for (const prop of bound) {
    const value = element.props[prop];

    if (value === undefined) {
      results.push({
        policy: POLICY,
        decision: "block",
        reason: `${element.type}.${prop} is declared bound but missing, so there is nothing to verify against ${entity}.`,
      });
      continue;
    }

    const failure = classify(element.type, prop, value, entity, state);
    if (failure) {
      results.push(failure);
      continue;
    }

    const prefix = recordPrefix((value as { path: string }).path);
    if (prefix) prefixes.add(prefix);
  }

  // The transposition failure: every bound prop resolved, but to different
  // records, so the card shows one flight's price beside another's times.
  if (prefixes.size > 1) {
    results.push({
      policy: POLICY,
      decision: "block",
      reason: `${element.type} mixes data from ${prefixes.size} different records (${[...prefixes].join(", ")}), so its bound props do not describe one ${entity ?? "entity"}.`,
    });
    return results;
  }

  // The claimed record must exist, and its key field must agree with the path.
  const only = [...prefixes][0];
  if (only && entity && spec.key) {
    const id = only.split(".")[1]!;
    const rec = state.record(entity, id);
    if (!rec) {
      results.push({
        policy: POLICY,
        decision: "block",
        reason: `${element.type} references ${only}, but no record with ${spec.key} "${id}" was in the ${entity} results for this turn.`,
      });
    } else if (rec[spec.key] !== undefined && String(rec[spec.key]) !== id) {
      results.push({
        policy: POLICY,
        decision: "block",
        reason: `${element.type} references ${only}, but that record's ${spec.key} is "${String(rec[spec.key])}".`,
      });
    }
  }

  return results;
}

function classify(
  type: string,
  prop: string,
  value: PropValue,
  entity: string | undefined,
  state: TurnState,
): PolicyResult | null {
  const target = entity ?? "the tool results";

  if (value.kind === "literal") {
    return {
      policy: POLICY,
      decision: "block",
      reason: `${type}.${prop} is a literal value written by the model, and it must reference ${target} loaded by the host instead.`,
    };
  }

  if (value.kind === "expr") {
    return {
      policy: POLICY,
      decision: "block",
      reason: `${type}.${prop} is an expression, and the guard cannot attribute its result to a record in ${target}. Bind it directly to a field instead.`,
    };
  }

  const owner = state.ownerEntity(value.path);
  if (owner === undefined) {
    return {
      policy: POLICY,
      decision: "block",
      reason: `${type}.${prop} references "${value.path}", which is outside the data the host loaded for this turn.`,
    };
  }

  if (entity && owner !== entity) {
    return {
      policy: POLICY,
      decision: "block",
      reason: `${type}.${prop} references "${value.path}" in ${owner}, but ${type} is backed by ${entity}.`,
    };
  }

  if (!state.resolveHost(value.path).found) {
    return {
      policy: POLICY,
      decision: "block",
      reason: `${type}.${prop} references "${value.path}", which does not exist in the ${owner} results for this turn.`,
    };
  }

  return null;
}
