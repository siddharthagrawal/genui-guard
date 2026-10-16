"use client";

import { defineRegistry } from "@json-render/react";
import type { ReactNode } from "react";
import { catalog } from "../lib/catalog";
import { AirlineMark, HotelPhoto, PhotoRemoved } from "./Brand";

/**
 * json-render component renderers. Each receives the resolved element plus
 * `emit`, which dispatches the element's bound action through json-render's own
 * action layer. That layer honours the `confirm` field, so a gate set by
 * genui-guard produces a real confirmation dialog rather than a simulated one.
 *
 * Nothing here knows genui-guard exists. The guard works on the stream.
 */

/**
 * What defineRegistry hands a component: resolved props, rendered children, and
 * `emit` to dispatch the element's bound action. Verified against the installed
 * @json-render/react 0.21.0, whose wrapper passes `element.props` as `props`.
 */
type Props<P> = {
  props: P;
  children?: ReactNode;
  slots?: Record<string, ReactNode>;
  emit: (event: string) => void;
};

/** Claims a card makes. The guard can remove one without touching the others. */
function Badges({ items }: { items?: string[] | null }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {items.map((b) => (
        <span
          key={b}
          className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
        >
          {b}
        </span>
      ))}
    </div>
  );
}

function Stack({ props, children }: Props<{ gap?: number; heading?: string | null }>) {
  const { gap, heading } = props;
  return (
    <section className="w-full">
      {heading ? (
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {heading}
        </h2>
      ) : null}
      <div style={{ display: "grid", gap: `${(gap ?? 4) * 4}px` }}>{children}</div>
    </section>
  );
}

function FlightCard({
  props,
}: Props<{
  airline?: string;
  price?: number;
  stops?: number;
  depart?: string | null;
  arrive?: string | null;
  badges?: string[] | null;
  note?: string | null;
}>) {
  const { airline, price, stops, depart, arrive, badges, note } = props;
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          {airline ? <AirlineMark name={airline} /> : null}
          <div>
          <div className="font-medium text-slate-900">{airline ?? "—"}</div>
          <div className="mt-1 text-sm text-slate-600">
            {depart ?? "--:--"} to {arrive ?? "--:--"} ·{" "}
            {stops === 0 ? "Nonstop" : `${stops ?? "?"} stop${stops === 1 ? "" : "s"}`}
          </div>
          <Badges items={badges} />
          </div>
        </div>
        <div className="text-xl font-semibold tabular-nums text-slate-900">
          {price === undefined || price === null ? "—" : `$${price}`}
        </div>
      </div>
      {note ? <p className="mt-3 text-xs text-amber-700">{note}</p> : null}
    </article>
  );
}

function HotelCard({
  props,
}: Props<{
  name?: string;
  nightly?: number;
  rating?: number | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  badges?: string[] | null;
  note?: string | null;
}>) {
  const { name, nightly, rating, imageUrl, imageAlt, badges, note } = props;
  return (
    <article className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-100">
        {imageUrl ? (
          // Generated rather than fetched, so the fictional host never has to
          // resolve. The guard still decides whether a photo renders at all.
          <HotelPhoto name={name ?? ""} alt={imageAlt ?? ""} />
        ) : (
          <PhotoRemoved reason="photo removed" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-slate-900">{name ?? "—"}</div>
        <div className="mt-1 text-sm text-slate-600">
          {nightly === undefined || nightly === null ? "—" : `$${nightly} per night`}
          {rating ? ` · ${rating}` : ""}
        </div>
        <Badges items={badges} />
        {note ? <p className="mt-2 text-xs text-amber-700">{note}</p> : null}
      </div>
    </article>
  );
}

function FareRulesCard({
  props,
}: Props<{ refundable?: boolean; changeFee?: number; bagsIncluded?: number }>) {
  const { refundable, changeFee, bagsIncluded } = props;
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
      <div>Refundable: {refundable ? "yes" : "no"}</div>
      <div>Change fee: ${changeFee ?? 0}</div>
      <div>Bags included: {bagsIncluded ?? 0}</div>
    </article>
  );
}

function TripSummary({
  props,
  emit,
}: Props<{ total?: number | null; loyaltyId?: string | null; note?: string | null }>) {
  const { total, loyaltyId, note } = props;
  return (
    <article className="rounded-xl border border-slate-300 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-slate-600">Estimated trip total</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-900">
            {total == null ? "—" : `$${total}`}
          </div>
          {loyaltyId ? (
            <div className="mt-1 text-xs text-slate-500">Loyalty {loyaltyId}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => emit("press")}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Book now
        </button>
      </div>
      {note ? <p className="mt-3 text-xs text-amber-700">{note}</p> : null}
    </article>
  );
}

function RefundOverride({ props, emit }: Props<{ reason?: string | null }>) {
  return (
    <article className="rounded-xl border-2 border-dashed border-rose-300 bg-rose-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">
        Staff only
      </div>
      <div className="mt-1 text-sm text-rose-900">Override this fare&apos;s refund rules</div>
      {props.reason ? (
        <p className="mt-1 text-xs text-rose-700">{props.reason}</p>
      ) : null}
      <button
        type="button"
        onClick={() => emit("press")}
        className="mt-3 rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-medium text-white"
      >
        Issue refund
      </button>
    </article>
  );
}

function PaymentForm({ props }: Props<{ type?: string | null; name?: string | null }>) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <label className="block text-sm text-slate-700">
        {props.name ?? "Card number"}
        <input
          type={props.type ?? "text"}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
        />
      </label>
    </article>
  );
}

function TextField({
  props,
}: Props<{ label?: string | null; type?: string | null; name?: string | null }>) {
  const { label, type, name } = props;
  return (
    <label className="block rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
      {label ?? name ?? "Field"}
      <input
        type={type ?? "text"}
        name={name ?? undefined}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
      />
    </label>
  );
}

/** Built from the same catalog the guard reads, so the two cannot drift apart. */
export const { registry } = defineRegistry(catalog, {
  components: {
    Stack,
    FlightCard,
    HotelCard,
    FareRulesCard,
    TripSummary,
    RefundOverride,
    PaymentForm,
    TextField,
  },
} as never);

/** Passed to Renderer's `fallback`, which is a raw renderer and does get `element`. */
export function UnknownComponent({ element }: { element: { type: string } }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500">
      No component registered for {element.type}
    </div>
  );
}
