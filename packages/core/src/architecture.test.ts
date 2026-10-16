import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

function sourceFiles(): string[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".bench.ts"));
}

/**
 * The claim that genui-guard is a layer rather than a plugin for one renderer is
 * only credible if core can run against a second catalog. That is impossible
 * once a renderer's types have spread through core, and it would be expensive
 * to retrofit, so it is asserted rather than remembered.
 *
 * See the decision log entry on keeping the core free of renderer types.
 */
describe("core stays renderer agnostic", () => {
  const files = sourceFiles();

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)("%s does not import a renderer", (file) => {
    const source = readFileSync(join(SRC, file), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);

    const renderers = [
      "json-render",
      "assistant-ui",
      "a2ui",
      "ag-ui",
      "react",
      "next",
      "vue",
      "svelte",
    ];

    for (const specifier of imports) {
      for (const renderer of renderers) {
        expect(
          specifier.includes(renderer),
          `${file} imports "${specifier}". Renderer specifics belong in an adapter package.`,
        ).toBe(false);
      }
    }
  });

  it("depends on nothing at runtime but zod", () => {
    const pkg = JSON.parse(
      readFileSync(join(SRC, "..", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };

    expect(pkg.dependencies ?? {}).toEqual({});
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual(["zod"]);
  });

  it("only imports node builtins in tests, never in shipped code", () => {
    for (const file of files) {
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source, `${file} should not reach for node builtins`).not.toMatch(
        /from\s+["']node:/,
      );
    }
  });
});
