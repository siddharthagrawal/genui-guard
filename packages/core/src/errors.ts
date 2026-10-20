/**
 * Every thrown error comes from this catalog and carries a fix hint. There is a
 * test that iterates the catalog and asserts both, because these errors mostly
 * fire during setup, when the developer has no mental model yet to debug against.
 */

export type GuardErrorCode = keyof typeof ERRORS;

type ErrorDef = {
  /** What happened. Receives whatever detail the call site has. */
  message: (d: Record<string, string>) => string;
  /** How to fix it. Must be actionable, not a restatement of the problem. */
  hint: (d: Record<string, string>) => string;
  docsPath?: string;
};

const DOCS = "https://github.com/siddharthagrawal/genui-guard/blob/main";

export const ERRORS = {
  GUARD_E_BOUND_WITHOUT_ENTITY: {
    message: (d) =>
      `Component "${d.component}" declares bound props [${d.props}] but no entity.`,
    hint: (d) =>
      `Add entity to "${d.component}" naming the tool-result namespace that backs it, for example entity: "fares". Bound props are verified against that namespace, so there is nothing to check without it.`,
    docsPath: "docs/concepts.md",
  },
  GUARD_E_BOUND_WITHOUT_KEY: {
    message: (d) =>
      `Component "${d.component}" declares bound props [${d.props}] and entity "${d.entity}" but no key.`,
    hint: (d) =>
      `Add key to "${d.component}" naming the field that identifies one record, for example key: "fareId". Without it the guard cannot tell which record a bound ref points at.`,
    docsPath: "docs/concepts.md",
  },
  GUARD_E_UNKNOWN_BOUND_PROP: {
    message: (d) =>
      `Component "${d.component}" marks "${d.prop}" as bound, but its prop schema has no such prop.`,
    hint: (d) =>
      `Remove "${d.prop}" from bound, or add it to the ${d.component} schema in your catalog. A typo here silently stops verifying a prop you meant to protect.`,
  },
  GUARD_E_DUPLICATE_ENTITY: {
    message: (d) =>
      `Two tool results in turn "${d.turnId}" both claim the entity namespace "${d.entity}".`,
    hint: (d) =>
      `Give each tool result its own entity, or record them under one call. The guard reserves "${d.entity}" for a single writer per turn, which is what makes a bound ref trustworthy.`,
    docsPath: "docs/concepts.md",
  },
  GUARD_E_ENTITY_NOT_COLLECTION: {
    message: (d) =>
      `Tool result "${d.toolName}" for entity "${d.entity}" is ${d.received}, not an object or array of records.`,
    hint: (d) =>
      `Pass the collection itself rather than the envelope around it. If your API returns { ${d.entity}: [...] }, record result.${d.entity}.`,
  },
  GUARD_E_NO_TOOL_RESULT: {
    message: (d) =>
      `No tool result recorded for turn "${d.turnId}" before checking element "${d.elementId}".`,
    hint: () =>
      `Call guard.recordToolResult before piping the turn's UI stream. Without a source of truth every bound prop would fail, which is correct but unhelpful.`,
  },
  GUARD_E_POLICY_THREW: {
    message: (d) => `Policy "${d.policy}" threw while checking "${d.component}": ${d.cause}`,
    hint: (d) =>
      `Fix the throw in "${d.policy}", or guard its predicate against missing fields. The element was blocked rather than passed through, because a policy that cannot decide is not a reason to allow.`,
  },
  GUARD_E_CONFLICTING_REPAIRS: {
    message: (d) =>
      `Policies [${d.policies}] all want to repair prop "${d.prop}" on "${d.component}" to different values.`,
    hint: (d) =>
      `Narrow one of [${d.policies}] so only one owns "${d.prop}". The element was blocked, because picking a winner would mean asserting a value no policy agreed on.`,
    docsPath: "docs/decisions.md",
  },
  GUARD_E_MALFORMED_EVENT: {
    message: (d) =>
      `Received a stream event with kind "${d.received}", which the guard has no handling for.`,
    hint: () =>
      `Pass events of kind "root", "element" or "state". If you are translating a renderer's wire format by hand, use an adapter instead: @genui-guard/json-render turns a json-render spec or its JSONL patches into these events.`,
    docsPath: "docs/concepts.md",
  },
  GUARD_E_MALFORMED_ELEMENT: {
    message: (d) => `Element "${d.id}" is missing ${d.missing}.`,
    hint: (d) =>
      `Give the element an id, a type and a props object before checking it. A guard element is { id, type, props, children }, and "${d.id}" arrived without ${d.missing}.`,
    docsPath: "docs/concepts.md",
  },
  GUARD_E_UNCLASSIFIED_PROP: {
    message: (d) =>
      `Prop "${d.prop}" on "${d.component}" is ${d.received}, which does not say where its value came from.`,
    hint: (d) =>
      `Classify it first. Every prop arrives as { kind: "literal", value }, { kind: "ref", path } or { kind: "expr", raw }, because that distinction is what the guard verifies. A renderer's own notation such as { "$state": "fares.A.price" } has to be translated: call toPropValue from @genui-guard/json-render, or write { kind: "ref", path: "fares.A.price" } for "${d.prop}" yourself.`,
    docsPath: "docs/concepts.md",
  },
  GUARD_E_MALFORMED_CATALOG: {
    message: (d) => `The value passed to fromJsonRender is not a catalog: ${d.received}.`,
    hint: () =>
      `Pass the object returned by json-render's defineCatalog, which carries componentNames and the per-component prop schemas. A plain object literal will not do, because the adapter reads the catalog's own schemas rather than a second description of them.`,
  },
  GUARD_E_INVALID_HOLD_TIMEOUT: {
    message: (d) => `holdTimeoutMs must be a positive number, received ${d.received}.`,
    hint: () =>
      `Set holdTimeoutMs to a millisecond value such as 5000, or omit it for the default. A hold that never expires would stall the stream.`,
  },
} satisfies Record<string, ErrorDef>;

export class GuardError extends Error {
  readonly code: GuardErrorCode;
  readonly hint: string;
  readonly docsUrl: string | undefined;

  constructor(code: GuardErrorCode, detail: Record<string, string> = {}) {
    const def: ErrorDef = ERRORS[code];
    super(def.message(detail));
    this.name = "GuardError";
    this.code = code;
    this.hint = def.hint(detail);
    this.docsUrl = def.docsPath ? `${DOCS}/${def.docsPath}` : undefined;
  }

  /** What a developer should see in a terminal. */
  override toString(): string {
    const parts = [`${this.code}: ${this.message}`, `  fix: ${this.hint}`];
    if (this.docsUrl) parts.push(`  docs: ${this.docsUrl}`);
    return parts.join("\n");
  }
}

export function guardError(
  code: GuardErrorCode,
  detail: Record<string, string> = {},
): GuardError {
  return new GuardError(code, detail);
}
