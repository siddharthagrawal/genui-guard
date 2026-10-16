import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // types.ts is declarations only, so it has no statements to cover.
      exclude: ["src/**/*.test.ts", "src/**/*.bench.ts", "src/index.ts", "src/types.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
