import { describe, expect, it } from "vitest";
import { ERRORS, GuardError, guardError, type GuardErrorCode } from "./errors.js";

const CODES = Object.keys(ERRORS) as GuardErrorCode[];

/**
 * The acceptance criterion is that every error has a code and a fix hint, so
 * this iterates the catalog rather than spot-checking. A new error that forgets
 * its hint fails here rather than in someone's terminal.
 */
describe("error catalog", () => {
  it("is not empty", () => {
    expect(CODES.length).toBeGreaterThan(0);
  });

  it.each(CODES)("%s has a message and an actionable hint", (code) => {
    // Every placeholder resolves to something visible, so a missing detail
    // shows up as an obviously wrong string rather than "undefined".
    const detail = new Proxy({} as Record<string, string>, {
      get: (_t, prop) => `<${String(prop)}>`,
    });
    const err = guardError(code, detail);

    expect(err).toBeInstanceOf(GuardError);
    expect(err.code).toBe(code);
    expect(err.message.trim().length).toBeGreaterThan(10);
    expect(err.hint.trim().length).toBeGreaterThan(10);
    expect(err.message).not.toContain("undefined");
    expect(err.hint).not.toContain("undefined");
  });

  it.each(CODES)("%s hint tells the developer what to do", (code) => {
    const detail = new Proxy({} as Record<string, string>, {
      get: (_t, prop) => `<${String(prop)}>`,
    });
    const { hint } = guardError(code, detail);

    // A hint that only restates the problem is not a fix. Require at least one
    // imperative verb, which is a crude but effective proxy.
    const imperatives =
      /\b(add|remove|set|give|pass|call|fix|narrow|omit|record|use|replace)\b/i;
    expect(hint).toMatch(imperatives);
  });

  it("prefixes every code with GUARD_E_", () => {
    for (const code of CODES) expect(code).toMatch(/^GUARD_E_[A-Z_]+$/);
  });

  it("renders code, fix and docs when printed", () => {
    const err = guardError("GUARD_E_BOUND_WITHOUT_ENTITY", {
      component: "FlightCard",
      props: "price",
    });
    const printed = err.toString();

    expect(printed).toContain("GUARD_E_BOUND_WITHOUT_ENTITY");
    expect(printed).toContain("FlightCard");
    expect(printed).toContain("fix:");
    expect(printed).toContain("docs:");
  });

  it("omits the docs line when an error has no docs path", () => {
    const err = guardError("GUARD_E_INVALID_HOLD_TIMEOUT", { received: "0" });
    expect(err.docsUrl).toBeUndefined();
    expect(err.toString()).not.toContain("docs:");
  });

  it("is catchable as an Error", () => {
    try {
      throw guardError("GUARD_E_NO_TOOL_RESULT", { turnId: "t1", elementId: "e1" });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as GuardError).code).toBe("GUARD_E_NO_TOOL_RESULT");
    }
  });
});
