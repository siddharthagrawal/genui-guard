# @genui-guard/json-render

The [json-render](https://json-render.dev) adapter for [genui-guard](https://github.com/siddharthagrawal/genui-guard). It reads your existing catalog and translates between json-render's wire formats and the guard's own events.

Research prototype, pre-1.0.

## What it does

Four jobs, none of which requires changing your json-render setup.

**Reuses your catalog.** `fromJsonRender(catalog, rules)` reads the component names and zod property schemas you already defined, and you add only what the guard needs on top: which properties are bound, what identifies a record, and what to render when something is blocked. A rule naming a component the catalog does not have is an error rather than a silent no-op.

**Translates both wire formats.** A whole spec, and the JSONL RFC 6902 patches json-render asks the model to stream. Patches map directly onto guard events, so the guard works on a live stream without buffering a turn.

**Puts the result back together.** Blocked elements are pruned from `children` *and* from every named slot, so the renderer never receives a dangling reference. Element fields the guard does not model, such as `visible`, `repeat` and `watch`, are preserved untouched.

**Expresses gates in json-render's own terms.** A gated action gets json-render's `confirm` field, so its existing `ConfirmDialog` and action layer handle the confirmation. No second mechanism.

It deliberately does not reimplement what json-render already does, and it is worth being exact about where that holds. Property validation runs against the zod schemas in your catalog, handed to the guard by `fromJsonRender`, so the rules come from your definitions rather than from a second description of them. Expression *resolution* stays with json-render, which does it at render time; the adapter only classifies which of the eight forms a property used, because that is what decides whether a bound property is a reference the guard can attribute to a record. The guard never evaluates a template or a computed value, which is exactly why it refuses them in bound properties.

This package imports nothing from `@json-render/core` at runtime. It reads the catalog structurally and talks to the guard in the guard's own types, which is what keeps a json-render upgrade a contained problem. The contract tests do import the real package, so an upgrade that changes a wire format fails there.

## Install

```bash
npm install @genui-guard/json-render @genui-guard/core @json-render/core zod
```

`@json-render/core` is a peer dependency pinned to `0.21.0`. json-render is pre-1.0, so the pin is deliberate: an upgrade should fail loudly here rather than quietly in your app. This package ships contract tests against the real package for that reason.

## Usage

```ts
import { createGuard, policies as p } from "@genui-guard/core";
import { fromJsonRender, guardSpec } from "@genui-guard/json-render";
import { catalog } from "./catalog";

const guard = createGuard({
  registry: fromJsonRender(catalog, {
    FlightCard: { entity: "fares", key: "fareId", bound: ["airline", "price", "stops"] },
  }),
  policies: [p.requireBinding(), p.confirmActions(["book"])],
});

guard.recordToolResult({ turnId, toolName: "searchFlights", entity: "fares", key: "fareId", data: fares });

// The one line you add. Deleting it is how you remove genui-guard.
const { spec, dropped, traces } = await guardSpec(guard, modelSpec, { turnId, session });
```

For a live model streaming patches rather than a finished spec, use `patchesToEvents` with `guardEvents`.

## A note on expressions

json-render supports eight property expression forms. Only `$state` and `$bindState` are direct references to a path, and those are the only ones a bound property may use. Templates, computed values and iteration scopes become `expr`, which the guard blocks in a bound property, because a template can interpolate a model-written fragment that cannot be attributed to a source.

That is strict, and the eval suites have now priced it. Across 51 legitimate components it is the only false block, 1 of 51, and the case it fires on is json-render's own `repeat` with `$item` properties, which is ordinary usage rather than an edge case. Templates and computed values on properties that are *not* bound pass untouched. So the remaining question is narrower than it was: whether `$item` inside a `repeat` over a reserved namespace can be attributed to a record, which it probably can, since the collection being iterated is the host's.

## MIT
