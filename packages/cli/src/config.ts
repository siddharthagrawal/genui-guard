import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { lintRegistry } from "@genui-guard/core";
import type { EvalCase, EvalConfig, SuiteConfig } from "./types.js";

export function defineConfig<Spec = unknown>(config: EvalConfig<Spec>): EvalConfig<Spec> {
  return config;
}

/**
 * Every failure out of this module carries a fix hint, because these all fire
 * during setup, when someone has described their catalog slightly wrong and has
 * no mental model yet to debug against. See docs/decisions.md.
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

const CONFIG_NAMES = [
  "genui-guard.config.ts",
  "genui-guard.config.mts",
  "genui-guard.config.js",
  "genui-guard.config.mjs",
];

export function findConfig(cwd: string, explicit?: string): string {
  if (explicit) {
    const path = isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
    if (!existsSync(path)) {
      throw new CliError(
        `No config file at ${path}.`,
        "Check the path given to --config, or drop the flag to look for genui-guard.config.ts in the current directory.",
      );
    }
    return path;
  }

  for (const name of CONFIG_NAMES) {
    const path = resolve(cwd, name);
    if (existsSync(path)) return path;
  }

  throw new CliError(
    `No genui-guard config found in ${cwd}.`,
    // Do not point at examples/genui-guard.config.ts here. That file is a
    // *guard* config, exporting a guard rather than a default eval config, so
    // following the pointer produced "does not export a config" next. It is
    // also not in the published tarball, so for an npm consumer the path does
    // not exist at all.
    `Create genui-guard.config.ts with \`export default defineConfig({ registry, run, suites })\`, or pass --config <path>. The config shape, including the \`run\` adapter, is documented in this package's README, and there is a working one at evals/genui-guard.config.ts in the genui-guard repository.`,
  );
}

/**
 * Loads a module whichever way the host Node can. Type stripping covers this on
 * Node 22.18 and later; before that a TypeScript config needs a loader, and
 * saying which one is more use than reporting the extension back.
 */
