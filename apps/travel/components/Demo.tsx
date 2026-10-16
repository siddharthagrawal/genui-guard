"use client";

import { JSONUIProvider, Renderer } from "@json-render/react";
import { useCallback, useEffect, useState } from "react";
import { ALL_CHAOS, QUERIES, type Chaos, type QueryId, type ToolCall } from "../lib/fixtures";
import { ChatPanel, type Message } from "./ChatPanel";
import { DevPanel, type Outcome, type Trace } from "./DevPanel";
import { registry, UnknownComponent } from "./registry";

type Element = {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
  on?: Record<string, unknown>;
};

type Payload = {
  spec: { root: string; elements: Record<string, Element> };
  state: Record<string, unknown>;
  traces: Trace[];
  dropped: string[];
  guardrails: boolean;
  query: string;
  reply: string;
  toolCalls: ToolCall[];
  mode?: "replay" | "live";
  outcomes?: Record<string, Outcome>;
  removed?: { id: string; type: string; parentId: string | null }[];
};

export function Demo({ devOpen: devOpenInitial }: { devOpen: boolean }) {
  const [devOpen, setDevOpen] = useState(devOpenInitial);
  const [guardrails, setGuardrails] = useState(true);
  const [chaos, setChaos] = useState<Chaos[]>(devOpenInitial ? [...ALL_CHAOS] : []);

  const [query, setQuery] = useState<QueryId>("lisbon");
  const [asked, setAsked] = useState<QueryId[]>(["lisbon"]);
  // Seeded with the opening question, because the first turn runs on mount and
  // the thread should read as a conversation from the start.
  const [messages, setMessages] = useState<Message[]>([
    { role: "user", text: labelFor("lisbon") },
  ]);
  const [data, setData] = useState<Payload | null>(null);
  const [pending, setPending] = useState(false);
  const [live, setLive] = useState<{ available: boolean; reason?: string } | null>(null);
  const [livePrompt, setLivePrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Whether a real model is reachable is a server fact, so ask the server.
  useEffect(() => {
    void fetch("/api/search")
      .then((r) => r.json())
      .then((d: { live: { available: boolean; reason?: string } }) => setLive(d.live))
      .catch(() => setLive({ available: false, reason: "Could not reach the server." }));
  }, []);

  const load = useCallback(
    async (id: QueryId) => {
      setPending(true);

      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          livePrompt
            ? { mode: "live", prompt: livePrompt, guardrails, budget: 800 }
            : { query: id, guardrails, chaos, budget: 800 },
        ),
      });

      if (!res.ok) {
        const failed = (await res.json()) as { error?: string };
        setError(failed.error ?? "That turn failed.");
        setPending(false);
        return;
      }

      setError(null);
      const payload = (await res.json()) as Payload;

      setData(payload);
      setMessages((m) => {
        const agent: Message = {
          role: "agent",
          text: payload.reply,
          toolCalls: payload.toolCalls,
          composed: Object.keys(payload.spec.elements).length,
        };

        // Changing a guardrail or an injection re-runs the same question, so
        // the trailing reply is replaced rather than the thread growing a
        // duplicate. A new question leaves a user message last, so this appends.
        const base = m.at(-1)?.role === "agent" ? m.slice(0, -1) : m;
        return [...base, agent];
      });
      setPending(false);
    },
    [guardrails, chaos, livePrompt],
  );

  // Re-runs whenever the developer changes something, so the page on the left
  // always reflects the current configuration.
  useEffect(() => {
    void load(query);
  }, [load, query]);

  const ask = (id: QueryId) => {
    setLivePrompt(null);
    setMessages((m) => [...m, { role: "user", text: labelFor(id) }]);
    setQuery(id);
    setAsked((a) => (a.includes(id) ? a : [...a, id]));
  };

  const askLive = (prompt: string) => {
    setMessages((m) => [...m, { role: "user", text: prompt }]);
    setLivePrompt(prompt);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <div className="w-[21rem] shrink-0">
        <ChatPanel
          messages={messages}
          pending={pending}
          asked={asked}
          onAsk={ask}
          live={live}
          onAskLive={askLive}
        />
      </div>

      <main className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900">
              {data?.query ?? "Loading"}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {data
                ? `${countOf(data, "FlightCard")} flights · ${countOf(data, "HotelCard")} stays`
                : ""}
              {data?.mode === "live" ? (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                  live model
                </span>
              ) : null}
            </div>
          </div>

          {!devOpen ? (
            <button
              type="button"
              onClick={() => setDevOpen(true)}
              className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 font-mono text-xs text-white hover:bg-slate-700"
            >
              genui-guard
            </button>
          ) : null}
        </div>

        <div className={`px-6 py-6 ${pending ? "opacity-50" : ""}`}>
          {error ? (
            <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {error}
            </p>
          ) : null}
          {devOpen && data?.removed?.length ? <RemovedNotice removed={data.removed} /> : null}
          {data ? <Surface payload={data} /> : <p className="text-sm text-slate-400">Loading…</p>}
        </div>
      </main>

      {devOpen ? (
        <DevPanel
          guardrails={guardrails}
          onGuardrails={setGuardrails}
          chaos={chaos}
          onChaos={setChaos}
          traces={data?.traces ?? []}
          dropped={data?.dropped ?? []}
          outcomes={data?.outcomes ?? {}}
          onClose={() => setDevOpen(false)}
        />
      ) : null}
    </div>
  );
}

function labelFor(id: QueryId): string {
  return QUERIES.find((q) => q.id === id)?.label ?? "";
}

function countOf(payload: Payload, type: string): number {
  return Object.values(payload.spec.elements).filter((e) => e.type === type).length;
}

/**
 * The gaps, shown only while the developer panel is open. Without this a block
 * is invisible: the card simply is not there, and nothing on the page says so.
 */
function RemovedNotice({
  removed,
}: {
  removed: { id: string; type: string; parentId: string | null }[];
}) {
  return (
    <div className="mb-6 space-y-2 rounded-xl border border-dashed border-rose-300 bg-rose-50/60 p-4">
      <div className="text-xs font-semibold text-rose-900">
        {removed.length} component{removed.length === 1 ? "" : "s"} removed before this page
        rendered
      </div>
      <ul className="space-y-1">
        {removed.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-[11px] text-rose-800">
            <span className="rounded bg-white px-1.5 py-0.5 font-mono">{r.type}</span>
            <span className="font-mono text-rose-400">{r.id}</span>
            {r.parentId ? <span className="text-rose-500">was inside {r.parentId}</span> : null}
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-rose-700">
        Only shown to a developer. A user would see the page without them and nothing else.
      </p>
    </div>
  );
}

/**
 * json-render's own Renderer, driven by its provider stack. Using theirs rather
 * than a walker of our own is what makes the one-line-removal claim true: this
 * is an ordinary json-render setup, and genui-guard is a pipeThrough on the
 * server that this file knows nothing about.
 *
 * It also means gating is real. `emit` goes through json-render's action layer,
 * which honours the `confirm` field the guard set, so the confirmation dialog
 * is theirs and not a simulation.
 */
function Surface({ payload }: { payload: Payload }) {
  if (!payload.spec.root) {
    return (
      <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
        Every component on this page was blocked.
      </p>
    );
  }

  return (
    <JSONUIProvider
      registry={registry}
      initialState={payload.state}
      handlers={{
        book: () => window.alert("Booked, and your card was charged."),
        refund: () => window.alert("Refund issued."),
        filter: () => {},
      }}
    >
      <Renderer
        spec={payload.spec as never}
        registry={registry}
        fallback={UnknownComponent as never}
      />
    </JSONUIProvider>
  );
}
