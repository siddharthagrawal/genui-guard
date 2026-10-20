import Anthropic from "@anthropic-ai/sdk";
import type { GuardEvent } from "@genui-guard/core";
import { patchesToEvents } from "@genui-guard/json-render";
import { catalog } from "./catalog";
import { getFareRules, searchFlights, searchHotels, type Fare, type Hotel } from "./data";
import type { ToolCall } from "./fixtures";

/**
 * Live mode. A real model, json-render's own generated prompt, and the app's
 * own tools.
 *
 * This is the mode that matters most, because it does not inject anything.
 * json-render's prompt tells the model to "include realistic sample data in
 * state", so a model following its renderer's instructions faithfully will
 * invent fares on its own. Chaos mode simulates the failures; live mode
 * produces them.
 */

/**
 * Overridable, so trying a different model does not mean editing source. The
 * default is the one the recorded fixtures were captured against.
 */
const MODEL = process.env.GENUI_GUARD_MODEL ?? "claude-opus-5";

export function liveStatus(): { available: boolean; reason?: string } {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      available: false,
      reason:
        "Set ANTHROPIC_API_KEY in apps/travel/.env.local to enable live mode. Next reads .env.local from the app directory, not the repository root. Copy apps/travel/.env.example to start. Replay and chaos modes need no key.",
    };
  }
  return { available: true };
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "searchFlights",
    description:
      "Search available fares between two airports. Returns the fares the host has loaded, which are the source of truth for this turn.",
    input_schema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Origin airport code, for example SFO or JFK" },
        destination: { type: "string", description: "Destination airport code, for example LIS" },
      },
      required: ["origin", "destination"],
      additionalProperties: false,
    },
  },
  {
    name: "searchHotels",
    description: "Search available hotels in a city.",
    input_schema: {
      type: "object",
      properties: { city: { type: "string", description: "City name, for example Lisbon" } },
      required: ["city"],
      additionalProperties: false,
    },
  },
  {
    name: "getFareRules",
    description: "Fetch the refund, change and baggage rules behind one fare.",
    input_schema: {
      type: "object",
      properties: { fareId: { type: "string" } },
      required: ["fareId"],
      additionalProperties: false,
    },
  },
];

export type LiveTurn = {
  events: GuardEvent[];
  fares: Fare[];
  hotels: Hotel[];
  toolCalls: ToolCall[];
  reply: string;
  raw: string;
  /** Reported so caching can be verified rather than assumed. */
  usage: { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number };
};

export async function runLiveTurn(query: string): Promise<LiveTurn> {
  const client = new Anthropic();

  const fares: Fare[] = [];
  const hotels: Hotel[] = [];
  const toolCalls: ToolCall[] = [];

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${query}

Call the search tools first, then emit the interface. Only reference data the tools returned.`,
    },
  ];

  // json-render's own prompt, unmodified. It defines the JSONL patch format,
  // lists the catalog, and is where the invent-sample-data instruction lives.
  //
  // It is ~3,000 tokens and byte-identical on every turn and every tool-loop
  // iteration, which makes it the one thing in this request worth caching. The
  // volatile parts stay in `messages`, after the cached prefix.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: catalog.prompt(), cache_control: { type: "ephemeral" } },
  ];

  let reply = "";
  let raw = "";
  const usage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };

  // A short manual loop. The tool results have to be captured here anyway,
  // because they are what `recordToolResult` reserves for the guard.
  for (let turn = 0; turn < 6; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      tools: TOOLS,
      messages,
    });

    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;

    if (response.stop_reason === "refusal") {
      throw new Error("The model declined this request.");
    }

    for (const block of response.content) {
      if (block.type === "text") {
        // Patches and prose arrive in the same text stream.
        raw += `${block.text}\n`;
        const prose = block.text
          .split("\n")
          .filter((l) => !l.trim().startsWith("{") && l.trim().length > 0)
          .join(" ");
        if (prose) reply = `${reply} ${prose}`.trim();
      }
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) break;

    messages.push({ role: "assistant", content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const { output, summary } = runTool(use, fares, hotels);
      toolCalls.push(summary);
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(output),
      });
    }

    // Every tool_result goes back in one user message.
    messages.push({ role: "user", content: results });
  }

  return {
    events: patchesToEvents(raw),
    fares,
    hotels,
    toolCalls,
    reply: reply || "Here is what I found.",
    raw,
    usage,
  };
}

function runTool(
  use: Anthropic.ToolUseBlock,
  fares: Fare[],
  hotels: Hotel[],
): { output: unknown; summary: ToolCall } {
  // Tool inputs are parsed JSON, never string-matched.
  const input = use.input as Record<string, unknown>;

  if (use.name === "searchFlights") {
    const origin = String(input.origin ?? "SFO");
    const destination = String(input.destination ?? "LIS");
    const found = searchFlights(origin, destination);
    fares.push(...found.filter((f) => !fares.some((k) => k.fareId === f.fareId)));
    return {
      output: found,
      summary: {
        name: "searchFlights",
        args: `{ origin: "${origin}", destination: "${destination}" }`,
        resultCount: found.length,
      },
    };
  }

  if (use.name === "searchHotels") {
    const city = String(input.city ?? "Lisbon");
    const found = searchHotels(city);
    hotels.push(...found.filter((h) => !hotels.some((k) => k.hotelId === h.hotelId)));
    return {
      output: found,
      summary: { name: "searchHotels", args: `{ city: "${city}" }`, resultCount: found.length },
    };
  }

  if (use.name === "getFareRules") {
    const fareId = String(input.fareId ?? "");
    const rules = getFareRules(fareId);
    return {
      output: rules ?? { error: "no such fare" },
      summary: {
        name: "getFareRules",
        args: `{ fareId: "${fareId}" }`,
        resultCount: rules ? 1 : 0,
      },
    };
  }

  return {
    output: { error: `unknown tool ${use.name}` },
    summary: { name: use.name, args: "{}", resultCount: 0 },
  };
}
