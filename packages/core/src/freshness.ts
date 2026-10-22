import type { TurnState } from "./state.js";
import type { ComponentSpec, Ctx, GuardElement, PolicyResult } from "./types.js";

const POLICY = "freshness";

/**
 * How old the data behind a bound property is allowed to be.
 *
 * This annotates rather than blocks, which is the opposite of how the rest of
 * the provenance checks behave, and the reasoning is in docs/decisions.md. A
 * stale price is probably still correct, the card is honest about where it came
 * from, and hiding it leaves the unexplained gap that annotation exists to
 * avoid. The authoritative check belongs at the transaction, as it always has
 * in commerce: the booking call re-prices and refuses. What the guard must not
 * do is present week-old data as *verified*, because that lends it credibility
 * it has not earned.
 *
 * Nothing here reads a clock. The host supplies `at` when it records a result
 * and `now` on the context, so the decision stays a pure function of its
 * inputs and the same turn replays to the same verdict on any machine.
 */
export function checkFreshness(
  element: GuardElement,
  spec: ComponentSpec | undefined,
  state: TurnState,
  ctx: Ctx,
  staleAfterMs: number | undefined,
): PolicyResult[] {
  const entity = spec?.entity;
  if (!entity || (spec?.bound?.length ?? 0) === 0) return [];
  if (staleAfterMs === undefined || typeof ctx.now !== "number") return [];

  const at = state.loadedAt(entity);
  if (at === undefined) return [];

  const age = ctx.now - at;
  if (age <= staleAfterMs) return [];

  return [
    {
      policy: POLICY,
      decision: "annotate",
      reason: `${element.type} reads ${entity} the host loaded ${describe(age)} ago, and this turn treats anything older than ${describe(staleAfterMs)} as stale, so the values may have moved since.`,
      note: `Loaded ${describe(age)} ago`,
    },
  ];
}

/** Plain enough to read in a trace, coarse enough not to imply precision. */
function describe(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}
