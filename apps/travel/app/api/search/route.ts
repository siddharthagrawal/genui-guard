import type { GuardEvent, PropValue } from "@genui-guard/core";
import { guardEvents, guardSpec, type JsonRenderSpec } from "@genui-guard/json-render";
import { keyed } from "../../../lib/data";
import { buildTurn, type Chaos, type Injection, type QueryId } from "../../../lib/fixtures";
import { buildGuard } from "../../../lib/guard";
import { liveStatus, runLiveTurn } from "../../../lib/live";

/**
 * The guard runs here, on the server, between the agent's output and the
 * transport that carries UI to the browser. Running it in the browser would
 * mean the client could remove it.
 */
export async function GET(): Promise<Response> {
  return Response.json({ live: liveStatus() });
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as {
    query?: QueryId;
    prompt?: string;
    mode?: "replay" | "live";
    guardrails?: boolean;
    chaos?: Chaos[];
    budget?: number;
  };

  const guardrails = body.guardrails !== false;
  // $600 against this dataset annotates exactly one of the four fares shown,
  // and it is the refundable one, which is the case worth seeing: the option the
  // traveller actually asked for is over their stated budget, so it renders with
  // a note rather than disappearing.
  const budget = body.budget ?? 600;
  const live = body.mode === "live";

  if (live) {
    const status = liveStatus();
    if (!status.available) {
      return Response.json({ error: status.reason, live: status }, { status: 409 });
    }
    return handleLive(body.prompt ?? "A weekend in Lisbon under $600, refundable", guardrails, budget);
  }

  return handleReplay(
    body.query === "jfk" ? "jfk" : "lisbon",
    Array.isArray(body.chaos) ? body.chaos : [],
    guardrails,
    budget,
  );
}

async function handleReplay(
  query: QueryId,
  chaos: Chaos[],
  guardrails: boolean,
  budget: number,
): Promise<Response> {
  const turn = buildTurn(query, chaos);
  const common = { query: turn.query, reply: turn.reply, toolCalls: turn.toolCalls, mode: "replay" };

  if (!guardrails) {
    // Exactly what the model produced, including whatever it invented.
    return Response.json({
      ...common,
      spec: turn.spec,
      state: turn.spec.state ?? {},
      traces: [],
      dropped: [],
      annotations: {},
      guardrails: false,
    });
  }

  const guard = buildGuard();
  const turnId = `turn-${Date.now()}`;

  guard.recordToolResult({
    turnId,
    toolName: "searchFlights",
    entity: "fares",
    key: "fareId",
    data: turn.fares,
  });
  guard.recordToolResult({
    turnId,
    toolName: "searchHotels",
    entity: "hotels",
    key: "hotelId",
    data: turn.hotels,
  });

  // The one line a host adds. Deleting it is how a host removes genui-guard.
  const { spec, dropped, annotations, traces } = await guardSpec(guard, turn.spec, {
    turnId,
    session: { role: "customer" },
    budget,
  });

  return Response.json({
    ...common,
    spec: attachAnnotations(spec, annotations),
    state: {
      ...(spec.state ?? {}),
      fares: keyed(turn.fares, "fareId"),
      hotels: keyed(turn.hotels, "hotelId"),
    },
    traces,
    dropped,
    // The guard reports which elements it flagged; deciding what that looks
    // like on screen is this app's job, not the guard's.
    annotations,
    removed: describeRemoved(dropped, turn.spec),
    outcomes: matchOutcomes(turn.injections, traces),
    guardrails: true,
  });
}

/**
 * Puts the guard's notes onto the cards they describe.
 *
 * This is host code on purpose. The guard reports which elements it flagged and
 * stops there, exactly as it does for the elements it withheld, because
 * attaching a note means choosing a property to write into and this app is the
 * only party that knows `note` is the right one. It writes only where the model
 * left that property empty: overwriting the model's own sentence to make room
 * for a warning about it would be its own small act of fabrication.
 */
function attachAnnotations(
  spec: JsonRenderSpec,
  annotations: Record<string, string[]>,
): JsonRenderSpec {
  if (Object.keys(annotations).length === 0) return spec;

  const elements = { ...spec.elements };
  for (const [id, notes] of Object.entries(annotations)) {
    const element = elements[id];
    if (!element || !("note" in element.props)) continue;
    if (element.props.note) continue;

    elements[id] = { ...element, props: { ...element.props, note: notes.join(" · ") } };
  }

  return { ...spec, elements };
}

/**
 * Pairs each active injection with what the guard actually decided about it, so
 * the developer panel can report the effect of one switch instead of leaving
 * the reader to diff two pages by eye.
 */
