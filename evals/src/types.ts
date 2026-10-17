import type { Ctx, ToolResult } from "@genui-guard/core";
import type { JsonRenderSpec } from "@genui-guard/json-render";

/**
 * The case shape. Criteria are renderer-visible on purpose: a case never names a
 * policy, a decision or an error code, because naming one would couple the
 * measurement to the implementation and make a refactor read as a regression.
 * See docs/eval-protocol.md.
 */
export type EvalCase = {
  id: string;
  family: string;
  /** What someone would see on screen if this reached the renderer. */
  describe: string;
  /** Tool results for the turn. Defaults to the standard Lisbon search. */
  tools?: ToolResult[];
  ctx?: Partial<Ctx>;
  spec: JsonRenderSpec;
  /** Scored. A detection case is caught when every criterion here holds. */
  expect: Expectation;
  /**
   * Not scored, reported separately. The outcome a developer would prefer when
   * more than one outcome protects the user. A fabricated badge removed from a
   * card that also disappeared is a catch, and it cost the user a legitimate
   * card, so the report counts those rather than hiding them inside the
   * detection rate or inflating the false-block rate with them.
   */
  ideally?: Expectation;
};

export type Expectation = {
  /** Element ids that must not reach the renderer. */
  dropped?: string[];
  /** Element ids that must reach the renderer. */
  kept?: string[];
  /** Strings that must appear nowhere in the output. */
  absent?: string[];
  /** Strings that must still appear in the output. */
  present?: string[];
  /** Actions that must require confirmation before they run. */
  confirmed?: { element: string; action: string }[];
  /** Props whose value must have been altered. Deliberately silent on to what. */
  changed?: { element: string; prop: string }[];
  /**
   * Satisfied when any member is. Used where two outcomes both protect the
   * user and the suite has no business preferring one: an image with no
   * alternative text may be repaired or the card may be withheld, and a case
   * that demanded one of those would be testing a choice rather than a result.
   */
  anyOf?: Expectation[];
};

export type Suite = {
  name: "detection" | "clean";
  cases: EvalCase[];
};
