import { describe, expect, it } from "vitest";
import { GuardError } from "./errors.js";
import { createGuard } from "./guard.js";
import { createRegistry } from "./registry.js";
import type { Ctx, Guard, GuardEvent } from "./types.js";

/**
 * An outside developer wiring their own transport hit three raw TypeErrors
 * thrown from inside the published `dist`, and a fourth failure where the
 * stream hung instead of erroring. These assert the replacements: a code, a
 * message naming what arrived, and a hint saying what to do.
 */

const CTX: Ctx = { turnId: "t1" };

function build(): Guard {
  const guard = createGuard({
    registry: createRegistry([
      { name: "FlightCard", entity: "fares", key: "fareId", bound: ["price"] },
    ]),
  });
  guard.recordToolResult({
    turnId: "t1",
    toolName: "searchFlights",
    entity: "fares",
    key: "fareId",
    data: [{ fareId: "A", price: 412 }],
  });
  return guard;
}

/** Collects a stream's output, or the error it fails with. */
async function pipe(guard: Guard, events: unknown[]): Promise<GuardEvent[]> {
  const input = new ReadableStream<GuardEvent>({
    start(controller) {
      for (const event of events) controller.enqueue(event as GuardEvent);
      controller.close();
    },
  });

  const out: GuardEvent[] = [];
  const reader = input.pipeThrough(guard.stream(CTX)).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("a prop that does not say where its value came from", () => {
  /** The notation every README example is written in. */
  it("names the renderer notation a developer is most likely to pass", () => {
    const run = () =>
      build().check(
        {
          id: "c1",
          type: "FlightCard",
          // @ts-expect-error that is the point: this is what a host passes by mistake
          props: { price: { $state: "fares.A.price" } },
          children: [],
        },
        CTX,
      );

    expect(run).toThrow(GuardError);
    try {
      run();
    } catch (e) {
      const err = e as GuardError;
      expect(err.code).toBe("GUARD_E_UNCLASSIFIED_PROP");
      expect(err.message).toContain("price");
      expect(err.message).toContain("FlightCard");
      expect(err.hint).toContain("$state");
      expect(err.hint).toContain("toPropValue");
    }
  });

  it("rejects a ref with no path rather than resolving undefined", () => {
    const run = () =>
      build().check(
        // @ts-expect-error a ref without its path
        { id: "c1", type: "FlightCard", props: { price: { kind: "ref" } }, children: [] },
        CTX,
      );

    expect(run).toThrow(/no path/);
  });

  it("accepts all three classified forms", () => {
    const guard = build();
    const decision = guard.check(
      {
        id: "c1",
        type: "FlightCard",
        props: {
          price: { kind: "ref", path: "fares.A.price" },
          note: { kind: "literal", value: "Overnight" },
          badges: { kind: "expr", raw: { $cond: {} } },
        },
        children: [],
      },
      CTX,
    ).decision;

    expect(decision).not.toBe("block");
  });
});

describe("an element that is not an element", () => {
  it("says which parts are missing", () => {
    try {
      // @ts-expect-error no type, no props
      build().check({ id: "c1" }, CTX);
      expect.unreachable();
    } catch (e) {
      const err = e as GuardError;
      expect(err.code).toBe("GUARD_E_MALFORMED_ELEMENT");
      expect(err.message).toContain("a type");
      expect(err.message).toContain("a props object");
      expect(err.hint).toContain("{ id, type, props, children }");
    }
  });
});

describe("an event the guard has no handling for", () => {
  it("fails with a code rather than a TypeError, through the stream", async () => {
    // The shape a developer writes when guessing: json-render's `type` rather
    // than the guard's `kind`.
    await expect(pipe(build(), [{ type: "element", props: {} }])).rejects.toThrow(GuardError);
  });

  /** It used to hang here, which is worse than throwing. */
  it("settles rather than hanging", async () => {
    const settled = await Promise.race([
      pipe(build(), [{ type: "element", props: {} }]).then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 1000)),
    ]);

    expect(settled).toBe("rejected");
  });

  it("points at the adapter rather than at the three kinds alone", async () => {
    try {
      await pipe(build(), [{ kind: "elment", id: "x" }]);
      expect.unreachable();
    } catch (e) {
      const err = e as GuardError;
      expect(err.code).toBe("GUARD_E_MALFORMED_EVENT");
      expect(err.hint).toContain("@genui-guard/json-render");
    }
  });

  it("catches a root with no id and a state patch with no path", async () => {
    await expect(pipe(build(), [{ kind: "root" }])).rejects.toThrow(/root without an id/);
    await expect(pipe(build(), [{ kind: "state", value: 1 }])).rejects.toThrow(
      /state without a path/,
    );
  });

  it("still accepts a well formed turn", async () => {
    const out = await pipe(build(), [
      { kind: "root", id: "root" },
      {
        kind: "element",
        id: "root",
        element: { id: "root", type: "FlightCard", props: { price: { kind: "ref", path: "fares.A.price" } }, children: [] },
      },
      { kind: "state", path: "ui.tab", value: "flights" },
    ]);

    expect(out.map((e) => e.kind)).toEqual(["root", "element", "state"]);
  });
});
