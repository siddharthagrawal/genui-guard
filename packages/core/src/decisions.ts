import { guardError } from "./errors.js";
import type { Decision, PolicyResult, PropValue } from "./types.js";

/** block > gate > repair > annotate > allow. Higher wins. */
const RANK: Record<Decision, number> = {
  allow: 0,
  annotate: 1,
  repair: 2,
  gate: 3,
  block: 4,
};

export function rank(d: Decision): number {
  return RANK[d];
}

export function strictest(decisions: Decision[]): Decision {
  let worst: Decision = "allow";
  for (const d of decisions) {
    if (RANK[d] > RANK[worst]) worst = d;
  }
  return worst;
}

function sameValue(a: PropValue, b: PropValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "ref" && b.kind === "ref") return a.path === b.path;
  if (a.kind === "literal" && b.kind === "literal") {
    return JSON.stringify(a.value) === JSON.stringify(b.value);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export type MergedOutcome = {
  final: Decision;
  /** Props to apply, already merged. Empty when nothing repairs. */
  patch: Record<string, PropValue>;
  notes: string[];
  gatedActions: string[];
};

/**
 * Collapses every policy result for one element into a single outcome.
 *
 * Repairs from several policies apply in order. Two policies repairing the same
 * prop to different values is a block, because picking a winner would mean
 * asserting a value no policy agreed on. See docs/decisions.md.
 */
export function mergeResults(
  results: PolicyResult[],
  component: string,
): MergedOutcome {
  const patch: Record<string, PropValue> = {};
  const patchOwner: Record<string, string[]> = {};
  const notes: string[] = [];
  const gatedActions: string[] = [];
  const decisions: Decision[] = [];

  for (const r of results) {
    decisions.push(r.decision);

    if (r.decision === "annotate" && r.note) notes.push(r.note);
    if (r.decision === "gate" && r.gatedActions) gatedActions.push(...r.gatedActions);

    if (r.decision === "repair" && r.patch) {
      for (const [prop, value] of Object.entries(r.patch)) {
        const existing = patch[prop];
        if (existing !== undefined && !sameValue(existing, value)) {
          const owners = [...(patchOwner[prop] ?? []), r.policy];
          throw guardError("GUARD_E_CONFLICTING_REPAIRS", {
            policies: owners.join(", "),
            prop,
            component,
          });
        }
        patch[prop] = value;
        patchOwner[prop] = [...(patchOwner[prop] ?? []), r.policy];
      }
    }
  }

  return {
    final: strictest(decisions),
    patch,
    notes,
    gatedActions: [...new Set(gatedActions)],
  };
}
