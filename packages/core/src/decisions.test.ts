import { describe, expect, it } from "vitest";
import { mergeResults, rank, strictest } from "./decisions.js";
import { GuardError } from "./errors.js";
import type { Decision, PolicyResult } from "./types.js";

const r = (over: Partial<PolicyResult>): PolicyResult => ({
  policy: "p",
  decision: "allow",
  reason: "because",
  ...over,
});

describe("decision precedence", () => {
  it("orders block > gate > repair > annotate > allow", () => {
    const order: Decision[] = ["allow", "annotate", "repair", "gate", "block"];
    for (let i = 1; i < order.length; i++) {
      expect(rank(order[i]!)).toBeGreaterThan(rank(order[i - 1]!));
    }
  });

  it("picks the strictest of a set", () => {
    expect(strictest(["allow", "annotate"])).toBe("annotate");
    expect(strictest(["repair", "annotate", "allow"])).toBe("repair");
    expect(strictest(["annotate", "block", "repair"])).toBe("block");
    expect(strictest(["gate", "repair"])).toBe("gate");
    expect(strictest(["block", "gate"])).toBe("block");
  });

  it("defaults to allow with nothing to decide", () => {
    expect(strictest([])).toBe("allow");
  });
});

describe("merging policy results", () => {
  it("applies repairs from several policies", () => {
    const out = mergeResults(
      [
        r({ policy: "claims", decision: "repair", patch: { badge: { kind: "literal", value: null } } }),
        r({ policy: "urls", decision: "repair", patch: { href: { kind: "literal", value: null } } }),
      ],
      "HotelCard",
    );

    expect(out.final).toBe("repair");
    expect(Object.keys(out.patch).sort()).toEqual(["badge", "href"]);
  });

  it("allows two policies to repair one prop to the same value", () => {
    const out = mergeResults(
      [
        r({ policy: "a", decision: "repair", patch: { badge: { kind: "literal", value: null } } }),
        r({ policy: "b", decision: "repair", patch: { badge: { kind: "literal", value: null } } }),
      ],
      "HotelCard",
    );

    expect(out.final).toBe("repair");
    expect(out.patch.badge).toEqual({ kind: "literal", value: null });
  });

  it("blocks when two policies repair one prop to different values", () => {
    expect(() =>
      mergeResults(
        [
          r({ policy: "a", decision: "repair", patch: { price: { kind: "literal", value: 1 } } }),
          r({ policy: "b", decision: "repair", patch: { price: { kind: "literal", value: 2 } } }),
        ],
        "FlightCard",
      ),
    ).toThrow(GuardError);
  });

  it("names both policies and the prop when repairs conflict", () => {
    try {
      mergeResults(
        [
          r({ policy: "alpha", decision: "repair", patch: { price: { kind: "literal", value: 1 } } }),
          r({ policy: "beta", decision: "repair", patch: { price: { kind: "literal", value: 2 } } }),
        ],
        "FlightCard",
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as GuardError;
      expect(err.code).toBe("GUARD_E_CONFLICTING_REPAIRS");
      expect(err.message).toContain("alpha");
      expect(err.message).toContain("beta");
      expect(err.message).toContain("price");
      expect(err.message).toContain("FlightCard");
    }
  });

  it("collects notes from annotations", () => {
    const out = mergeResults(
      [
        r({ policy: "budget", decision: "annotate", note: "Over your stated budget" }),
        r({ policy: "other", decision: "allow" }),
      ],
      "TripSummary",
    );

    expect(out.final).toBe("annotate");
    expect(out.notes).toEqual(["Over your stated budget"]);
  });

  it("collects gated actions without duplicates", () => {
    const out = mergeResults(
      [
        r({ policy: "a", decision: "gate", gatedActions: ["book"] }),
        r({ policy: "b", decision: "gate", gatedActions: ["book", "cancel"] }),
      ],
      "TripSummary",
    );

    expect(out.final).toBe("gate");
    expect(out.gatedActions.sort()).toEqual(["book", "cancel"]);
  });

  it("keeps a repair patch even when a stricter decision wins", () => {
    // The patch is still recorded, so the trace can show what would have been
    // repaired had the element not been gated.
    const out = mergeResults(
      [
        r({ policy: "claims", decision: "repair", patch: { badge: { kind: "literal", value: null } } }),
        r({ policy: "actions", decision: "gate", gatedActions: ["book"] }),
      ],
      "FlightCard",
    );

    expect(out.final).toBe("gate");
    expect(out.patch.badge).toBeDefined();
  });
});
