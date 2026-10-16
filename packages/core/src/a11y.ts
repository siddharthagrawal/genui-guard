import type { ComponentSpec, GuardElement, PolicyResult, PropValue } from "./types.js";

const POLICY = "accessibility";

/**
 * Static checks only. Alt text, labels and heading structure are visible in the
 * spec, so they are checkable here. Contrast, focus order and whether an ARIA
 * role suits its context all need the rendered DOM, which a server-side guard
 * never sees. See docs/concepts.md.
 */
export function checkA11y(
  element: GuardElement,
  spec: ComponentSpec | undefined,
): PolicyResult[] {
  if (!spec?.a11y) return [];
  const out: PolicyResult[] = [];

  for (const prop of spec.a11y.requireAlt ?? []) {
    const result = requireText(element, prop, "alt text");
    if (result) out.push(result);
  }
  for (const prop of spec.a11y.requireLabel ?? []) {
    const result = requireText(element, prop, "a label");
    if (result) out.push(result);
  }

  return out;
}

function requireText(
  element: GuardElement,
  prop: string,
  what: string,
): PolicyResult | null {
  const value = element.props[prop];
  if (isNonEmptyText(value)) return null;

  // A ref we cannot read here is still a ref into verified data, so leave it be.
  if (value?.kind === "ref") return null;

  const derived = deriveFrom(element, prop);
  if (derived !== undefined) {
    return {
      policy: POLICY,
      decision: "repair",
      reason: `${element.type}.${prop} was missing ${what}, so it was filled from ${derived.source}.`,
      patch: { [prop]: { kind: "literal", value: derived.value } },
    };
  }

  return {
    policy: POLICY,
    decision: "block",
    reason: `${element.type}.${prop} needs ${what} and none was provided, and nothing on the element could supply it.`,
  };
}

function isNonEmptyText(value: PropValue | undefined): boolean {
  if (value?.kind !== "literal") return false;
  return typeof value.value === "string" && value.value.trim().length > 0;
}

/**
 * Repair here is subtractive in spirit: it states something the element already
 * says elsewhere rather than inventing a description of an image nobody saw.
 */
function deriveFrom(
  element: GuardElement,
  _prop: string,
): { value: string; source: string } | undefined {
  for (const candidate of ["name", "title", "label", "heading"]) {
    const value = element.props[candidate];
    if (value?.kind === "literal" && typeof value.value === "string") {
      const text = value.value.trim();
      if (text.length > 0) return { value: text, source: `${element.type}.${candidate}` };
    }
  }
  return undefined;
}
