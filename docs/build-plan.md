# Build plan

There are three phases. Each is a git tag, and nothing moves forward until the acceptance criteria pass. This document is the working spec, so it is deliberately more prescriptive than the rest of `docs/`, and the parts that are genuinely undecided say so.

## Repository shape

```
genui-guard/
├── CLAUDE.md                 # rules and invariants, read first
├── packages/
│   ├── core/                 # guard, contract, provenance, policies, stream, trace, errors
│   ├── json-render/          # adapter: json-render spec and patches <-> neutral events
│   └── cli/                  # genui-guard check and test, plus the eval harness
├── apps/travel/              # travel search demo, three run modes
├── evals/                    # the two suites, the config, and the written report
├── examples/genui-guard.config.ts
└── docs/
```

`packages/core` has no dependency on the adapter, and `packages/json-render` is the only place json-render appears outside the demo.

One planned package turned out to be unnecessary. `packages/react` was going to hold a confirmation modal and fallbacks, and json-render already ships `ConfirmDialog` plus an action layer that honours the `confirm` field a gate sets, so there was nothing left for it to do.

`packages/cli` and `evals/` arrived in phase 3. The CLI depends on core and on no renderer: a config hands it a `run` adapter, so the suites can be written against json-render without the tooling knowing what json-render is.

## The neutral model

This is the part most worth getting right, because it is what keeps core free of renderer types and therefore what makes the layer claim provable. The adapter translates a json-render spec stream into these events, and translates the guarded result back.

```ts
type GuardEvent =
  | { kind: "root";    id: string }
  | { kind: "element"; id: string; element: GuardElement }
  | { kind: "state";   path: string; value: unknown }

type GuardElement = {
  id: string
  type: string
  props: Record<string, PropValue>
  children: string[]
  on?: Record<string, ActionBinding>      // event name -> action
}

type PropValue =
  | { kind: "literal"; value: unknown }
  | { kind: "ref";     path: string }     // a binding into state
  | { kind: "expr";    raw: unknown }     // template, computed, iteration scope
```

The three-way split on `PropValue` is the whole provenance mechanism. A bound prop must arrive as `ref`. A `literal` in a bound prop is a block. An `expr` in a bound prop is a block too, because a template can interpolate a model-authored fragment and genui-guard cannot verify the result. That last one is a judgement call and might turn out to be too strict, so note the rate it fires at in the evals before softening it.

## Public surface of core

Small on purpose. Adding to this needs a reason.

```ts
createGuard(config: GuardConfig): Guard
defineComponent(spec: ComponentSpec): ComponentSpec   // for hosts with no catalog
policies                                               // the policy namespace

type Guard = {
  recordToolResult(result: ToolResult): void
  check(element: GuardElement, ctx: Ctx): CheckResult   // one element, for tests
  stream(ctx: Ctx): TransformStream<GuardEvent, GuardEvent>
  wrap(events: AsyncIterable<GuardEvent>, ctx: Ctx): AsyncIterable<GuardEvent>
  traces(turnId: string): TraceEntry[]
}

type ToolResult = {
  turnId: string
  toolName: string
  entity: string              // reserved state namespace this populates, e.g. "fares"
  data: unknown
}

type ComponentRules = {
  entity?: string             // which recorded collection backs this component
  key?: string                // field identifying the entity, e.g. "fareId"
  bound?: string[]            // props that must arrive as refs into entity's namespace
  fallback?: string           // component to render when blocked
  a11y?: { requireAlt?: string[]; requireLabel?: string[] }
}

type Decision = "allow" | "annotate" | "repair" | "gate" | "block"
```

`recordToolResult` reserves `entity` as a state namespace owned by the guard for that turn. Declaring `bound` without `entity` and `key` is a config error with a fix hint, and `genui-guard check` catches it.

## Check order

Per element, in this order, with the strictest outcome winning.

1. **Contract.** Unknown component blocks. Invalid props repair by stripping unknown keys, then block if still invalid. Delegates to the host catalog's validator through the adapter.
2. **Provenance.** Each bound prop must be a `ref` whose path falls inside the component's reserved entity namespace and resolves against host state. The resolved entity's key must match. Literal or expression in a bound prop blocks. Unresolvable ref blocks. Entity absent blocks.
3. **Policies.** In config order, from the namespace below.
4. **Accessibility.** Required alt text and labels must be present and non-empty. Missing repairs with a generated fallback where one is derivable, otherwise blocks.

State events are checked separately and more simply. A patch writing into a reserved namespace is rejected and traced. Everything else passes.

## Policies in phase 1

