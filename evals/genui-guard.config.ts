import { defineConfig } from "@genui-guard/cli";
import { guardSpec, type JsonRenderSpec } from "@genui-guard/json-render";
import { guardConfig } from "../apps/travel/lib/guard";
import { standardTurn } from "./src/fixtures.js";

/**
 * The suites run the travel demo's own configuration, imported rather than
 * copied. That matters for one reason: the registry, the policy order and the
 * claim topics below all shipped in phase 2, before the held-out cases were
 * written, so nothing here can have been tuned to the cases that score it. See
 * docs/eval-protocol.md.
 */
export default defineConfig<JsonRenderSpec>({
  registry: guardConfig.registry,
  ...(guardConfig.policies ? { policies: guardConfig.policies } : {}),

  tools: standardTurn,
  ctx: { session: { role: "customer" } },

  /**
   * The adapter. The CLI never sees a json-render type; it asks what reached the
   * renderer and gets back an output to search, the ids that were withheld, and
   * the traces.
   */
  run: async ({ guard, spec, ctx }) => {
    const result = await guardSpec(guard, spec as JsonRenderSpec, ctx);
    return { output: result.spec, dropped: result.dropped, traces: result.traces };
  },

  suites: [
    { name: "clean", kind: "clean", dir: "./cases/clean" },
    { name: "detection", kind: "detection", dir: "./cases/detection" },
  ],

  /**
   * Two kinds of number live here and they are not the same kind of promise.
   *
   * The false-block and false-modification limits are the bar the project set
   * for itself before the first run, and they are what the README claims.
   *
   * The detection floors are regression floors, written after the first
   * measurement and deliberately below it. They exist so a change that stops
   * catching something fails loudly, not to describe how good detection is. No
   * floor is set for the claim families, because their measured rate is zero
   * and a zero floor would assert nothing; the report names them instead.
   */
  thresholds: {
    maxFalseBlockRate: 0.05,
    maxFalseModificationRate: 0.05,

    minDetectionRate: 0.45,
    minDetectionByFamily: {
      // The deterministic families. These are the guard's actual claims, so a
      // drop in any of them is a product regression rather than a known limit.
      binding: 0.8,
      contract: 1,
      "state-patch": 0.8,
      availability: 1,
      safety: 1,
      permission: 1,
      gating: 1,
    },
  },

  reportPath: "./reports/latest.md",
});
