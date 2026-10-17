import { createRegistry } from "@genui-guard/core";

/**
 * The adapter is a stub that always reports the card as withheld, so the one
 * case in ./cases is a false block and the configured limit of zero fails. This
 * is how the CLI's non-zero exit on a threshold failure is tested without
 * depending on any renderer.
 */
export default {
  registry: createRegistry([{ name: "Card" }]),
  run: () => ({ output: { root: "root" }, dropped: ["card"], traces: [] }),
  suites: [{ name: "clean", kind: "clean", dir: "./cases" }],
  thresholds: { maxFalseBlockRate: 0 },
};
