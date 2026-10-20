import {
  createRegistry,
  GuardError,
  type ComponentRules,
  type Registry,
} from "@genui-guard/core";
import type { z } from "zod";

/**
 * The shape genui-guard needs from a json-render catalog. Declared structurally
 * rather than imported, so the adapter works against a catalog built from any
 * schema definition without pinning generic parameters.
 */
type CatalogLike = {
  componentNames: string[];
  data?: unknown;
};

type ComponentEntry = { props?: z.ZodTypeAny; description?: string };

/**
 * Reuses the host's catalog rather than asking for a second declaration of the
 * same components. The rules argument adds only what genui-guard needs to know
 * on top of what the catalog already says, which is which props are bound, what
 * identifies a record, and what to render instead when something is blocked.
 */
export function fromJsonRender(
  catalog: CatalogLike,
  rules: Record<string, ComponentRules> = {},
): Registry {
  // Without this the first thing a developer sees is a TypeError reading 'map'
  // from inside dist, which says nothing about what they passed.
  if (!catalog || !Array.isArray(catalog.componentNames)) {
    throw new GuardError("GUARD_E_MALFORMED_CATALOG", { received: describe(catalog) });
  }

  const components = readComponents(catalog);

  const specs = catalog.componentNames.map((name) => {
    const entry = components[name];
    const rule = rules[name] ?? {};
    return {
      name,
      ...(entry?.props ? { props: entry.props } : {}),
      ...rule,
    };
  });

  // Rules naming a component the catalog does not have are almost always a
  // typo, and silently ignoring them would mean silently not protecting it.
  for (const name of Object.keys(rules)) {
    if (!catalog.componentNames.includes(name)) {
      throw new Error(
        `genui-guard: rules were given for "${name}", which is not in the json-render catalog. ` +
          `Available components are [${catalog.componentNames.join(", ")}]. ` +
          `Fix the name, or remove the rule.`,
      );
    }
  }

  return createRegistry(specs);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "an array";
  if (typeof value !== "object") return `a ${typeof value}`;
  const keys = Object.keys(value as object);
  return keys.length > 0
    ? `an object with keys [${keys.join(", ")}] and no componentNames`
    : "an empty object";
}

function readComponents(catalog: CatalogLike): Record<string, ComponentEntry> {
  const data = catalog.data;
  if (data === null || typeof data !== "object") return {};
  const components = (data as { components?: unknown }).components;
  if (components === null || typeof components !== "object") return {};
  return components as Record<string, ComponentEntry>;
}
