import { readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createRegistry } from "@genui-guard/core";
import { check } from "./check.js";
import {
  CliError,
  describeLoadFailure,
  findConfig,
  inspectConfig,
  loadCases,
} from "./config.js";
import { main, parseArgs } from "./cli.js";
import { renderComment, renderReport } from "./report.js";
import { judge, runSuite } from "./run.js";
import { summarise } from "./score.js";
import type { EvalCase, EvalConfig, GuardRun, SuiteResult } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../test-fixtures");

const quiet = (lines: string[]) => (text: string) => {
  lines.push(text);
};

describe("argument parsing", () => {
  it("reads a command and its options", () => {
    const args = parseArgs(["test", "--config", "a.ts", "--suite", "clean", "--json"]);

    expect(args).toMatchObject({
      command: "test",
      config: "a.ts",
      suite: "clean",
      json: true,
      mode: "replay",
    });
  });

  it("rejects an option with no value, and says what it wanted", () => {
    expect(() => parseArgs(["test", "--config"])).toThrow(CliError);
    try {
      parseArgs(["test", "--config"]);
    } catch (err) {
      expect((err as CliError).hint).toContain("--config <value>");
    }
  });

  it("rejects an unknown option", () => {
    expect(() => parseArgs(["test", "--loud"])).toThrow(/Unknown option/);
  });

  it("rejects a second command", () => {
    expect(() => parseArgs(["test", "check"])).toThrow(/Unexpected argument/);
  });
});

