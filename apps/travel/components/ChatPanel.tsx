"use client";

import { useState } from "react";
import { QUERIES, type QueryId, type ToolCall } from "../lib/fixtures";

export type Message =
  | { role: "user"; text: string }
  | { role: "agent"; text: string; toolCalls?: ToolCall[]; composed?: number };

export function ChatPanel({
  messages,
  pending,
  asked,
  onAsk,
  live,
  onAskLive,
}: {
  messages: Message[];
  pending: boolean;
  asked: QueryId[];
  onAsk: (id: QueryId) => void;
  /** Whether a real model is reachable, and why not when it is not. */
  live: { available: boolean; reason?: string } | null;
  onAskLive: (prompt: string) => void;
}) {
  const remaining = QUERIES.filter((q) => !asked.includes(q.id));
  const [draft, setDraft] = useState("");
  const canSend = live?.available === true && draft.trim().length > 0 && !pending;

  return (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white">
      <header className="border-b border-slate-200 px-5 py-4">
        <h1 className="text-sm font-semibold text-slate-900">Trip planner</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Ask for a trip and the results build themselves.
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">Pick a question below to start.</p>
        ) : null}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-slate-900 px-3.5 py-2 text-sm text-white">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              {m.toolCalls?.length ? (
                <div className="space-y-1">
                  {m.toolCalls.map((t) => (
                    <div
                      key={t.name}
                      className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="font-mono font-medium text-slate-700">{t.name}</span>
                      <span className="truncate font-mono text-slate-400">{t.args}</span>
                      <span className="ml-auto shrink-0 rounded bg-white px-1.5 py-0.5 font-medium text-slate-600">
                        {t.resultCount}
                      </span>
                    </div>
                  ))}
                  <p className="px-1 text-[10px] text-slate-400">
                    These results are the source of truth for this turn.
                  </p>
                </div>
              ) : null}

              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2 text-sm text-slate-800">
                {m.text}
              </div>

              {m.composed !== undefined ? (
                <p className="px-1 text-[11px] text-slate-400">
                  Composed {m.composed} components on the right.
                </p>
              ) : null}
            </div>
          ),
        )}

        {pending ? (
          <div className="flex gap-1 px-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="border-t border-slate-200 p-3">
        {remaining.length > 0 ? (
          <div className="space-y-1.5">
            {remaining.map((q) => (
              <button
                key={q.id}
                type="button"
                disabled={pending}
                onClick={() => onAsk(q.id)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-40"
              >
                {q.label}
              </button>
            ))}
          </div>
        ) : null}

        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSend) return;
            onAskLive(draft.trim());
            setDraft("");
          }}
        >
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-slate-400">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!live?.available || pending}
              placeholder={
                live?.available ? "Ask anything" : "Ask anything (needs an API key)"
              }
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!canSend}
              className="shrink-0 rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white disabled:bg-slate-300"
            >
              {live?.available ? "live" : "off"}
            </button>
          </div>

          {live && !live.available ? (
            <p className="mt-1.5 px-1 text-[10px] leading-snug text-slate-400">{live.reason}</p>
          ) : live?.available ? (
            <p className="mt-1.5 px-1 text-[10px] leading-snug text-slate-400">
              A real model, with json-render&apos;s own prompt. Nothing is injected, so whatever it
              gets wrong, it got wrong on its own.
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
