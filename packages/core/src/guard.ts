import { checkA11y } from "./a11y.js";
import { checkContract } from "./contract.js";
import { checkFreshness } from "./freshness.js";
import { mergeResults } from "./decisions.js";
import { guardError, GuardError } from "./errors.js";
import { checkProvenance } from "./provenance.js";
import { lintRegistry } from "./registry.js";
import { createTurnState, recordId, type TurnState } from "./state.js";
import { createTree } from "./tree.js";
import { assertElement, assertEvent } from "./validate.js";
import type {
  CheckResult,
  Ctx,
  Guard,
  GuardConfig,
  GuardElement,
  GuardEvent,
  PolicyResult,
  PropValue,
  StateTraceEntry,
  ToolResult,
  TraceEntry,
} from "./types.js";

const DEFAULT_HOLD_MS = 5000;
const DEFAULT_MAX_TURNS = 100;

export function createGuard(config: GuardConfig): Guard {
  const hold = config.holdTimeoutMs ?? DEFAULT_HOLD_MS;
  if (typeof hold !== "number" || !Number.isFinite(hold) || hold <= 0) {
    throw guardError("GUARD_E_INVALID_HOLD_TIMEOUT", { received: String(config.holdTimeoutMs) });
  }

  // Setup errors belong at setup, not at the first element of the first turn.
  const configErrors = lintRegistry(config.registry);
  if (configErrors.length > 0) throw configErrors[0];

  const states = new Map<string, TurnState>();
  const traces = new Map<string, (TraceEntry | StateTraceEntry)[]>();

  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw guardError("GUARD_E_INVALID_MAX_TURNS", { received: String(config.maxTurns) });
  }

  const release = (turnId: string): void => {
    states.delete(turnId);
    traces.delete(turnId);
  };

  /**
   * A guard held for the life of a server used to retain every turn it had ever
   * seen, because nothing released one. Maps keep insertion order, so the
   * oldest turn is the first key, and eviction is oldest-first once the bound
   * is exceeded. `endTurn` is the tidy way; this is the safety net.
   */
  const evictIfNeeded = (): void => {
    while (states.size > maxTurns) {
      const oldest = states.keys().next().value;
      if (oldest === undefined) return;
      release(oldest);
    }
  };

  const stateFor = (turnId: string): TurnState => {
    let s = states.get(turnId);
    if (!s) {
      s = createTurnState(turnId);
      states.set(turnId, s);
      evictIfNeeded();
    }
    return s;
  };

  const trace = (turnId: string, entry: TraceEntry | StateTraceEntry): void => {
    const list = traces.get(turnId) ?? [];
    list.push(entry);
    traces.set(turnId, list);
    config.onTrace?.(entry);
  };

  function checkElement(element: GuardElement, ctx: Ctx): CheckResult {
    // A host programming error fails here with a code and a fix, rather than
    // as a TypeError thrown from inside a published dist.
    assertElement(element);

    const started = performance.now();
    const spec = config.registry.get(element.type);
    const state = stateFor(ctx.turnId);
    const before = { ...element.props };
    const results: PolicyResult[] = [];

    // 1. Contract. An unknown component blocks: a catalog can be bypassed, so
    // the guard re-checks rather than trusting that it was not.
    if (!spec) {
      results.push({
        policy: "contract",
        decision: "block",
        reason: `"${element.type}" is not in the registry, so the guard has no rules for it and cannot vouch for what it renders.`,
      });
      return finish(element, results, before, started, ctx, undefined);
    }

    const resolved = resolveProps(element.props, state);

    // Unknown props are stripped and a prop of the wrong type blocks, against
    // the host's own schema. Props the guard cannot read are skipped, because
    // treating "cannot verify" as "invalid" would withhold correct interfaces.
    results.push(...checkContract(element, spec, resolved));

    // 2. Provenance.
    if ((spec.bound?.length ?? 0) > 0 && !state.hasAnyResult()) {
      throw guardError("GUARD_E_NO_TOOL_RESULT", {
        turnId: ctx.turnId,
        elementId: element.id,
      });
    }
    results.push(...checkProvenance(element, spec, state));

    // How old the verified data is. Annotates, never blocks: see
    // docs/decisions.md on why staleness is the host's to resolve.
    results.push(...checkFreshness(element, spec, state, ctx, config.staleAfterMs));

    // 3. Policies.
    const entity = resolveEntity(element, spec, state);

    for (const policy of config.policies ?? []) {
      let produced: PolicyResult | PolicyResult[] | null;
      try {
        produced = policy.check({ element, spec, entity, resolved, ctx });
      } catch (cause) {
        // A policy that cannot decide is not a reason to allow.
        results.push({
          policy: policy.name,
          decision: "block",
          reason: `Policy "${policy.name}" failed while checking ${element.type}, so the element was blocked rather than passed through.`,
        });
        trace(ctx.turnId, {
          turnId: ctx.turnId,
          path: `policy:${policy.name}`,
          final: "block",
          reason: guardError("GUARD_E_POLICY_THREW", {
            policy: policy.name,
            component: element.type,
            cause: cause instanceof Error ? cause.message : String(cause),
          }).message,
        });
        continue;
      }
      if (!produced) continue;
      results.push(...(Array.isArray(produced) ? produced : [produced]));
    }

    // 4. Accessibility.
    results.push(...checkA11y(element, spec, resolved));

    return finish(element, results, before, started, ctx, spec.fallback);
  }

  function finish(
    element: GuardElement,
    results: PolicyResult[],
    before: Record<string, PropValue>,
    started: number,
    ctx: Ctx,
    _fallback: string | undefined,
  ): CheckResult {
    let merged;
    try {
      merged = mergeResults(results, element.type);
    } catch (e) {
      // Conflicting repairs block, and the error explains which policies clashed.
      const err = e as GuardError;
      results.push({ policy: "mergeResults", decision: "block", reason: err.message });
      merged = {
        final: "block" as const,
        patch: {},
        removeProps: [],
        gatedActions: [],
      };
    }

    const blocked = merged.final === "block";
    let after: GuardElement | null = null;
    if (!blocked) {
      const props = { ...element.props, ...merged.patch };
      for (const prop of merged.removeProps) delete props[prop];
      after = { ...element, props };
    }

    const entry: TraceEntry = {
      turnId: ctx.turnId,
      elementId: element.id,
      component: element.type,
      final: merged.final,
      results,
      before,
      after: after ? after.props : null,
      latencyMs: performance.now() - started,
    };
    trace(ctx.turnId, entry);

    return { element: after, decision: merged.final, trace: entry };
  }

  function resolveProps(
    props: Record<string, PropValue>,
    state: TurnState,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (value.kind === "literal") out[key] = value.value;
      else if (value.kind === "ref") out[key] = state.resolveAny(value.path).value;
      else out[key] = undefined;
    }
    return out;
  }

  /** The source record a component's bound props point at, when there is one. */
  function resolveEntity(
    element: GuardElement,
    spec: { entity?: string; bound?: string[] } | undefined,
    state: TurnState,
  ): Record<string, unknown> | undefined {
    if (!spec?.entity) return undefined;
    for (const prop of spec.bound ?? []) {
      const value = element.props[prop];
      if (value?.kind !== "ref") continue;
      const id = recordId(value.path);
      if (!id) continue;
      const rec = state.record(spec.entity, id);
      if (rec) return rec;
    }
    return undefined;
  }

  /**
   * The main path. Elements are checked as they arrive, state patches are
   * screened, and blocking an element drops its subtree so the renderer never
   * receives a dangling reference.
   */
  function makeTransform(ctx: Ctx): Transformer<GuardEvent, GuardEvent> {
    const tree = createTree();
    const state = stateFor(ctx.turnId);
    const dropped = new Set<string>();
    /** Elements held because the data behind their bound props has not arrived. */
    const held: { element: GuardElement; since: number }[] = [];

    type Out = Pick<TransformStreamDefaultController<GuardEvent>, "enqueue">;

    /** True when a component's source namespace is still missing. */
    const awaitingData = (element: GuardElement): boolean => {
      const spec = config.registry.get(element.type);
      if (!spec?.entity || (spec.bound?.length ?? 0) === 0) return false;
      return !state.reservedNamespaces().includes(spec.entity);
    };

    const block = (element: GuardElement, reason: string, out: Out): void => {
      tree.set(element);
      const removed = tree.remove(element.id);
      for (const id of removed) {
        dropped.add(id);
        const cascaded = id !== element.id;
        out.enqueue({
          kind: "drop",
          id,
          reason: cascaded
            ? `Removed because its ancestor ${element.id} was blocked.`
            : reason,
        });
        if (cascaded) {
          trace(ctx.turnId, {
            turnId: ctx.turnId,
            elementId: id,
            component: "unknown",
            final: "block",
            results: [],
            before: {},
            after: null,
            cascadedFrom: element.id,
            latencyMs: 0,
          });
        }
      }
    };

    const emit = (element: GuardElement, out: Out): void => {
      if (dropped.has(element.id)) return;

      const result = checkElement(element, ctx);
      if (result.element === null) {
        const reason =
          result.trace.results.find((r) => r.decision === "block")?.reason ?? "blocked";
        block(element, reason, out);
        return;
      }

      tree.set(result.element);
      out.enqueue({ kind: "element", id: result.element.id, element: result.element });
    };

    /** Replays anything whose data has since arrived, oldest first. */
    const releaseHeld = (out: Out): void => {
      for (let i = held.length - 1; i >= 0; i--) {
        const entry = held[i]!;
        if (awaitingData(entry.element)) continue;
        held.splice(i, 1);
        emit(entry.element, out);
      }
    };

    return {
      transform(event, controller) {
        assertEvent(event);

        if (event.kind === "root") {
          tree.setRoot(event.id);
          controller.enqueue(event);
          return;
        }

        if (event.kind === "state") {
          const verdict = state.applyModelPatch(event.path, event.value);
          trace(ctx.turnId, {
            turnId: ctx.turnId,
            path: event.path,
            // A redundant patch is not a violation. The model re-sent data the
            // host already had, so nothing was fabricated and reporting it as a
            // block would overstate what happened.
            final: verdict === "rejected" ? "block" : "allow",
            reason:
              verdict === "allowed"
                ? `State patch to "${event.path}" is outside the data the host owns, so it passed through.`
                : verdict === "redundant"
                  ? `State patch to "${event.path}" repeated what the host already loaded, so it was dropped as redundant rather than treated as a change.`
                  : `State patch to "${event.path}" was rejected, because it tried to change data loaded from this turn's tool results.`,
          });
          if (verdict === "allowed") controller.enqueue(event);
          return;
        }

        if (event.kind === "drop") {
          controller.enqueue(event);
          return;
        }

        // Already removed as part of a blocked subtree, even if its own patch
        // arrives afterwards.
        if (dropped.has(event.element.id)) return;

        // Hold-until-verified. An element whose source data has not arrived is
        // held rather than rendered with an unverified value, so the renderer
        // shows a placeholder instead of a fare that later corrects itself.
        if (awaitingData(event.element)) {
          held.push({ element: event.element, since: Date.now() });
          return;
        }

        releaseHeld(controller);
        emit(event.element, controller);
      },

      /** A hold that never resolves expires into a block rather than hanging. */
      flush(controller) {
        releaseHeld(controller);

        for (const entry of held) {
          const spec = config.registry.get(entry.element.type);
          block(
            entry.element,
            `${entry.element.type} was held for ${Date.now() - entry.since}ms waiting for ${spec?.entity ?? "its source data"}, which never arrived, so it was blocked rather than rendered unverified.`,
            controller,
          );
          trace(ctx.turnId, {
            turnId: ctx.turnId,
            elementId: entry.element.id,
            component: entry.element.type,
            final: "block",
            results: [
              {
                policy: "holdUntilVerified",
                decision: "block",
                reason: `No tool result for ${spec?.entity ?? "its entity"} arrived before the stream ended.`,
              },
            ],
            before: entry.element.props,
            after: null,
            latencyMs: Date.now() - entry.since,
          });
        }
        held.length = 0;
      },
    };
  }

  const guard: Guard = {
    recordToolResult(result: ToolResult) {
      stateFor(result.turnId).reserve(result);
    },

    check: (element, ctx) => checkElement(element, ctx),

    stream(ctx) {
      return new TransformStream<GuardEvent, GuardEvent>(makeTransform(ctx));
    },

    async *wrap(events, ctx) {
      const transformer = makeTransform(ctx);
      const queue: GuardEvent[] = [];
      // A stand-in controller, so wrap() and stream() share one implementation.
      const controller: TransformStreamDefaultController<GuardEvent> = {
        desiredSize: null,
        enqueue: (e?: GuardEvent) => {
          if (e) queue.push(e);
        },
        error: (reason?: unknown) => {
          throw reason;
        },
        terminate: () => {},
      };

      for await (const event of events) {
        transformer.transform?.(event, controller);
        while (queue.length > 0) yield queue.shift()!;
      }

      // Expire any remaining holds, same as the stream's flush.
      transformer.flush?.(controller);
      while (queue.length > 0) yield queue.shift()!;
    },

    traces: (turnId) => traces.get(turnId) ?? [],

    endTurn: (turnId) => release(turnId),
  };

  return guard;
}
