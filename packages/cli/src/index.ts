export {
  defineConfig,
  CliError,
  describeLoadFailure,
  findConfig,
  loadConfig,
  loadCases,
  inspectConfig,
} from "./config.js";
export type { Diagnostic, Diagnostics } from "./config.js";
export { check } from "./check.js";
export type { CheckResult } from "./check.js";
export { runCase, runSuite, judge } from "./run.js";
export { summarise, pct, rate, worstFirst } from "./score.js";
export { renderReport, renderComment } from "./report.js";
export { main, parseArgs } from "./cli.js";

export type {
  CaseOutcome,
  EvalCase,
  EvalConfig,
  EvalReport,
  Expectation,
  GuardRun,
  RunSpec,
  SuiteConfig,
  SuiteKind,
  SuiteResult,
  Thresholds,
} from "./types.js";
