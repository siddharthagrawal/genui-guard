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
  resolved: Record<string, unknown> = {},
): PolicyResult[] {
  if (!spec?.a11y) return [];
  const out: PolicyResult[] = [];

  for (const prop of spec.a11y.requireAlt ?? []) {
    const result = requireText(element, prop, "alt text", resolved);
    if (result) out.push(result);
  }
  for (const prop of spec.a11y.requireLabel ?? []) {
    const result = requireText(element, prop, "a label", resolved);
    if (result) out.push(result);
  }

  return out;
}

function requireText(
  element: GuardElement,
  prop: string,
  what: string,
  resolved: Record<string, unknown>,
): PolicyResult | null {
  const value = element.props[prop];
  if (isNonEmptyText(value)) return null;

  // A ref we cannot read here is still a ref into verified data, so leave it be.
  if (value?.kind === "ref") return null;

  const derived = deriveFrom(element, resolved);
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
 *
 * Resolved values count, not only literals. In any real catalog the name beside
 * an image is bound rather than typed, so reading literals alone meant this
 * repair almost never fired and the card was withheld instead. That is the same
 * mistake as matching a claim topic against a raw field name, and it was found
 * the same way: by putting a real card through it. See docs/decisions.md.
 */
function deriveFrom(
  element: GuardElement,
  resolved: Record<string, unknown>,
): { value: string; source: string } | undefined {
  for (const candidate of ["name", "title", "label", "heading"]) {
    const value = element.props[candidate];
    if (value === undefined) continue;

    const text = value.kind === "literal" ? value.value : resolved[candidate];
    if (typeof text !== "string") continue;

    const trimmed = text.trim();
    if (trimmed.length > 0) return { value: trimmed, source: `${element.type}.${candidate}` };
  }
  return undefined;
}
