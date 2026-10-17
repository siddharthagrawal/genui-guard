import type { z } from "zod";

/**
 * Core speaks these types and nothing from any renderer. Adapters translate a
 * host framework's stream into GuardEvent and translate the result back.
 * See CLAUDE.md: core must not import or reference json-render types.
 */

// ---------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------

/**
 * A prop arrives in one of three forms, and the distinction is the entire
 * provenance mechanism. `ref` points into state. `literal` was written by
 * whoever produced the event. `expr` is anything the host can resolve but
 * genui-guard cannot attribute to a single source, such as a template or a
 * computed value.
 */
export type PropValue =
  | { kind: "literal"; value: unknown }
  | { kind: "ref"; path: string }
  | { kind: "expr"; raw: unknown };

/** An action bound to an element event, by name. The model never supplies handlers. */
export type ActionBinding = {
  name: string;
  params?: Record<string, PropValue>;
};

export type GuardElement = {
  id: string;
  type: string;
  props: Record<string, PropValue>;
  children: string[];
  /** Event name to action, for example `press` -> `book`. */
  on?: Record<string, ActionBinding>;
};

/**
 * Events are what cross the guard. A spec arrives as a root, then elements and
 * state patches interleaved, which is how progressive rendering works.
 */
export type GuardEvent =
  | { kind: "root"; id: string }
  | { kind: "element"; id: string; element: GuardElement }
  | { kind: "state"; path: string; value: unknown }
  /** Emitted by the guard only, never by an adapter. Tells the renderer to drop an element. */
  | { kind: "drop"; id: string; reason: string };

// ---------------------------------------------------------------------------
// Source of truth
// ---------------------------------------------------------------------------

export type ToolResult = {
  turnId: string;
  toolName: string;
  /**
   * The state namespace this result populates, for example "fares". The guard
   * owns this namespace for the turn: model writes into it are rejected, and
   * bound refs resolve against it rather than against merged state.
   */
  entity: string;
  /**
   * Field that identifies one record, for example "fareId". Required when
   * `data` is an array, so records can be addressed by identity rather than by
   * position. Ignored when `data` is already keyed by identifier.
   */
  key?: string;
  data: unknown;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type ComponentRules = {
  /** Which recorded collection backs this component, for example "fares". */
  entity?: string;
  /** Field on the entity that identifies it, for example "fareId". */
  key?: string;
  /** Props that must arrive as refs into the entity's reserved namespace. */
  bound?: string[];
  /** Component to render in place of this one when blocked. */
  fallback?: string;
  a11y?: {
    requireAlt?: string[];
    requireLabel?: string[];
  };
};

export type ComponentSpec = ComponentRules & {
  name: string;
  /** Prop schema. Supplied by the host catalog through an adapter, or by defineComponent. */
  props?: z.ZodTypeAny;
};

export type Registry = {
  get(name: string): ComponentSpec | undefined;
  has(name: string): boolean;
  names(): string[];
};

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/**
 * Strictest wins. See `rank` in decisions.ts for the ordering, and
 * docs/decisions.md for why annotate exists at all.
 */
export type Decision = "allow" | "annotate" | "repair" | "gate" | "block";

export type PolicyResult = {
  policy: string;
  decision: Decision;
  /** One plain sentence a developer can act on. This is what the trace shows. */
  reason: string;
  /** For `repair`: props to replace. Repairs must be subtractive. */
  patch?: Record<string, PropValue>;
  /**
   * For `repair`: props to take off the element entirely. Setting a prop to null
   * is not the same thing, because a prop the catalog never declared should not
   * reach the renderer under any value. Applied after `patch`.
   */
  removeProps?: string[];
  /** For `annotate`: a note attached to the element, not a change to it. */
  note?: string;
  /** For `gate`: which action names now require confirmation. */
  gatedActions?: string[];
};

export type TraceEntry = {
  turnId: string;
  elementId: string;
  component: string;
  final: Decision;
  results: PolicyResult[];
  before: Record<string, PropValue>;
  after: Record<string, PropValue> | null;
  /** Set when this element was removed because an ancestor was blocked. */
  cascadedFrom?: string;
  latencyMs: number;
};

/** A rejected state patch is traced too, on the same terms as a blocked element. */
export type StateTraceEntry = {
  turnId: string;
  path: string;
  final: "allow" | "block";
  reason: string;
};

export type CheckResult = {
  /** The element as it should render, or null if blocked. */
  element: GuardElement | null;
  decision: Decision;
  trace: TraceEntry;
};

// ---------------------------------------------------------------------------
// Context and policies
// ---------------------------------------------------------------------------

export type Session = {
  role?: string;
  [key: string]: unknown;
};

export type Ctx = {
  turnId: string;
  session?: Session;
  /** Arbitrary host values policies can read, for example a stated budget. */
  [key: string]: unknown;
};

/**
 * What a policy can see. Deliberately narrow: a policy gets the element, the
 * entity it resolved to if any, and the context. It cannot reach the stream.
 */
export type PolicyInput = {
  element: GuardElement;
  spec: ComponentSpec | undefined;
  /** The resolved source entity, when the component declares one and it was found. */
  entity: Record<string, unknown> | undefined;
  /** Resolved prop values, with refs already looked up against host state. */
  resolved: Record<string, unknown>;
  ctx: Ctx;
};

export type Policy = {
  name: string;
  /** Returns null when the policy has nothing to say about this element. */
  check(input: PolicyInput): PolicyResult | PolicyResult[] | null;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type GuardConfig = {
  registry: Registry;
  policies?: Policy[];
  /**
   * How long to hold an element whose bound data has not arrived, in ms.
   * The hold expires into a block rather than hanging. Default 5000.
   */
  holdTimeoutMs?: number;
  /** Called for every decision, including allow. */
  onTrace?: (entry: TraceEntry | StateTraceEntry) => void;
};

export type Guard = {
  /** Source of truth for the turn. Reserves `result.entity` as a namespace. */
  recordToolResult(result: ToolResult): void;
  /** Check one element. Used by tests and by hosts doing their own iteration. */
  check(element: GuardElement, ctx: Ctx): CheckResult;
  /** The main path. Transforms a stream of events into a safe stream of events. */
  stream(ctx: Ctx): TransformStream<GuardEvent, GuardEvent>;
  wrap(events: AsyncIterable<GuardEvent>, ctx: Ctx): AsyncIterable<GuardEvent>;
  traces(turnId: string): (TraceEntry | StateTraceEntry)[];
};
