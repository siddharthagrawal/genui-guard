import { describe, expect, it } from "vitest";
import { drainPatchBuffer, parsePatchLine, patchesToEvents, patchToEvent } from "./patches.js";

/** Shapes taken from the prompt json-render generates for a real catalog. */
const ROOT = { op: "add" as const, path: "/root", value: "main" };
const ELEMENT = {
  op: "add" as const,
  path: "/elements/card",
  value: {
    type: "FlightCard",
    props: { airline: { $state: "/fares/HA-2041/airline" }, price: 189 },
    children: [],
  },
};
const STATE = { op: "add" as const, path: "/state/fares", value: { "HA-2041": { price: 412 } } };

describe("patch translation", () => {
  it("maps a root patch", () => {
    expect(patchToEvent(ROOT)).toEqual({ kind: "root", id: "main" });
  });

  it("maps an element patch, classifying its props", () => {
    const event = patchToEvent(ELEMENT);
    expect(event?.kind).toBe("element");
    if (event?.kind !== "element") throw new Error("expected element");

    expect(event.id).toBe("card");
    expect(event.element.type).toBe("FlightCard");
    expect(event.element.props.airline).toEqual({ kind: "ref", path: "fares.HA-2041.airline" });
    expect(event.element.props.price).toEqual({ kind: "literal", value: 189 });
  });

  it("maps a state patch to a dotted path", () => {
    expect(patchToEvent(STATE)).toEqual({
      kind: "state",
      path: "fares",
      value: { "HA-2041": { price: 412 } },
    });
  });

  it("maps a nested state patch", () => {
    expect(patchToEvent({ op: "add", path: "/state/fares/HA-2041/price", value: 189 })).toEqual({
      kind: "state",
      path: "fares.HA-2041.price",
      value: 189,
    });
  });

  it("ignores a removal, since there is nothing to check", () => {
    expect(patchToEvent({ op: "remove", path: "/elements/card" })).toBeNull();
    expect(patchToEvent({ op: "remove", path: "/state/fares" })).toBeNull();
  });

  it("ignores a patch into one field of an element", () => {
    // A partial element cannot be verified on its own, so it does not become an
    // event and never reaches the renderer.
    expect(patchToEvent({ op: "replace", path: "/elements/card/props/price", value: 1 })).toBeNull();
  });

  it("ignores paths it has no event for", () => {
    expect(patchToEvent({ op: "add", path: "/unknown", value: 1 })).toBeNull();
    expect(patchToEvent({ op: "add", path: "/root", value: 42 })).toBeNull();
    expect(patchToEvent({ op: "add", path: "/elements", value: {} })).toBeNull();
  });
});

describe("JSONL parsing", () => {
  it("skips blank lines and malformed JSON rather than failing the turn", () => {
    expect(parsePatchLine("")).toBeNull();
    expect(parsePatchLine("   ")).toBeNull();
    expect(parsePatchLine('{"op":"add","path":')).toBeNull();
    expect(parsePatchLine("not json at all")).toBeNull();
    expect(parsePatchLine('{"nope":true}')).toBeNull();
  });

  it("parses a well formed line", () => {
    expect(parsePatchLine(JSON.stringify(ROOT))).toEqual(ROOT);
  });

  it("drains complete lines and keeps the partial tail", () => {
    const buffer = `${JSON.stringify(ROOT)}\n${JSON.stringify(ELEMENT)}\n{"op":"add","pa`;
    const { events, rest } = drainPatchBuffer(buffer);

    expect(events.map((e) => e.kind)).toEqual(["root", "element"]);
    expect(rest).toBe('{"op":"add","pa');
  });

  it("converts a whole response, with or without a trailing newline", () => {
    const jsonl = [ROOT, ELEMENT, STATE].map((p) => JSON.stringify(p)).join("\n");

    expect(patchesToEvents(jsonl).map((e) => e.kind)).toEqual(["root", "element", "state"]);
    expect(patchesToEvents(`${jsonl}\n`).map((e) => e.kind)).toEqual([
      "root",
      "element",
      "state",
    ]);
  });

  it("tolerates prose the model wrapped around the patches", () => {
    // A live model sometimes adds a sentence or a code fence. Those lines are
    // skipped and the valid patches still come through.
    const messy = `Here is the UI:\n\`\`\`\n${JSON.stringify(ROOT)}\n\`\`\`\nDone.`;
    expect(patchesToEvents(messy)).toEqual([{ kind: "root", id: "main" }]);
  });
});