function matchOutcomes(
  injections: Injection[],
  traces: { elementId?: string; path?: string; final?: string; reason?: string; results?: { decision: string; reason: string }[] }[],
): Record<string, { decision: string; reason: string }> {
  const out: Record<string, { decision: string; reason: string }> = {};

  for (const injection of injections) {
    const trace = traces.find((t) =>
      injection.elementId
        ? t.elementId === injection.elementId
        : injection.statePath
          ? t.path === injection.statePath
          : false,
    );

    if (!trace) {
      out[injection.chaos] = {
        decision: "missed",
        reason: "No decision was recorded for this, so the guard did not catch it.",
      };
      continue;
    }

    // Several injections can land on one element: a literal price, a wrong stop
    // count and an invented badge all target the same fare card. Matching by
    // element alone made every row report whichever finding came first, so the
    // "nonstop" switch described itself with the price's reason. Injections
    // carry the prop they touched, and the guard's reasons name it as
    // "Component.prop", so prefer the finding that is actually about this one.
    const results = (trace.results ?? []).filter((r) => r.decision !== "allow");
    const interesting =
      (injection.prop && results.find((r) => r.reason.includes(`.${injection.prop}`))) ||
      results[0];
    out[injection.chaos] = {
      decision: trace.final ?? "allow",
      reason: interesting?.reason ?? trace.reason ?? "Allowed.",
    };
  }

  return out;
}

/** Where each blocked element used to sit, so the page can show the gap. */
function describeRemoved(
  dropped: string[],
  original: { elements: Record<string, { type: string; children?: string[] }> },
): { id: string; type: string; parentId: string | null }[] {
  return dropped.map((id) => {
    const parent =
      Object.entries(original.elements).find(([, el]) => (el.children ?? []).includes(id))?.[0] ??
      null;
    return { id, type: original.elements[id]?.type ?? "unknown", parentId: parent };
  });
}

/**
 * Live mode injects nothing. json-render's own prompt instructs the model to
 * include realistic sample data, so whatever it invents here, it invented on
 * its own.
 */
async function handleLive(
  prompt: string,
  guardrails: boolean,
  budget: number,
): Promise<Response> {
  let turn: Awaited<ReturnType<typeof runLiveTurn>>;
  try {
    turn = await runLiveTurn(prompt);
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : "The live turn failed." },
      { status: 502 },
    );
  }

  const common = { query: prompt, reply: turn.reply, toolCalls: turn.toolCalls, mode: "live" };
  const hostState = {
    fares: keyed(turn.fares, "fareId"),
    hotels: keyed(turn.hotels, "hotelId"),
  };

  const guard = buildGuard();
  const turnId = `live-${Date.now()}`;

  if (turn.fares.length > 0) {
    guard.recordToolResult({
      turnId,
      toolName: "searchFlights",
      entity: "fares",
      key: "fareId",
      data: turn.fares,
    });
  }
  if (turn.hotels.length > 0) {
    guard.recordToolResult({
      turnId,
      toolName: "searchHotels",
      entity: "hotels",
      key: "hotelId",
      data: turn.hotels,
    });
  }

  if (!guardrails) {
    // What the model produced, reassembled without being checked, so the
    // comparison against the guarded view is honest.
    const raw = rawSpecFrom(turn.events);
    return Response.json({
      ...common,
      spec: raw.spec,
      state: { ...raw.state, ...hostState },
      traces: [],
      dropped: [],
      annotations: {},
      guardrails: false,
    });
  }

  const { spec, dropped, annotations, traces } = await guardEvents(guard, turn.events, {
    turnId,
    session: { role: "customer" },
    budget,
  });

  return Response.json({
    ...common,
    spec: attachAnnotations(spec, annotations),
    state: { ...(spec.state ?? {}), ...hostState },
    traces,
    dropped,
    annotations,
    guardrails: true,
  });
}

/** What the model produced, unchecked. Used only for the guardrails-off view. */
function rawSpecFrom(events: GuardEvent[]): {
  spec: { root: string; elements: Record<string, unknown>; state: Record<string, unknown> };
  state: Record<string, unknown>;
} {
  const spec = {
    root: "",
    elements: {} as Record<string, unknown>,
    state: {} as Record<string, unknown>,
  };

  const back = (value: PropValue): unknown => {
    if (value.kind === "literal") return value.value;
    if (value.kind === "ref") return { $state: `/${value.path.split(".").join("/")}` };
    return value.raw;
  };

  for (const event of events) {
    if (event.kind === "root") {
      spec.root = event.id;
    } else if (event.kind === "element") {
      spec.elements[event.id] = {
        type: event.element.type,
        props: Object.fromEntries(
          Object.entries(event.element.props).map(([key, value]) => [key, back(value)]),
        ),
        children: event.element.children,
        ...(event.element.on
          ? {
              on: Object.fromEntries(
                Object.entries(event.element.on).map(([ev, b]) => [ev, { action: b.name }]),
              ),
            }
          : {}),
      };
    } else if (event.kind === "state") {
      spec.state[event.path] = event.value;
    }
  }

  return { spec, state: spec.state };
}
