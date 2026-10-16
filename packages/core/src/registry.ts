import { guardError, type GuardError } from "./errors.js";
import type { ComponentSpec, Registry } from "./types.js";

export function defineComponent(spec: ComponentSpec): ComponentSpec {
  return spec;
}

export function createRegistry(specs: ComponentSpec[]): Registry {
  const byName = new Map<string, ComponentSpec>();
  for (const spec of specs) byName.set(spec.name, spec);

  return {
    get: (name) => byName.get(name),
    has: (name) => byName.has(name),
    names: () => [...byName.keys()],
  };
}

/**
 * Config errors a developer should hear about at setup rather than at runtime.
 * `genui-guard check` reports these, and createGuard throws on them, because a
 * `bound` prop with no entity silently stops verifying something you meant to
 * protect.
 */
export function lintRegistry(registry: Registry): GuardError[] {
  const errors: GuardError[] = [];

  for (const name of registry.names()) {
    const spec = registry.get(name);
    if (!spec) continue;

    const bound = spec.bound ?? [];
    if (bound.length === 0) continue;

    if (!spec.entity) {
      errors.push(
        guardError("GUARD_E_BOUND_WITHOUT_ENTITY", {
          component: name,
          props: bound.join(", "),
        }),
      );
      continue;
    }

    if (!spec.key) {
      errors.push(
        guardError("GUARD_E_BOUND_WITHOUT_KEY", {
          component: name,
          props: bound.join(", "),
          entity: spec.entity,
        }),
      );
    }

    // A typo in `bound` is worse than a missing entry, because it looks like
    // protection that is not there. Only checkable when the host gave us a schema.
    const shape = getObjectShape(spec);
    if (shape) {
      for (const prop of bound) {
        if (!(prop in shape)) {
          errors.push(
            guardError("GUARD_E_UNKNOWN_BOUND_PROP", { component: name, prop }),
          );
        }
      }
    }
  }

  return errors;
}

/**
 * Reads the key names off a zod object schema without depending on zod's
 * internals beyond the `shape` accessor, which is stable across v3 and v4.
 */
function getObjectShape(spec: ComponentSpec): Record<string, unknown> | null {
  const props = spec.props as { shape?: unknown } | undefined;
  if (!props || typeof props !== "object") return null;
  const shape = props.shape;
  if (!shape || typeof shape !== "object") return null;
  return shape as Record<string, unknown>;
}