```
requireBinding()                              // on by default
dropUnsourcedClaims({ topics })               // keyword and regex on free-text props
excludeWhere(entity, predicate)               // sold out, cancelled; blocks
annotateWhere(entity, predicate, note)        // over budget; annotates
requireRole(components, role)
confirmActions(names)                         // mutate actions become gated
safeUrls({ imageHosts, linkHosts })           // on by default, https and mailto only
restrictInputs({ allow })                     // credential and payment fields
maskFields(fields)
```

Every `PolicyResult.reason` is one plain sentence a developer can act on, for example "price is a literal value, and FlightCard.price must reference fares loaded by searchFlights." Those sentences are the trace, so write them as though someone will read them in an incident.

---

## Phase 1, the guard. Tag `ch1-core`

Complete as of 14 October 2026. 137 tests, 96.9% statements and 87.3% branches on core.

- [x] 90% line coverage on core, at 96.9%
- [x] Decision precedence correct, including conflicting repairs on one prop blocking
- [x] Tests cover each of: unknown component blocked; literal in a bound prop blocked; expression in a bound prop blocked; ref outside the reserved namespace blocked; ref to a missing entity blocked; key mismatch blocked; unsourced claim stripped; sold-out item blocked; over-budget annotated and still rendered; booking gated; staff-only component blocked for a customer session; `javascript:` URL and unapproved image host removed; password field outside an approved component blocked; loyalty number masked; missing alt text repaired
- [x] **A model state patch writing into a reserved namespace is rejected, and a bound ref to that path still resolves to the host value**, covered in `state.test.ts`, `provenance.test.ts` and end to end in `guard.test.ts`
- [x] State patches outside reserved namespaces pass through untouched
- [x] Blocking an element prunes its id from every parent and cascades to its subtree, verified on a three-level tree and on an element referenced twice
- [x] A streaming test shows a bound prop is never emitted before it is complete and verified
- [x] A hold that never resolves expires and blocks, rather than hanging
- [x] `stream()` works over a plain `ReadableStream` in Node, and `wrap()` matches it over an async iterable
- [x] Every error in the catalog has a code and a fix hint, asserted by a test that iterates the catalog
- [x] Zero runtime dependencies besides the `zod` peer, asserted in `architecture.test.ts`
- [x] No import of json-render anywhere in core, asserted in `architecture.test.ts`
- [x] A Vitest bench shows p95 check latency under 5ms per element, measured at 0.002ms mean and 0.0032ms p99
- [x] `examples/genui-guard.config.ts` type-checks, resolved against source so it cannot drift from the API

Three things came out differently from the plan. `GuardEvent` gained a `drop` kind, because blocking can happen after a parent has already streamed and the renderer needs telling. `ToolResult` gained an optional `key`, needed to address records in an array by identity rather than position, since position is exactly what a model gets wrong. And provenance gained a coherence check that blocks a component whose bound props resolve to different records, which catches the transposition failure and was not in the plan at all.

## Phase 2, travel search. Tag `ch2-travel`

Build `packages/json-render`, `packages/react`, and `apps/travel`. Check json-render's current docs before starting, since the version here is pre-1.0.

Data is fictional. Roughly 20 fares with `fareId`, airline, route, times, stops, price, `seatsLeft` and fare rules covering refundable, change fee and bags. Roughly 12 hotels with `hotelId`, name, nightly price, rating, image URL, image alt, free cancellation and `roomsLeft`. Two fares and two hotels sold out. Placeholder images on one allowlisted host. Harbor Air and similar invented carriers.

Tools are `searchFlights`, `searchHotels`, `getFareRules` and `book`, the last being a mutate action. Catalog is `FlightCard`, `HotelCard`, `FareRulesCard`, `TripSummary` and a staff-only `RefundOverride` for the role demonstration.

Chaos mode injects, at minimum: a literal price in a bound prop, a model state patch overwriting a fare price, an unsourced free cancellation badge, a sold-out hotel in results, a one-stop flight labelled nonstop, an ungated Book, `RefundOverride` shown to a customer, and a hotel image from an unapproved host. The state-patch case is the one worth showing first, because it is the failure that looks most legitimate.

- [x] "Weekend in Lisbon under $800, refundable" works in replay, chaos and live modes
- [x] In chaos mode the toggle visibly shows every injected failure getting through when off and caught when on
- [x] Removing genui-guard is deleting one `pipeThrough` line, with the json-render setup otherwise unchanged. The demo uses json-render's own `Renderer` and `JSONUIProvider`, so there is a real setup to leave unchanged
- [x] A Playwright smoke test passes, covering the user view, the developer panel, the chaos toggle and a gated booking
- [x] Fresh clone to running chaos demo with no API key
- [x] Contract tests against the real `catalog.validate` and `resolveElementProps`, so a json-render upgrade fails loudly
- [ ] Hold-until-verified shows a skeleton rather than a flash of an unverified fare, visible when throttled. The core behaviour is tested, but the demo records tool results before streaming, so there is nothing to hold; needs a deliberately slow tool to show