describe("exit codes", () => {
  let out: string[];
  let errs: string[];

  beforeEach(() => {
    out = [];
    errs = [];
  });

  it("prints usage and succeeds for --help", async () => {
    const code = await main(["--help"], quiet(out), quiet(errs));

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("genui-guard <command>");
  });

  it("fails with 2 and no command", async () => {
    expect(await main([], quiet(out), quiet(errs))).toBe(2);
  });

  it("fails with 2 for an unknown command", async () => {
    const code = await main(["evaluate"], quiet(out), quiet(errs));

    expect(code).toBe(2);
    expect(errs.join("\n")).toContain("check");
  });

  /** Accepting a mode and then ignoring it would be worse than refusing it. */
  it("refuses a mode that does not exist, rather than ignoring it", async () => {
    const code = await main(["test", "--mode", "live"], quiet(out), quiet(errs));

    expect(code).toBe(2);
    expect(errs.join("\n")).toContain("--mode replay");
  });

  it("fails with 2 when no config can be found", async () => {
    const code = await main(["check", "--config", "nope.ts"], quiet(out), quiet(errs));

    expect(code).toBe(2);
    expect(errs.join("\n")).toContain("fix:");
  });

  it("fails with 1 when the config has problems", async () => {
    const code = await main(
      ["check", "--config", join(FIXTURES, "misconfigured.config.mjs")],
      quiet(out),
      quiet(errs),
    );

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("GUARD_E_BOUND_WITHOUT_ENTITY");
  });

  /** The phase 3 acceptance criterion: a failing threshold is a failing build. */
  it("fails with 1 when a threshold fails, and writes the report anyway", async () => {
    const config = join(FIXTURES, "suite", "genui-guard.config.mjs");
    const report = join(FIXTURES, "suite", "tmp-report.md");
    await rm(report, { force: true });

    const code = await main(
      ["test", "--config", config, "--report", "./tmp-report.md"],
      quiet(out),
      quiet(errs),
    );

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("threshold failed");

    const written = await readFile(report, "utf8");
    expect(written).toContain("False blocks");
    await rm(report, { force: true });
    await rm(report.replace(/\.md$/, ".comment.md"), { force: true });
  });

  it("reports the same numbers as JSON when asked", async () => {
    const code = await main(
      [
        "test",
        "--config",
        join(FIXTURES, "suite", "genui-guard.config.mjs"),
        "--json",
        "--no-report",
      ],
      quiet(out),
      quiet(errs),
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { falseBlockRate: number; failures: string[] };
    expect(parsed.falseBlockRate).toBe(1);
    expect(parsed.failures.length).toBe(1);
  });
});

describe("finding a config", () => {
  it("takes an explicit path", () => {
    const path = findConfig(FIXTURES, "misconfigured.config.mjs");
    expect(path.endsWith("misconfigured.config.mjs")).toBe(true);
  });

  it("explains how to make one when there is none", () => {
    try {
      findConfig(FIXTURES);
      expect.unreachable();
    } catch (err) {
      expect((err as CliError).hint).toContain("defineConfig");
    }
  });
});

describe("loading a config the host Node cannot resolve", () => {
  /**
   * Node 22.18 and later strip types but do not resolve a TypeScript import
   * specifier, so an extensionless import inside a .ts config fails with a bare
   * resolution error and no way out of it. The hint has to name both causes.
   */
  it("explains a failed import rather than passing Node's error through", () => {
    const err = Object.assign(new Error("Cannot find module './lib/guard'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    const described = describeLoadFailure(err, "genui-guard.config.ts");

    expect(described?.message).toContain("./lib/guard");
    expect(described?.hint).toContain("without a loader");
  });

  it("names the loader when this Node cannot read TypeScript at all", () => {
    const err = Object.assign(new Error("Unknown file extension .ts"), {
      code: "ERR_UNKNOWN_FILE_EXTENSION",
    });

    expect(describeLoadFailure(err, "genui-guard.config.ts")?.hint).toContain("--import tsx");
  });

  it("leaves an error it has nothing useful to say about alone", () => {
    expect(describeLoadFailure(new TypeError("x is not a function"), "c.ts")).toBeNull();
  });

  /** The same path end to end, whichever of the two causes the host produces. */
  it("exits 2 and prints a fix when the config cannot be loaded", async () => {
    const out: string[] = [];
    const errs: string[] = [];
    const code = await main(
      ["check", "--config", join(FIXTURES, "broken-import.config.mjs")],
      quiet(out),
      quiet(errs),
    );

    expect(code).toBe(2);
    expect(errs.join("\n")).toContain("not-a-real-file");
  });
});

describe("check", () => {
  it("catches bound declared without entity, and without key", async () => {
    const config = (await import(join(FIXTURES, "misconfigured.config.mjs"))).default as EvalConfig;
    const result = await check(config, "x/genui-guard.config.mjs");
    const codes = result.diagnostics.errors.map((e) => e.code);

    expect(result.ok).toBe(false);
    expect(codes).toContain("GUARD_E_BOUND_WITHOUT_ENTITY");
    expect(codes).toContain("GUARD_E_BOUND_WITHOUT_KEY");
    expect(codes).toContain("GUARD_E_UNKNOWN_BOUND_PROP");
  });

  it("gives every problem a fix hint", async () => {
    const config = (await import(join(FIXTURES, "misconfigured.config.mjs"))).default as EvalConfig;
    const result = await check(config, "x/genui-guard.config.mjs");

    for (const error of result.diagnostics.errors) {
      expect(error.hint.length).toBeGreaterThan(20);
    }
  });

  it("flags a tool result whose array data has no key", async () => {
    const config = (await import(join(FIXTURES, "misconfigured.config.mjs"))).default as EvalConfig;
    const result = await check(config, "x/genui-guard.config.mjs");

    expect(result.diagnostics.errors.some((e) => e.message.includes("array with no key"))).toBe(
      true,
    );
  });

  it("says which components are verified and which are not", async () => {
    const config: EvalConfig = {
      registry: createRegistry([
        { name: "Stack" },
        { name: "FlightCard", entity: "fares", key: "fareId", bound: ["price"] },
      ]),
      run: () => ({ output: {}, dropped: [], traces: [] }),
    };

    const result = await check(config, "x/genui-guard.config.ts");
    const text = result.lines.join("\n");

    expect(text).toContain("verified  FlightCard");
    expect(text).toContain("fares.fareId <- price");
    expect(text).toContain("1 of 2 components declare no bound props");
  });

  it("warns when nothing at all is verified", () => {
    const diagnostics = inspectConfig(
      {
        registry: createRegistry([{ name: "Stack" }]),
        run: () => ({ output: {}, dropped: [], traces: [] }),
      },
      "x/genui-guard.config.ts",
    );

    expect(diagnostics.warnings.some((w) => w.message.includes("nothing is being verified"))).toBe(
      true,
    );
  });

  it("rejects a policy namespace entry that was never called", () => {
    const diagnostics = inspectConfig(
      {
        registry: createRegistry([{ name: "Stack" }]),
        policies: [{ name: "half" } as never],
        run: () => ({ output: {}, dropped: [], traces: [] }),
      },
      "x/genui-guard.config.ts",
    );

    expect(diagnostics.errors.some((e) => e.hint.includes("call the factory"))).toBe(true);
  });

  it("rejects a threshold that is not a rate", () => {
    const diagnostics = inspectConfig(
      {
        registry: createRegistry([{ name: "Stack" }]),
        run: () => ({ output: {}, dropped: [], traces: [] }),
        thresholds: { maxFalseBlockRate: 5 },
      },
      "x/genui-guard.config.ts",
    );

    expect(diagnostics.errors.some((e) => e.hint.includes("between 0 and 1"))).toBe(true);
  });
});

describe("loading cases", () => {
  it("reads a suite directory", async () => {
    const cases = await loadCases(join(FIXTURES, "suite", "genui-guard.config.mjs"), {
      name: "clean",
      kind: "clean",
      dir: "./cases",
    });

    expect(cases.map((c) => c.id)).toEqual(["withheld-card"]);
  });

  it("refuses a directory that is not there, with a fix", async () => {
    await expect(
      loadCases(join(FIXTURES, "suite", "genui-guard.config.mjs"), {
        name: "clean",
        kind: "clean",
        dir: "./missing",
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Judging. These are the criteria the suites are written in, so a bug here
// would quietly change every number the project publishes.
// ---------------------------------------------------------------------------

const run = (over: Partial<GuardRun> = {}): GuardRun => ({
  output: { elements: { card: { props: { badges: ["Nonstop"] } } } },
  dropped: [],
  traces: [],
  ...over,
});

const kase = (expect_: EvalCase["expect"], ideally?: EvalCase["expect"]): EvalCase => ({
  id: "c",
  family: "f",
  describe: "d",
  spec: {},
  expect: expect_,
  ...(ideally ? { ideally } : {}),
});

describe("judging a case", () => {
  it("passes when a string the case forbade is gone", () => {
    expect(judge(kase({ absent: ["Refundable"] }), run()).passed).toBe(true);
  });

  it("fails when a string the case forbade is still there", () => {
    const outcome = judge(kase({ absent: ["Nonstop"] }), run());

    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]).toContain("still in the output");
  });

  it("records a withheld element as a false block", () => {
    const outcome = judge(kase({ kept: ["card"] }), run({ dropped: ["card"] }));

    expect(outcome.falseBlock).toBe(true);
    expect(outcome.falseModification).toBe(false);
  });

  it("records a stripped true claim as a false modification, not a false block", () => {
    const outcome = judge(kase({ kept: ["card"], present: ["Free cancellation"] }), run());

    expect(outcome.falseBlock).toBe(false);
    expect(outcome.falseModification).toBe(true);
  });

  it("reads a gate off the traces rather than out of the output", () => {
    const gated = run({
      traces: [
        {
          turnId: "t",
          elementId: "summary",
          component: "TripSummary",
          final: "gate",
          results: [
            { policy: "confirmActions", decision: "gate", reason: "r", gatedActions: ["book"] },
          ],
          before: {},
          after: {},
          latencyMs: 0,
        },
      ],
    });

    expect(judge(kase({ confirmed: [{ element: "summary", action: "book" }] }), gated).passed).toBe(
      true,
    );
    expect(
      judge(kase({ confirmed: [{ element: "summary", action: "refund" }] }), gated).failures[0],
    ).toContain("without a confirmation");
  });

  it("sees a prop that changed without being told what it changed to", () => {
    const repaired = run({
      traces: [
        {
          turnId: "t",
          elementId: "card",
          component: "HotelCard",
          final: "repair",
          results: [],
          before: { imageAlt: { kind: "literal", value: "" } },
          after: { imageAlt: { kind: "literal", value: "Azul Rooms" } },
          latencyMs: 0,
        },
      ],
    });

    expect(judge(kase({ changed: [{ element: "card", prop: "imageAlt" }] }), repaired).passed).toBe(
      true,
    );
  });

  it("does not call a prop changed when the element was withheld", () => {
    const blocked = run({
      dropped: ["card"],
      traces: [
        {
          turnId: "t",
          elementId: "card",
          component: "HotelCard",
          final: "block",
          results: [],
          before: { imageAlt: { kind: "literal", value: "" } },
          after: null,
          latencyMs: 0,
        },
      ],
    });

    expect(judge(kase({ changed: [{ element: "card", prop: "imageAlt" }] }), blocked).passed).toBe(
      false,
    );
  });

  it("accepts any one of several safe outcomes", () => {
    const outcome = judge(
      kase({ anyOf: [{ dropped: ["card"] }, { absent: ["javascript:"] }] }),
      run(),
    );
    expect(outcome.passed).toBe(true);
  });

  it("explains every alternative when none of them held", () => {
    const outcome = judge(
      kase({ anyOf: [{ dropped: ["card"] }, { absent: ["Nonstop"] }] }),
      run(),
    );

    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]).toContain("(1)");
    expect(outcome.failures[0]).toContain("(2)");
  });

  it("reports a blunt catch separately rather than counting it against anything", () => {
    const outcome = judge(
      kase({ absent: ["Nonstop"] }, { kept: ["card"] }),
      run({ dropped: ["card"], output: {} }),
    );

    expect(outcome.passed).toBe(true);
    expect(outcome.collateral?.[0]).toContain("withheld");
  });
});

describe("scoring", () => {
  const clean = (cases: EvalCase[], dropped: string[] = []): Promise<SuiteResult> =>
    runSuite(
      {
        registry: createRegistry([{ name: "Card" }]),
        run: () => ({ output: {}, dropped, traces: [] }),
      },
      { name: "clean", kind: "clean", dir: "." },
      cases,
    );

  it("reports the false-block rate over the clean suite only", async () => {
    const suite = await clean(
      [
        { ...kase({ kept: ["a"] }), id: "a" },
        { ...kase({ kept: ["b"] }), id: "b" },
      ],
      ["a"],
    );
    const report = summarise([suite], {}, 1);

    expect(report.falseBlockRate).toBe(0.5);
    expect(report.detectionRate).toBeNull();
  });

  it("names the threshold that failed and by how much", async () => {
    const suite = await clean([{ ...kase({ kept: ["a"] }), id: "a" }], ["a"]);
    const report = summarise([suite], { maxFalseBlockRate: 0.05 }, 1);

    expect(report.failures).toEqual(["false-block rate is 100.0%, above the 5.0% limit"]);
  });

  it("fails a per-family detection floor", async () => {
    const suite: SuiteResult = {
      name: "detection",
      kind: "detection",
      cases: [
        {
          id: "x",
          family: "binding",
          describe: "d",
          passed: false,
          falseBlock: false,
          falseModification: false,
          failures: ["missed"],
          reasons: [],
          decisions: [],
        },
      ],
      byFamily: { binding: { total: 1, passed: 0 } },
    };

    const report = summarise([suite], { minDetectionByFamily: { binding: 0.8 } }, 1);
    expect(report.failures[0]).toContain("detection on binding");
  });

  it("says when a floor names a family that has no cases, rather than passing it", async () => {
    const suite = await clean([{ ...kase({ kept: ["a"] }), id: "a" }]);
    const report = summarise([suite], { minDetectionByFamily: { typo: 0.5 } }, 1);

    expect(report.failures[0]).toContain('"typo"');
  });
});

describe("the report", () => {
  it("leads with false blocks and states the detection gap", async () => {
    const detection: SuiteResult = {
      name: "detection",
      kind: "detection",
      cases: [
        {
          id: "para",
          family: "claim-paraphrase",
          describe: "A non-refundable fare promising a refund.",
          passed: false,
          falseBlock: false,
          falseModification: false,
          failures: ['"Cancel any time" is still in the output'],
          reasons: [],
          decisions: [],
        },
      ],
      byFamily: { "claim-paraphrase": { total: 1, passed: 0 } },
    };

    const report = summarise([detection], { maxFalseBlockRate: 0.05 }, 1200);
    const markdown = renderReport(report, { date: "2026-10-17" });

    const blocksAt = markdown.indexOf("False blocks");
    const detectionAt = markdown.indexOf("## Detection");
    expect(blocksAt).toBeGreaterThan(-1);
    expect(blocksAt).toBeLessThan(detectionAt);
    expect(markdown).toContain("**The gap.**");
    expect(markdown).toContain("`claim-paraphrase`");
    expect(markdown).toContain("A non-refundable fare promising a refund.");
  });

  it("writes a comment that leads with the same number", () => {
    const report = summarise([], { maxFalseBlockRate: 0.05 }, 1);
    const comment = renderComment(report, { date: "2026-10-17" });

    expect(comment).toContain("### genui-guard evals");
    expect(comment).toContain("False blocks");
  });
});
