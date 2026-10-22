import { createGuard, type Ctx, type TraceEntry } from "@genui-guard/core";
import type {
  CaseOutcome,
  EvalCase,
  EvalConfig,
  Expectation,
  GuardRun,
  SuiteConfig,
  SuiteResult,
} from "./types.js";

/**
 * One case, one guard, one turn. A fresh guard per case so a reserved namespace
 * from one case cannot make the next one pass, which would be the harness
 * version of the circularity the protocol exists to avoid.
 */
export async function runCase(config: EvalConfig, kase: EvalCase): Promise<CaseOutcome> {
  const turnId = `eval:${kase.id}`;
  const guard = createGuard({
    registry: config.registry,
    ...(config.policies ? { policies: config.policies } : {}),
    ...(config.holdTimeoutMs ? { holdTimeoutMs: config.holdTimeoutMs } : {}),
    ...(config.staleAfterMs ? { staleAfterMs: config.staleAfterMs } : {}),
    ...(config.maxTurns ? { maxTurns: config.maxTurns } : {}),
  });

  for (const result of kase.tools ?? config.tools ?? []) {
    guard.recordToolResult({ ...result, turnId });
  }

  const ctx: Ctx = { ...config.ctx, ...kase.ctx, turnId };
  const run = await config.run({ guard, spec: kase.spec, ctx });

  return judge(kase, run);
}

export function judge(kase: EvalCase, run: GuardRun): CaseOutcome {
  const failures = check(kase.expect, run);
  const collateral = kase.ideally ? check(kase.ideally, run) : [];

  // A clean case fails in two different ways and they do not deserve the same
  // number. Withholding a legitimate element is what makes a team switch the
  // guard off; taking a true badge out of one is a smaller, quieter wrong.
  const kept = kase.expect.kept ?? [];
  const falseBlock = kept.some((id) => run.dropped.includes(id));
  const missing = (kase.expect.present ?? []).filter((text) => !serialise(run).includes(text));
  const falseModification = !falseBlock && missing.length > 0;

  const traces = run.traces.filter((t): t is TraceEntry => "results" in t);

  return {
    id: kase.id,
    family: kase.family,
    describe: kase.describe,
    passed: failures.length === 0,
    falseBlock,
    falseModification,
    failures,
    ...(collateral.length > 0 ? { collateral } : {}),
    reasons: traces.flatMap((t) => t.results.map((r) => `${r.policy}: ${r.reason}`)),
    decisions: traces.map((t) => `${t.elementId} ${t.final}`),
  };
}

function serialise(run: GuardRun): string {
  return JSON.stringify(run.output ?? null);
}

/** Returns one line per unmet criterion, in the terms the case declared. */
function check(expect: Expectation, run: GuardRun): string[] {
  const out: string[] = [];
  const rendered = serialise(run);

  for (const id of expect.dropped ?? []) {
    if (!run.dropped.includes(id)) out.push(`"${id}" reached the renderer and should not have`);
  }
  for (const id of expect.kept ?? []) {
    if (run.dropped.includes(id)) out.push(`"${id}" was withheld and should have rendered`);
  }
  for (const text of expect.absent ?? []) {
    if (rendered.includes(text)) out.push(`"${text}" is still in the output`);
  }
  for (const text of expect.present ?? []) {
    if (!rendered.includes(text)) out.push(`"${text}" was removed from the output`);
  }

  for (const { element, action } of expect.confirmed ?? []) {
    const gated = run.traces.some(
      (t) =>
        "results" in t &&
        t.elementId === element &&
        t.results.some((r) => r.decision === "gate" && (r.gatedActions ?? []).includes(action)),
    );
    if (!gated) out.push(`"${action}" on "${element}" can fire without a confirmation`);
  }

  for (const { element, prop } of expect.changed ?? []) {
    const trace = [...run.traces]
      .reverse()
      .find((t): t is TraceEntry => "results" in t && t.elementId === element);
    if (!trace) {
      out.push(`"${element}" was never checked, so "${prop}" cannot have been altered`);
      continue;
    }
    if (trace.after === null) {
      out.push(`"${element}" was withheld, so "${prop}" was not altered`);
      continue;
    }
    const before = JSON.stringify(trace.before[prop] ?? null);
    const after = JSON.stringify(trace.after[prop] ?? null);
    if (before === after) out.push(`"${prop}" on "${element}" was left as it arrived`);
  }

  if (expect.anyOf && expect.anyOf.length > 0) {
    const attempts = expect.anyOf.map((alternative) => check(alternative, run));
    if (!attempts.some((f) => f.length === 0)) {
      out.push(
        `none of the acceptable outcomes held: ${attempts
          .map((f, i) => `(${i + 1}) ${f.join("; ")}`)
          .join(" ")}`,
      );
    }
  }

  return out;
}

export async function runSuite(
  config: EvalConfig,
  suite: SuiteConfig,
  cases: EvalCase[],
): Promise<SuiteResult> {
  const outcomes: CaseOutcome[] = [];
  for (const kase of cases) outcomes.push(await runCase(config, kase));

  const byFamily: SuiteResult["byFamily"] = {};
  for (const outcome of outcomes) {
    const bucket = (byFamily[outcome.family] ??= { total: 0, passed: 0 });
    bucket.total += 1;
    if (outcome.passed) bucket.passed += 1;
  }

  return { name: suite.name, kind: suite.kind, cases: outcomes, byFamily };
}