export async function loadModule(file: string): Promise<Record<string, unknown>> {
  try {
    return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch (err) {
    throw describeLoadFailure(err, file) ?? err;
  }
}

/**
 * Turns a module-loading failure into something with a way out of it. Separate
 * from `loadModule` so it can be tested against the codes Node produces, which
 * a test runner's own module loader does not reproduce.
 */
export function describeLoadFailure(err: unknown, file: string): CliError | null {
  const code = (err as { code?: string }).code;

  if (code === "ERR_UNKNOWN_FILE_EXTENSION" || code === "ERR_UNSUPPORTED_ESM_URL_SCHEME") {
    return new CliError(
      `This Node cannot load ${file} on its own.`,
      "Run the CLI under a TypeScript loader, for example `node --import tsx node_modules/.bin/genui-guard test`, or point --config at compiled JavaScript. Node 22.18 and later load .ts files without a loader.",
    );
  }

  // Node's own type stripping resolves a .ts file but not a TypeScript import
  // specifier: an extensionless path, or the ".js" convention that means a
  // ".ts" file. Both are ordinary in a TypeScript project and both land here,
  // so the hint has to cover that as well as a module that is simply missing.
  if (code === "ERR_MODULE_NOT_FOUND") {
    return new CliError(
      err instanceof Error ? err.message : `Something ${file} imports could not be found.`,
      "If that import has no extension, or ends in .js and names a .ts file, Node cannot resolve it without a loader: run `node --import tsx node_modules/.bin/genui-guard ...`. If it is a package, it is missing from the dependencies of the file that imported it.",
    );
  }

  return null;
}

export async function loadConfig(file: string): Promise<EvalConfig> {
  const mod = await loadModule(file);
  const config = (mod.default ?? mod.config) as EvalConfig | undefined;

  if (!config || typeof config !== "object") {
    throw new CliError(
      `${file} does not export a config.`,
      "Add `export default defineConfig({ ... })` to the config file.",
    );
  }
  return config;
}

export type Diagnostic = { message: string; hint: string; code?: string };

export type Diagnostics = {
  errors: Diagnostic[];
  warnings: Diagnostic[];
};

/**
 * Config problems a developer should hear about at setup rather than at runtime.
 * The registry half delegates to core's own lint, so `genui-guard check` and
 * `createGuard` can never disagree about what is valid.
 */
export function inspectConfig(config: EvalConfig, configFile: string): Diagnostics {
  const out: Diagnostics = { errors: [], warnings: [] };

  if (!config.registry || typeof config.registry.names !== "function") {
    out.errors.push({
      message: "The config has no registry.",
      hint: "Build one with fromJsonRender(catalog, rules) from @genui-guard/json-render, or createRegistry([...]) from @genui-guard/core.",
    });
  } else {
    for (const error of lintRegistry(config.registry)) {
      out.errors.push({ message: error.message, hint: error.hint, code: error.code });
    }

    const names = config.registry.names();
    if (names.length === 0) {
      out.errors.push({
        message: "The registry has no components.",
        hint: "Check that the catalog passed to fromJsonRender is the one your renderer uses.",
      });
    }

    const unprotected = names.filter((n) => (config.registry.get(n)?.bound ?? []).length === 0);
    if (unprotected.length === names.length && names.length > 0) {
      out.warnings.push({
        message: `No component declares bound props, so nothing is being verified against tool results.`,
        hint: `Add bound props to the components that show sourced data, for example { entity: "fares", key: "fareId", bound: ["price"] }.`,
      });
    }
  }

  if (config.policies) {
    if (!Array.isArray(config.policies)) {
      out.errors.push({
        message: "`policies` is not an array.",
        hint: "Pass a list, in the order you want them applied: policies: [p.requireBinding(), ...].",
      });
    } else {
      const seen = new Set<string>();
      for (const [i, policy] of config.policies.entries()) {
        if (!policy || typeof policy.check !== "function" || typeof policy.name !== "string") {
          out.errors.push({
            message: `policies[${i}] is not a policy.`,
            hint: "Each entry needs a `name` and a `check(input)`. Use the `policies` namespace from @genui-guard/core, and call the factory: p.safeUrls({}) rather than p.safeUrls.",
          });
          continue;
        }
        if (seen.has(policy.name)) {
          out.warnings.push({
            message: `The policy "${policy.name}" appears more than once.`,
            hint: "Two instances of one policy both run, and the strictest decision wins. That is sometimes deliberate, so this is a warning rather than an error.",
          });
        }
        seen.add(policy.name);
      }
    }
  }

  for (const result of config.tools ?? []) {
    const label = result.toolName ? `tool result "${result.toolName}"` : "a tool result";
    if (!result.entity) {
      out.errors.push({
        message: `${label} has no entity.`,
        hint: "Set `entity` to the state namespace this result populates, for example \"fares\". That namespace becomes the guard's for the turn.",
      });
    }
    if (Array.isArray(result.data) && !result.key) {
      out.errors.push({
        message: `${label} is an array with no key.`,
        hint: 'Set `key` to the field that identifies one record, for example "fareId", so records are addressed by identity rather than by position.',
      });
    }
  }

  if (typeof config.run !== "function") {
    out.errors.push({
      message: "The config has no `run` adapter.",
      hint: "Pass the renderer adapter that puts a spec through the guard, for example run: ({ guard, spec, ctx }) => guardSpec(guard, spec, ctx).then(r => ({ output: r.spec, dropped: r.dropped, traces: r.traces })).",
    });
  }

  const base = dirname(configFile);
  for (const suite of config.suites ?? []) {
    const dir = resolve(base, suite.dir);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      out.errors.push({
        message: `Suite "${suite.name}" points at ${dir}, which is not a directory.`,
        hint: "Create the directory, or correct `dir` in the suite entry. Paths are resolved from the config file.",
      });
    }
    if (suite.kind !== "detection" && suite.kind !== "clean") {
      out.errors.push({
        message: `Suite "${suite.name}" has kind "${String(suite.kind)}".`,
        hint: 'Use "detection" for held-out failures, or "clean" for legitimate components that must pass untouched.',
      });
    }
  }

  if (!config.suites || config.suites.length === 0) {
    out.warnings.push({
      message: "The config declares no suites, so `genui-guard test` has nothing to run.",
      hint: 'Add suites: [{ name: "clean", kind: "clean", dir: "./cases/clean" }].',
    });
  }

  for (const [name, value] of Object.entries(config.thresholds ?? {})) {
    if (typeof value === "number" && (value < 0 || value > 1)) {
      out.errors.push({
        message: `Threshold ${name} is ${value}.`,
        hint: "Thresholds are rates between 0 and 1. 0.05 means five per cent.",
      });
    }
  }

  return out;
}

/** Case modules in a suite directory, in a stable order so reports diff cleanly. */
export async function suiteFiles(configFile: string, suite: SuiteConfig): Promise<string[]> {
  const dir = resolve(dirname(configFile), suite.dir);
  const entries = await readdir(dir);
  return entries
    .filter((f) => /\.(ts|mts|js|mjs)$/.test(f) && !f.endsWith(".d.ts"))
    .sort()
    .map((f) => join(dir, f));
}

export async function loadCases(configFile: string, suite: SuiteConfig): Promise<EvalCase[]> {
  const files = await suiteFiles(configFile, suite);
  const cases: EvalCase[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const mod = await loadModule(file);
    const exported = (mod.cases ?? mod.default) as EvalCase[] | undefined;
    if (!Array.isArray(exported)) {
      throw new CliError(
        `${file} does not export a case list.`,
        "Each case module needs `export const cases: EvalCase[] = [...]`.",
      );
    }
    for (const c of exported) {
      const previous = seen.get(c.id);
      if (previous) {
        throw new CliError(
          `Two cases share the id "${c.id}", in ${previous} and ${file}.`,
          "Case ids appear in the report and in threshold failures, so they have to be unique. Rename one.",
        );
      }
      seen.set(c.id, file);
      cases.push(c);
    }
  }

  if (cases.length === 0) {
    throw new CliError(
      `Suite "${suite.name}" has no cases.`,
      `Add a case module to ${suite.dir}, exporting \`cases\`.`,
    );
  }
  return cases;
}
