export { createGuard } from "./guard.js";
export { createRegistry, defineComponent, lintRegistry } from "./registry.js";
export { policies } from "./policies.js";
export { GuardError } from "./errors.js";
export type { GuardErrorCode } from "./errors.js";

export type {
  ActionBinding,
  CheckResult,
  ComponentRules,
  ComponentSpec,
  Ctx,
  Decision,
  Guard,
  GuardConfig,
  GuardElement,
  GuardEvent,
  Policy,
  PolicyInput,
  PolicyResult,
  PropValue,
  Registry,
  Session,
  StateTraceEntry,
  ToolResult,
  TraceEntry,
} from "./types.js";
