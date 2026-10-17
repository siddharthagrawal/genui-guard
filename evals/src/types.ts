import type { EvalCase as CliEvalCase, Expectation } from "@genui-guard/cli";
import type { JsonRenderSpec } from "@genui-guard/json-render";

/**
 * The case shape, with the spec pinned to json-render's so a fixture typo is a
 * type error rather than a mysterious miss.
 *
 * Criteria are renderer-visible on purpose: a case never names a policy, a
 * decision or an error code, because naming one would couple the measurement to
 * the implementation and make a refactor read as a regression. See
 * docs/eval-protocol.md.
 */
export type EvalCase = CliEvalCase<JsonRenderSpec>;

export type { Expectation };