The layout changed during this phase. Chat sits on the left, the agent-composed results in the centre, and the developer panel is a separate dark surface on the right that opens on demand, so the default view is the product and the guardrails are opt-in. Live mode was added and turned out to need no chaos injection: json-render's generated prompt instructs the model to "include realistic sample data in state", so a model following its renderer's own instructions invents fares without being asked to.

## Phase 3, proof. Tag `ch3-evals`

Build `packages/cli`, the two suites, and the GitHub Action.

Two suites only, for the reasons in the decision log. **Detection** runs held-out cases including paraphrased claims, and the paraphrases must be written before the claim policy is implemented, or the circularity returns. **Clean** runs legitimate components that must pass untouched, and its false-block rate is the headline number.

Complete as of 17 October 2026, apart from the outside testers. 51 clean cases, 76 held-out detection cases, 2.0% false blocks, 51.3% detection.

- [x] `genui-guard check` validates config and registry, and catches `bound` declared without `entity` and `key`, plus a typo in `bound`, an array tool result with no key, a policy referenced but never called, and a threshold that is not a rate
- [x] `genui-guard test --mode replay` runs in under 30 seconds with no network, measured at 0.2s
- [x] Report written to `evals/reports/latest.md`, with the detection gap stated rather than smoothed
- [x] README eval section filled with real measured numbers
- [x] Non-zero exit when configured thresholds fail, asserted in `cli.test.ts` against a fixture config whose limit is zero
- [x] A test pull request shows the eval comment, verified on pull request 1: the job posts one comment carrying the false-block rate first, and a second run edits that comment in place rather than adding another
- [ ] Three outside testers reach a first guarded component in under five minutes, with findings and fixes recorded

Four things came out differently from the plan.

The held-out cases were written and committed in their own commit, before the claim policy's implementation or its configured topic list had been read in this phase, and `docs/eval-protocol.md` pre-registers what that forbids afterwards. That was not in the plan as a mechanism, only as an intention, and the intention would not have survived contact with a disappointing number.

The suites found three defects that 206 passing tests had not. Contract property validation was never wired into the guard at all, so the second half of check-order step 1 was documentation rather than behaviour. A state key written as a JSON Pointer skipped the reserved-namespace screen entirely, because the whole pointer became the root segment and matched no namespace, which is the headline failure arriving by spelling the path differently. And the accessibility repair could only read literal properties, so in any real catalog, where the name beside an image is bound, it withheld the card instead of repairing it. All three are fixed, with tests, and each is noted where it was fixed.

The CLI knows nothing about json-render. The config supplies a `run` adapter, so the CLI depends on core only and the suites stay renderer-neutral, which keeps the layer claim provable in the tooling as well as in the library.

The two false-block rates are reported separately. A withheld element and an element that rendered with a true badge removed are both wrong and are not the same size of wrong, and the phase 2 `bagsIncluded` bug was the second kind.

## How do the packages get published?

`pnpm release` from the root, which is `pnpm --filter "@genui-guard/*" publish --access public`. The gate was the eval suites, so that the false block rate is a measured number rather than a promise, and that gate is now passed. `evals` is private and matches the filter, so pnpm skips it.

Three packages publish: core, the json-render adapter, and the CLI. Two details are worth not rediscovering.

Use `pnpm publish`, never `npm publish`. The adapter depends on `"@genui-guard/core": "workspace:*"`, and pnpm rewrites that to the real version on publish while npm would ship the literal string and break every install.

Both manifests carry `publishConfig.access: "public"`. Scoped packages default to restricted, and publishing one without that field fails unless the account is paid, which is the most common first-publish failure.

`prepublishOnly` runs the build and the tests, so an untested or unbuilt package cannot be published by accident. Both were verified with a dry run: 47 files for core and 31 for the adapter, with the README and LICENSE included and no sources or tests leaking into the tarball.

The `@genui-guard` scope is reserved by creating a free npm organisation of that name, which requires no publish and no CLI login.

## Open questions

Carried deliberately rather than guessed at.

Whether blocking on `expr` in a bound prop is too strict now has a number rather than an opinion. It is the only false block in the clean suite, 1 of 51, and the case it fires on is json-render's own `repeat` with `$item` properties, which is ordinary renderer usage rather than an edge case. The other four expression cases pass, so a template or a computed value on a property that is not bound is already fine. The question left is narrower than the original one: whether `$item` inside a `repeat` over a reserved namespace can be attributed to a record, which it probably can, since the collection being iterated is the host's. How the reserved namespace should behave across turns, since stale data from a previous turn is a real failure the current design does not address. Whether `maskFields` belongs in v1 at all, given it has no demo. And whether `check()` on a single element is worth keeping in the public surface once `stream()` works, or whether it should be test-only.
