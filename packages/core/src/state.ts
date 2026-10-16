import { guardError } from "./errors.js";
import type { ToolResult } from "./types.js";

/**
 * The reserved state store, and the reason bindings are worth anything.
 *
 * In these frameworks the model streams state alongside the elements that read
 * it, so a reference is only trustworthy if the data behind it has one writer.
 * `reserve` claims a namespace for the turn. After that, model patches into it
 * are rejected and bound refs resolve against what the host loaded rather than
 * against whatever the renderer eventually merges.
 *
 * Everything outside a reserved namespace is left alone, because interactive
 * state is how a generated interface works and the model is the right author
 * for most of it. See docs/concepts.md.
 */
export type TurnState = {
  reserve(result: ToolResult): void;
  /** True when `path` falls inside a namespace the host owns. */
  isReserved(path: string): boolean;
  /** Which entity namespace owns `path`, if any. */
  ownerEntity(path: string): string | undefined;
  /** Resolve against host data only. Never consults model-written state. */
  resolveHost(path: string): { found: boolean; value: unknown };
  /** One record from a reserved namespace, by identifier. */
  record(entity: string, id: string): Record<string, unknown> | undefined;
  /** The field naming a record's identifier, as given at record time. */
  keyField(entity: string): string | undefined;
  /**
   * Model-authored state. Kept outside reserved namespaces.
   *
   * Inside one, the patch is never applied, and the verdict distinguishes two
   * very different situations. "redundant" means the model re-sent what the host
   * already loaded, so nothing was fabricated and nothing is wrong. "rejected"
   * means it tried to write something different, which is the failure that looks
   * most legitimate because every reference to it stays valid.
   */
  applyModelPatch(path: string, value: unknown): "allowed" | "rejected" | "redundant";
  /** Model state outside reserved namespaces, for resolving non-bound refs. */
  resolveAny(path: string): { found: boolean; value: unknown };
  hasAnyResult(): boolean;
  reservedNamespaces(): string[];
};

const SEP = ".";

export function splitPath(path: string): string[] {
  return path.split(SEP).filter((s) => s.length > 0);
}

/** "fares.HA-2041.price" -> "fares.HA-2041". Used for the coherence check. */
export function recordPrefix(path: string): string | undefined {
  const parts = splitPath(path);
  if (parts.length < 2) return undefined;
  return `${parts[0]}${SEP}${parts[1]}`;
}

function walk(root: unknown, parts: string[]): { found: boolean; value: unknown } {
  let cursor: unknown = root;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return { found: false, value: undefined };
    if (typeof cursor !== "object") return { found: false, value: undefined };
    if (Array.isArray(cursor)) {
      const i = Number(part);
      if (!Number.isInteger(i) || i < 0 || i >= cursor.length) {
        return { found: false, value: undefined };
      }
      cursor = cursor[i];
      continue;
    }
    const obj = cursor as Record<string, unknown>;
    if (!(part in obj)) return { found: false, value: undefined };
    cursor = obj[part];
  }
  return { found: true, value: cursor };
}

/**
 * Normalises a recorded collection into records addressable by identifier.
 * An array needs `key` so records are addressed by identity rather than by
 * position, since position is exactly what a model can get wrong.
 */
function normalise(result: ToolResult): Record<string, unknown> {
  const { data, entity, toolName, key } = result;

  if (Array.isArray(data)) {
    if (!key) {
      throw guardError("GUARD_E_BOUND_WITHOUT_KEY", {
        component: `tool result "${toolName}"`,
        props: "(array data)",
        entity,
      });
    }
    const out: Record<string, unknown> = {};
    for (const item of data) {
      if (item === null || typeof item !== "object") {
        throw guardError("GUARD_E_ENTITY_NOT_COLLECTION", {
          toolName,
          entity,
          received: describe(item),
        });
      }
      const id = (item as Record<string, unknown>)[key];
      if (id === undefined || id === null) continue;
      out[String(id)] = item;
    }
    return out;
  }

  if (data !== null && typeof data === "object") {
    return data as Record<string, unknown>;
  }

  throw guardError("GUARD_E_ENTITY_NOT_COLLECTION", {
    toolName,
    entity,
    received: describe(data),
  });
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array of non-objects";
  return `a ${typeof v}`;
}

export function createTurnState(turnId: string): TurnState {
  /** Host data, by entity namespace. The guard is the only writer. */
  const host = new Map<string, Record<string, unknown>>();
  const keyFields = new Map<string, string>();
  /** Model-authored state, outside reserved namespaces. */
  const modelState: Record<string, unknown> = {};

  const rootOf = (path: string): string | undefined => splitPath(path)[0];

  const api: TurnState = {
    reserve(result) {
      if (host.has(result.entity)) {
        throw guardError("GUARD_E_DUPLICATE_ENTITY", {
          turnId,
          entity: result.entity,
        });
      }
      host.set(result.entity, normalise(result));
      if (result.key) keyFields.set(result.entity, result.key);
    },

    isReserved(path) {
      const root = rootOf(path);
      return root !== undefined && host.has(root);
    },

    ownerEntity(path) {
      const root = rootOf(path);
      return root !== undefined && host.has(root) ? root : undefined;
    },

    resolveHost(path) {
      const parts = splitPath(path);
      const root = parts[0];
      if (root === undefined) return { found: false, value: undefined };
      const collection = host.get(root);
      if (!collection) return { found: false, value: undefined };
      return walk(collection, parts.slice(1));
    },

    record(entity, id) {
      const collection = host.get(entity);
      if (!collection) return undefined;
      const rec = collection[id];
      if (rec === null || typeof rec !== "object") return undefined;
      return rec as Record<string, unknown>;
    },

    keyField: (entity) => keyFields.get(entity),

    applyModelPatch(path, value) {
      if (api.isReserved(path)) {
        const current = api.resolveHost(path);
        const same =
          current.found && JSON.stringify(current.value) === JSON.stringify(value);
        return same ? "redundant" : "rejected";
      }
      const parts = splitPath(path);
      if (parts.length === 0) return "rejected";

      let cursor: Record<string, unknown> = modelState;
      for (const part of parts.slice(0, -1)) {
        const next = cursor[part];
        if (next === null || typeof next !== "object" || Array.isArray(next)) {
          cursor[part] = {};
        }
        cursor = cursor[part] as Record<string, unknown>;
      }
      cursor[parts[parts.length - 1]!] = value;
      return "allowed";
    },

    resolveAny(path) {
      const fromHost = api.resolveHost(path);
      if (fromHost.found) return fromHost;
      return walk(modelState, splitPath(path));
    },

    hasAnyResult: () => host.size > 0,
    reservedNamespaces: () => [...host.keys()],
  };

  return api;
}
