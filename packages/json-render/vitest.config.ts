import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
  resolve: {
    alias: {
      "@genui-guard/core": resolve(import.meta.dirname, "../core/src/index.ts"),
    },
  },
});
