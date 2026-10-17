import { inspectConfig, loadCases, type Diagnostics } from "./config.js";
import type { EvalConfig } from "./types.js";

export type CheckResult = {
  diagnostics: Diagnostics;
  lines: string[];
  ok: boolean;
};

/**
 * `genui-guard check`. Reports what is protected, what is not, and every config
 * problem with a way to fix it. The most valuable line it prints is usually the
 * one about a component with no bound props, because that is protection someone
 * thinks they have.
 */
export async function check(config: EvalConfig, configFile: string): Promise<CheckResult> {
  const diagnostics = inspectConfig(config, configFile);
  const lines: string[] = [];

  lines.push(`config  ${configFile}`);

  if (config.registry && typeof config.registry.names === "function") {
    const names = config.registry.names();
    lines.push("");
    lines.push("components");

    const rows = names.map((name) => {
      const spec = config.registry.get(name);
      const bound = spec?.bound ?? [];
      const a11y = [
        ...(spec?.a11y?.requireAlt ?? []).map((p) => `alt:${p}`),
        ...(spec?.a11y?.requireLabel ?? []).map((p) => `label:${p}`),
      ];
      return {
        name,
        verified: bound.length > 0,
        detail: bound.length > 0 ? `${spec?.entity}.${spec?.key} <- ${bound.join(", ")}` : "",
        extra: [
          spec?.props ? "" : "no prop schema",
          spec?.fallback ? `fallback ${spec.fallback}` : "",
          ...a11y,
        ].filter(Boolean),
      };
    });

    const width = Math.max(...rows.map((r) => r.name.length), 4);
    for (const row of rows) {
      const mark = row.verified ? "verified" : "        ";
      const extras = row.extra.length > 0 ? `  (${row.extra.join(", ")})` : "";
      lines.push(`  ${mark}  ${row.name.padEnd(width)}  ${row.detail}${extras}`);
    }

    const unverified = rows.filter((r) => !r.verified).map((r) => r.name);
    if (unverified.length > 0) {
      lines.push("");
      lines.push(
        `  ${unverified.length} of ${rows.length} components declare no bound props, so nothing on them is checked against tool results: ${unverified.join(", ")}.`,
      );
      lines.push(
        `  That is correct for containers and inputs. For anything that shows sourced data it is a gap.`,
      );
    }
  }

  if (config.policies && Array.isArray(config.policies)) {
    lines.push("");
    lines.push(`policies, in order`);
    for (const policy of config.policies) {
      lines.push(`  ${typeof policy?.name === "string" ? policy.name : "(invalid)"}`);
    }
  }

  if (config.suites && config.suites.length > 0) {
    lines.push("");
    lines.push("suites");
    for (const suite of config.suites) {
      try {
        const cases = await loadCases(configFile, suite);
        const families = new Set(cases.map((c) => c.family));
        lines.push(
          `  ${suite.name.padEnd(10)} ${String(cases.length).padStart(3)} cases  ${families.size} families  (${suite.kind})`,
        );
      } catch (err) {
        diagnostics.errors.push({
          message: `Suite "${suite.name}" could not be loaded: ${(err as Error).message}`,
          hint: (err as { hint?: string }).hint ?? "Fix the case module named above.",
        });
      }
    }
  }

  if (diagnostics.warnings.length > 0) {
    lines.push("");
    for (const warning of diagnostics.warnings) {
      lines.push(`warning  ${warning.message}`);
      lines.push(`  fix: ${warning.hint}`);
    }
  }

  if (diagnostics.errors.length > 0) {
    lines.push("");
    for (const error of diagnostics.errors) {
      lines.push(`error  ${error.code ? `${error.code}: ` : ""}${error.message}`);
      lines.push(`  fix: ${error.hint}`);
    }
    lines.push("");
    lines.push(
      `${diagnostics.errors.length} problem${diagnostics.errors.length === 1 ? "" : "s"} to fix.`,
    );
  } else {
    lines.push("");
    lines.push("No problems found.");
  }

  return { diagnostics, lines, ok: diagnostics.errors.length === 0 };
}
