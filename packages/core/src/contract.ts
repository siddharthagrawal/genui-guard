import type { ComponentSpec, GuardElement, PolicyResult } from "./types.js";

const POLICY = "contract";

/**
 * Reads the prop names off a zod object schema without depending on zod's
 * internals beyond the `shape` accessor, which is stable across v3 and v4.
 * Core never imports zod: it is a peer dependency the host owns, and a schema
 * arrives here as something with a `safeParse`.
 */
export function objectShape(spec: ComponentSpec | undefined): Record<string, unknown> | null {
  const props = spec?.props as { shape?: unknown } | undefined;
  if (!props || typeof props !== "object") return null;
  const shape = props.shape;
  if (!shape || typeof shape !== "object") return null;
  return shape as Record<string, unknown>;
}

type Parser = {
  safeParse: (value: unknown) => {
    success: boolean;
    error?: { issues?: { path?: unknown[]; message?: string }[] };
  };
};

function parserOf(spec: ComponentSpec | undefined): Parser | null {
  const props = spec?.props as Parser | undefined;
  return props && typeof props.safeParse === "function" ? props : null;
}

/**
 * The first check in the order, and the only one that delegates to the host's
 * own schema. An unknown prop is removed, because a prop the catalog does not
 * declare renders nowhere and should not travel with the element either. A prop
 * of the wrong type blocks, because a component handed a string where it
 * expects a list is a crash or a blank space, and neither is a thing to ship.
 *
 * Props the guard cannot read are skipped rather than failed. A template or a
 * computed value resolves inside the renderer, and treating "cannot verify" as
 * "invalid" would block correct interfaces, which is the expensive mistake.
 */
export function checkContract(
  element: GuardElement,
  spec: ComponentSpec | undefined,
  resolved: Record<string, unknown>,
): PolicyResult[] {
  const shape = objectShape(spec);
  if (!shape || !spec) return [];

  const out: PolicyResult[] = [];

  const unknown = Object.keys(element.props).filter((prop) => !(prop in shape));
  if (unknown.length > 0) {
    out.push({
      policy: POLICY,
      decision: "repair",
      reason:
        `${element.type} was sent ${list(unknown)}, which the catalog does not declare, so ` +
        `${unknown.length === 1 ? "it was" : "they were"} removed.`,
      removeProps: unknown,
    });
  }

  const parser = parserOf(spec);
  if (!parser) return out;

  /** Props whose value the guard cannot see, so cannot judge. */
  const unreadable = new Set<string>();
  const candidate: Record<string, unknown> = {};

  for (const prop of Object.keys(shape)) {
    const value = element.props[prop];
    if (value === undefined) continue;

    if (value.kind === "literal") {
      candidate[prop] = value.value;
      continue;
    }
    if (value.kind === "expr") {
      unreadable.add(prop);
      continue;
    }

    const target = resolved[prop];
    if (target === undefined) {
      // A ref that resolves to nothing is provenance's to report, in a sentence
      // that names the path. Repeating it here as a type error would be worse.
      unreadable.add(prop);
      continue;
    }
    candidate[prop] = target;
  }

  const result = parser.safeParse(candidate);
  if (result.success) return out;

  // Only props the element actually sent are judged. A prop the schema declares
  // and the model omitted is not this check's business: json-render's own
  // validator accepts an absent nullable prop, so blocking one would make the
  // guard stricter than the renderer it is protecting, which is precisely how a
  // trust layer earns a false-block rate nobody tolerates. A missing *bound*
  // prop is still a block, and provenance says so in a sentence that names it.
  const issues = (result.error?.issues ?? []).filter((issue) => {
    const prop = String(issue.path?.[0] ?? "");
    return prop in element.props && !unreadable.has(prop);
  });
  if (issues.length === 0) return out;

  out.push({
    policy: POLICY,
    decision: "block",
    reason:
      `${element.type} does not match its catalog entry: ` +
      `${issues.map(describe).join("; ")}. The component would not render this.`,
  });

  return out;
}

function describe(issue: { path?: unknown[]; message?: string }): string {
  const path = (issue.path ?? []).join(".");
  const message = issue.message ?? "is invalid";
  return path ? `${path} ${lowerFirst(message)}` : lowerFirst(message);
}

function lowerFirst(text: string): string {
  return text.length > 0 ? text[0]!.toLowerCase() + text.slice(1) : text;
}

function list(props: string[]): string {
  return props.map((p) => `"${p}"`).join(", ");
}
