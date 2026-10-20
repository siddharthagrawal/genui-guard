"use client";

import { useState } from "react";
import { ALL_CHAOS, CHAOS_LABELS, type Chaos } from "../lib/fixtures";

export type Trace = {
  elementId?: string;
  component?: string;
  final?: string;
  path?: string;
  reason?: string;
  results?: { policy: string; decision: string; reason: string }[];
  cascadedFrom?: string;
};

const TONE: Record<string, string> = {
  allow: "bg-slate-700 text-slate-300",
  annotate: "bg-amber-500/20 text-amber-300",
  repair: "bg-sky-500/20 text-sky-300",
  gate: "bg-violet-500/20 text-violet-300",
  block: "bg-rose-500/20 text-rose-300",
};

/**
 * Everything a user of the travel app never sees. It is visually separate from
 * the product on purpose, because genui-guard is infrastructure rather than a
 * feature, and the demo should not imply otherwise.
 */
export type Outcome = { decision: string; reason: string };

export function DevPanel({
  guardrails,
  onGuardrails,
  chaos,
  onChaos,
  traces,
  dropped,
  outcomes,
  onClose,
}: {
  guardrails: boolean;
  onGuardrails: (on: boolean) => void;
  chaos: Chaos[];
  onChaos: (next: Chaos[]) => void;
  traces: Trace[];
  dropped: string[];
  /** What the guard decided about each active injection. */
  outcomes: Record<string, Outcome>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"inject" | "decisions">("inject");
  const [showAllowed, setShowAllowed] = useState(false);

  const counts = traces.reduce<Record<string, number>>((acc, t) => {
    const key = t.final ?? "allow";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const toggle = (c: Chaos) =>
    onChaos(chaos.includes(c) ? chaos.filter((x) => x !== c) : [...chaos, c]);

  const interventions = traces.filter((t) => (t.final ?? "allow") !== "allow");
  const allowed = traces.length - interventions.length;

  return (
    <aside className="flex h-full w-[23rem] shrink-0 flex-col border-l border-slate-700 bg-slate-900 text-slate-200">
      <header className="flex items-start justify-between gap-2 border-b border-slate-700 px-4 py-3">
        <div>
          <h2 className="font-mono text-xs font-semibold tracking-wide text-slate-100">
            genui-guard
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Developer view. The user never sees this.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 text-slate-500 hover:text-slate-200"
          aria-label="Close developer panel"
        >
          ✕
        </button>
      </header>

      <div className="border-b border-slate-700 px-4 py-3">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="text-sm font-medium text-slate-100">Guardrails</span>
            <span className="mt-0.5 block text-[11px] text-slate-400">
              {guardrails
                ? "Running on the server, between the model and the browser."
                : "Off. Whatever the model produced reaches the page."}
            </span>
          </span>
          <span className="relative inline-flex shrink-0">
            <input
              type="checkbox"
              checked={guardrails}
              onChange={(e) => onGuardrails(e.target.checked)}
              className="peer sr-only"
            />
            <span className="h-5 w-9 rounded-full bg-slate-600 transition peer-checked:bg-emerald-500" />
            <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
          </span>
        </label>
      </div>

      <nav className="flex gap-1 border-b border-slate-700 px-3 py-2">
        {(["inject", "decisions"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded px-2.5 py-1 text-xs ${
              tab === t ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t === "inject" ? "Inject failures" : `Full trace (${interventions.length})`}
          </button>
        ))}
      </nav>

      {tab === "inject" ? (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] text-slate-400">
              Chaos mode rewrites the recorded agent output.
            </p>
            <button
              type="button"
              onClick={() => onChaos(chaos.length === ALL_CHAOS.length ? [] : [...ALL_CHAOS])}
              className="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
            >
              {chaos.length === ALL_CHAOS.length ? "None" : "All"}
            </button>
          </div>

          <ul className="space-y-1.5">
            {ALL_CHAOS.map((c) => {
              const active = chaos.includes(c);
              const outcome = active ? outcomes[c] : undefined;
              return (
                <li key={c} data-testid={`outcome-${c}`}>
                  <button
                    type="button"
                    onClick={() => toggle(c)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                      active
                        ? "border-amber-500/40 bg-amber-500/10"
                        : "border-slate-700 hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          active ? "bg-amber-400" : "bg-slate-600"
                        }`}
                      />
                      <span className="text-xs font-medium text-slate-100">
                        {CHAOS_LABELS[c].title}
                      </span>
                      {outcome ? (
                        <span
                          className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            outcome.decision === "missed"
                              ? "bg-amber-500/20 text-amber-200"
                              : (TONE[outcome.decision] ?? TONE.allow)
                          }`}
                        >
                          {outcome.decision}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 pl-3.5 text-[11px] leading-snug text-slate-400">
                      {CHAOS_LABELS[c].detail}
                    </p>

                    {/* What the guard did about this one switch. */}
                    {outcome ? (
                      <p className="mt-1.5 ml-3.5 border-l-2 border-slate-600 pl-2 text-[11px] leading-snug text-slate-300">
                        {guardrails
                          ? outcome.reason
                          : "Guardrails are off, so this reached the page unchecked."}
                      </p>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/*
            The Inject tab answers "what did my switch do". This answers "what
            did the guard do across the whole turn", which is a different
            question: it includes the elements it examined and allowed, which is
            the only evidence that it is not simply blocking everything.
          */}
          <p className="mb-3 text-[11px] leading-snug text-slate-400">
            {traces.length === 0
              ? "Guardrails are off, so nothing was examined."
              : `${interventions.length} changed, ${allowed} examined and allowed.`}
          </p>

          {dropped.length > 0 ? (
            <p className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              {dropped.length} element{dropped.length === 1 ? "" : "s"} never reached the page.
              Blocked ids are pruned from their parents, so the renderer never gets a dangling
              reference.
            </p>
          ) : null}

          {traces.length === 0 ? null : (
            <>
              <ol className="space-y-3">
                {(showAllowed ? traces : interventions).map((t, i) => (
                  <li key={i} className="border-l-2 border-slate-700 pl-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TONE[t.final ?? "allow"] ?? TONE.allow}`}
                      >
                        {t.final ?? "allow"}
                      </span>
                      <span className="font-mono text-[11px] text-slate-200">
                        {t.component ?? t.path ?? t.elementId}
                      </span>
                      {t.cascadedFrom ? (
                        <span className="text-[10px] text-slate-500">via {t.cascadedFrom}</span>
                      ) : null}
                    </div>

                    {t.reason ? (
                      <p className="mt-1 text-[11px] leading-snug text-slate-400">{t.reason}</p>
                    ) : null}

                    {(t.results ?? [])
                      .filter((r) => r.decision !== "allow")
                      .map((r, j) => (
                        <p key={j} className="mt-1 text-[11px] leading-snug text-slate-400">
                          <span className="font-mono text-slate-500">{r.policy}</span> {r.reason}
                        </p>
                      ))}
                  </li>
                ))}
              </ol>

              {interventions.length === 0 && !showAllowed ? (
                <p className="text-[11px] text-slate-400">
                  Nothing was changed. The guard examined {allowed} things and allowed them all.
                </p>
              ) : null}

              {allowed > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAllowed(!showAllowed)}
                  className="mt-3 w-full rounded border border-slate-700 px-2 py-1.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  {showAllowed
                    ? `Hide the ${allowed} allowed`
                    : `Show the ${allowed} examined and allowed`}
                </button>
              ) : null}
            </>
          )}
        </div>
      )}

      <footer className="border-t border-slate-700 px-4 py-2.5">
        <p className="text-[10px] leading-snug text-slate-500">
          Role and input checks are defence in depth, not authorisation. The backend still has to
          enforce every permission.
        </p>
      </footer>
    </aside>
  );
}
