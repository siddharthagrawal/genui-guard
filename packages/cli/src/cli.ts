#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./check.js";
import { CliError, findConfig, loadCases, loadConfig } from "./config.js";
import { renderComment, renderReport } from "./report.js";
import { runSuite } from "./run.js";
import { pct, summarise } from "./score.js";
import type { EvalConfig, SuiteResult } from "./types.js";

const USAGE = `genui-guard <command> [options]

Commands
  check                 Validate the config and the registry, and say what is protected
  test                  Run the eval suites and write the report

Options
  --config <path>       Config file. Defaults to genui-guard.config.ts in the current directory
  --mode <mode>         Only "replay" is supported, which is the default and uses no network
  --suite <name>        Run one suite rather than all of them
  --report <path>       Where to write the report. Overrides the config
  --json                Print the result as JSON instead of prose
  --no-report           Do not write the report file
  -h, --help            This

Exit codes
  0  passed
  1  a threshold failed, or the config has problems
  2  the command could not run
`;

type Args = {
  command: string | undefined;
  config?: string;
  mode: string;
  suite?: string;
  report?: string;
  json: boolean;
  writeReport: boolean;
  help: boolean;
};

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: undefined,
    mode: "replay",
    json: false,
    writeReport: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliError(`${arg} needs a value.`, `For example: ${arg} <value>.`);
      }
      i += 1;
      return value;
    };

    if (arg === "-h" || arg === "--help") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--no-report") args.writeReport = false;
    else if (arg === "--config") args.config = next();
    else if (arg === "--mode") args.mode = next();
    else if (arg === "--suite") args.suite = next();
    else if (arg === "--report") args.report = next();
    else if (arg.startsWith("-")) {
      throw new CliError(`Unknown option ${arg}.`, "Run `genui-guard --help` for the list.");
    } else if (!args.command) args.command = arg;
    else {
      throw new CliError(
        `Unexpected argument "${arg}".`,
        "There is one command per invocation. Run `genui-guard --help` for the list.",
      );
    }
  }

  return args;
}

export async function main(argv: string[], log = console.log, err = console.error): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    err(format(error));
    return 2;
  }

  if (args.help) {
    log(USAGE);
    return 0;
  }
  if (!args.command) {
    err(USAGE);
    return 2;
  }

  if (args.command !== "check" && args.command !== "test") {
    err(
      format(
        new CliError(
          `Unknown command "${args.command}".`,
          "The commands are `check` and `test`. Run `genui-guard --help`.",
        ),
      ),
    );
    return 2;
  }

  // Only replay exists today. Accepting a mode and then quietly ignoring it
  // would be worse than refusing one that is not implemented.
  if (args.mode !== "replay") {
    err(
      format(
        new CliError(
          `Mode "${args.mode}" is not supported.`,
          "Only --mode replay exists, which runs the recorded suites with no network access. Live-model evals are on the roadmap.",
        ),
      ),
    );
    return 2;
  }

  let config: EvalConfig;
  let configFile: string;
  try {
    configFile = findConfig(process.cwd(), args.config);
    config = await loadConfig(configFile);
  } catch (error) {
    err(format(error));
    return 2;
  }

  if (args.command === "check") {
    const result = await check(config, configFile);
    if (args.json) {
      log(JSON.stringify({ ok: result.ok, ...result.diagnostics }, null, 2));
    } else {
      log(result.lines.join("\n"));
    }
    return result.ok ? 0 : 1;
  }

  return await test(config, configFile, args, log, err);
}

async function test(
  config: EvalConfig,
  configFile: string,
  args: Args,
  log: (s: string) => void,
  err: (s: string) => void,
): Promise<number> {
  const diagnostics = (await check(config, configFile)).diagnostics;
  if (diagnostics.errors.length > 0) {
    err("The config has problems, so the suites were not run.\n");
    for (const error of diagnostics.errors) {
      err(`error  ${error.code ? `${error.code}: ` : ""}${error.message}`);
      err(`  fix: ${error.hint}`);
    }
    return 1;
  }

  const wanted = (config.suites ?? []).filter((s) => !args.suite || s.name === args.suite);
  if (wanted.length === 0) {
    err(
      format(
        new CliError(
          args.suite ? `No suite named "${args.suite}".` : "The config declares no suites.",
          args.suite
            ? `Configured suites are [${(config.suites ?? []).map((s) => s.name).join(", ")}].`
            : 'Add suites: [{ name: "clean", kind: "clean", dir: "./cases/clean" }].',
        ),
      ),
    );
    return 2;
  }

  const started = Date.now();
  const results: SuiteResult[] = [];
  for (const suite of wanted) {
    const cases = await loadCases(configFile, suite);
    results.push(await runSuite(config, suite, cases));
  }

  const report = summarise(results, config.thresholds ?? {}, Date.now() - started);
  const date = new Date().toISOString().slice(0, 10);

  if (args.json) {
    log(
      JSON.stringify(
        {
          falseBlockRate: report.falseBlockRate,
          falseModificationRate: report.falseModificationRate,
          detectionRate: report.detectionRate,
          detectionByFamily: report.detectionByFamily,
          collateral: report.collateral,
          failures: report.failures,
          durationMs: report.durationMs,
          suites: report.suites.map((s) => ({
            name: s.name,
            kind: s.kind,
            total: s.cases.length,
            passed: s.cases.filter((c) => c.passed).length,
            falseBlocks: s.cases.filter((c) => c.falseBlock).map((c) => c.id),
            falseModifications: s.cases.filter((c) => c.falseModification).map((c) => c.id),
            missed: s.cases.filter((c) => !c.passed).map((c) => c.id),
          })),
        },
        null,
        2,
      ),
    );
  } else {
    for (const suite of report.suites) {
      const passed = suite.cases.filter((c) => c.passed).length;
      log(`${suite.name.padEnd(10)} ${passed}/${suite.cases.length} ${suite.kind === "clean" ? "untouched" : "caught"}`);
    }
    log("");
    log(`false blocks         ${pct(report.falseBlockRate)}   <- the headline`);
    log(`false modifications  ${pct(report.falseModificationRate)}`);
    log(`detection            ${pct(report.detectionRate)}`);
    log("");
    for (const failure of report.failures) log(`threshold failed: ${failure}`);
  }

  const reportPath = args.report ?? config.reportPath;
  if (args.writeReport && reportPath) {
    const path = resolve(dirname(configFile), reportPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderReport(report, { date }), "utf8");
    const commentPath = path.replace(/\.md$/, ".comment.md");
    await writeFile(commentPath, renderComment(report, { date }), "utf8");
    if (!args.json) {
      log("");
      log(`report ${path}`);
    }
  }

  return report.failures.length > 0 ? 1 : 0;
}

function format(error: unknown): string {
  if (error instanceof CliError) return `${error.message}\n  fix: ${error.hint}`;
  const hint = (error as { hint?: string }).hint;
  const message = error instanceof Error ? error.message : String(error);
  return hint ? `${message}\n  fix: ${hint}` : message;
}

// Run only when invoked as a program, so the tests can import main directly.
// Both sides are real paths, because the bin arrives as a symlink.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
