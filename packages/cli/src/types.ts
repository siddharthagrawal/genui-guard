import type {
  Ctx,
  Guard,
  Policy,
  Registry,
  StateTraceEntry,
  ToolResult,
  TraceEntry,
} from "@genui-guard/core";

/**
 * The CLI speaks core's types and nothing from any renderer. A suite is run
 * through an adapter the config supplies, so this package stays as neutral as
 * core does. See CLAUDE.md on why the layer claim depends on that.
 */

/** What reached the renderer, in terms the CLI can judge without knowing one. */
export type GuardRun = {
  /** The guarded output, as the host would render it. Serialised for string checks. */
  output: unknown;
  /** Ids the guard withheld. */
  dropped: string[];
  traces: (TraceEntry | StateTraceEntry)[];
};

export type RunSpec = (args: {
  guard: Guard;
  spec: unknown;
  ctx: Ctx;
}) => GuardRun | Promise<GuardRun>;

export type Expectation = {
  dropped?: string[];
  kept?: string[];
  absent?: string[];
  present?: string[];
  confirmed?: { element: string; action: string }[];
  changed?: { element: string; prop: string }[];
  anyOf?: Expectation[];
};

export type EvalCase<Spec = unknown> = {
  id: string;
  family: string;
  describe: string;
  tools?: ToolResult[];
  ctx?: Partial<Ctx>;
  spec: Spec;
  expect: Expectation;
  /** Reported, never scored. The preferred outcome where more than one is safe. */
  ideally?: Expectation;
};

export type SuiteKind = "detection" | "clean";

export type SuiteConfig = {
  name: string;
  /** Directory of case modules, each exporting `cases`. Relative to the config file. */
  dir: string;
  /**
   * `detection` scores how many fabrications were caught. `clean` scores how
   * many legitimate elements were withheld or altered, which is the headline.
   */
  kind: SuiteKind;
};

export type Thresholds = {
  /** The headline. A legitimate element the guard withheld. */
  maxFalseBlockRate?: number;
  /** A legitimate element that rendered with something true taken out of it. */
  maxFalseModificationRate?: number;
  minDetectionRate?: number;
  /** Per family, for families where a blended figure would hide the answer. */
  minDetectionByFamily?: Record<string, number>;
};

export type EvalConfig<Spec = unknown> = {
  registry: Registry;
  policies?: Policy[];
  holdTimeoutMs?: number;
  /** Passed through to the guard. Stale data annotates; it never blocks. */
  staleAfterMs?: number;
  maxTurns?: number;
  /** Tool results every case starts from, unless the case supplies its own. */
  tools?: ToolResult[];
  /** Context every case starts from, such as the session. */
  ctx?: Partial<Ctx>;
  /** The adapter. Runs one spec through one guard and says what came out. */
  run: RunSpec;
  suites?: SuiteConfig[];
  thresholds?: Thresholds;
  /** Where `genui-guard test` writes its report. Relative to the config file. */
  reportPath?: string;
  /** Spec type carrier. Never read at runtime. */
  __spec?: Spec;
};

export type CaseOutcome = {
  id: string;
  family: string;
  describe: string;
  /** Detection: every criterion held. Clean: nothing was withheld or removed. */
  passed: boolean;
  /** Clean only: an element the case expected to render was withheld. */
  falseBlock: boolean;
  /** Clean only: the element rendered without something true it arrived with. */
  falseModification: boolean;
  /** Why it failed, in the terms the case declared. */
  failures: string[];
  /** Set when `ideally` was declared and did not hold. */
  collateral?: string[];
  /** Reason strings from the guard, for the report. */
  reasons: string[];
  decisions: string[];
};

export type SuiteResult = {
  name: string;
  kind: SuiteKind;
  cases: CaseOutcome[];
  byFamily: Record<string, { total: number; passed: number }>;
};

export type EvalReport = {
  suites: SuiteResult[];
  /** Headline, from the clean suites. */
  falseBlockRate: number | null;
  falseModificationRate: number | null;
  detectionRate: number | null;
  detectionByFamily: Record<string, { total: number; caught: number }>;
  collateral: number;
  thresholds: Thresholds;
  failures: string[];
  durationMs: number;
};
