# genui-guard

**genui-guard is a trust layer for generative UI.** It sits on your server, between the AI agent that decides what to show and the renderer that draws it, and it checks that what the user sees is **true, permitted, and safe** before it reaches the screen.

This is a prototype. The interfaces are pre-1.0 and all demo data is fictional.

---

## What problem does genui-guard solve?

In generative UI, an AI model decides at runtime what to put on screen. Instead of replying with a paragraph of text, it assembles a working interface from live data. Throughout this README I use one running example, a travel assistant that answers a trip query by composing flight and hotel results on the page. In that setting a single answer might be a flight card that shows an airline, a price, a refund badge, and a Book Now button.

Most teams keep this safe by giving the model a component catalog. Frameworks like [json-render](https://json-render.dev), assistant-ui, and A2UI let you define a fixed set of pre-approved building blocks, each with a defined shape, so the model can only emit components that exist and are structurally valid.

A catalog makes a component valid but it does not make the component true. A valid `FlightCard` can still show the wrong fare, a refund policy that does not exist, or a button nobody approved. This matters more for a rendered interface than it does for text. A hallucination in a chat bubble reads like an opinion, while the same hallucination rendered as a card with a fare, a refund badge, and a Book button reads like a fact. Companies are held to what their assistants present this way. There is an interesting case of *Moffatt v. Air Canada* (2024) where a tribunal held the airline liable for a bereavement fare discount its chatbot had invented ([Link with more details if you want to read more about it.](https://en.wikipedia.org/wiki/Moffatt_v._Air_Canada)).

---

## What is the core idea?

Bad data gets through even when every fare comes from a real API, because the model writes the component's properties itself. Here is what that means in practice. The travel assistant calls `searchFlights`, and your server loads the result.

```jsonc
// searchFlights result, loaded by your server
{ "fares": { "HA-2041": {
  "fareId": "HA-2041", "airline": "Harbor Air", "price": 412, "stops": 1, "seatsLeft": 4,
  "fareRules": { "refundable": false, "changeFee": 90, "bagsIncluded": 1 }
} } }
```

What happens next depends on which pattern your stack uses, and it is worth being precise because the risk is not universal.

In the pattern genui-guard targets, the model emits a UI specification. It writes out a new `FlightCard` and fills in each property itself, putting the airline in one field and the price in another. Nothing forces what it types to match what it read. It can write `189` into the price field instead of `412`, label a one stop fare as nonstop, or add a free cancellation badge the fare never offered. Each of those is still a structurally valid `FlightCard`, so the catalog raises no objection. This is not a hypothetical. json-render's own generated prompt instructs the model to "include realistic sample data in state," and offers "for product lists: 3-5 items with names, prices, descriptions" as the example.

Worth being precise about why that happens, because it changes where you put the fix. A model filling in a plausible badge or a fallback price is not malfunctioning; it is completing a layout, which is what it was trained to do and what its renderer's own prompt asked for. Sparse tool schemas and null fields leave gaps, and a model post-trained to be helpful fills gaps. Treating fabricated interface data as a side effect of helpfulness rather than as a defect is what moves the fix out of the prompt and into a check that does not depend on the model complying.

In the other common pattern, used by the Vercel AI SDK's `streamUI`, the model only chooses a tool and supplies its typed input, and your own code fetches the data and passes it to the component. The data never passes through the model, so provenance is already solved there and the policies further down are what still apply.

The common defence in the first pattern is comparison. You let the model write what it wants, then check each value against the source and repair the mismatches. Here, I am proposing something stricter. For any property you mark as bound, the model may not write a value at all. It may only emit a reference that resolves into data your server loaded from a real tool result.

```jsonc
// FlightCard, as the model emits it
{
  "type": "FlightCard",
  "props": {
    "airline": { "$state": "fares.HA-2041.airline" },  // resolves into host data (allowed)
    "price":   { "$state": "fares.HA-2041.price" },    // resolves into host data (allowed)
    "stops":   0,                                      // model-authored value in a bound prop
    "badges":  ["Bag included", "Free cancellation"]    // one supported claim, one invented
  }
}
```

Those are the real values for `HA-2041` in the demo's data. Run that element through the guard and it produces two findings and one outcome:

```
block:  FlightCard.stops is a literal value written by the model, and it must
        reference fares loaded by the host instead.
repair: FlightCard.badges claimed "Free cancellation", which nothing in the
        source data supports, so it was removed and the remaining claim kept.
```

The card does not render. Both findings are recorded, and because the strictest decision wins, the repair never gets to apply to this element: there is no card left to put a badge on. Correct the `stops` reference and the same element renders with `badges: ["Bag included"]`, which is the point of a repair being surgical. `"Bag included"` is supported by `bagsIncluded: 1` and survives, `"Free cancellation"` has no field behind it and is removed on its own, and clearing the whole property would have discarded a true badge, which is a different kind of wrong answer.

`$state` is json-render's syntax for a property whose value is looked up from application state at render time rather than written into the component. Other catalogs spell it differently, and the general idea is a reference instead of a literal.

When the model writes a literal number into a bound property, that is a failure by construction. There is nothing to compare, because the model was never allowed to author the number.

A reference on its own is not enough, though, and this is the part that is easy to get wrong. In json-render, the model streams state alongside the elements that read it, so it can emit a reference to `fares.HA-2041.price` and then emit a state patch that puts `189` at exactly that path. The reference would resolve perfectly and still be a fabrication. What makes a bound property trustworthy is therefore not the syntax but the namespace. The guard owns the paths that back bound properties, populates them only from `recordToolResult`, rejects any model-authored state patch that writes into them, and resolves bound references against host state rather than against the merged result.

With that in place a bound value can never be invented. It is either a reference that resolves into data your server loaded, or it is absent. Whether it resolves against the *right* record is a separate question, and the section on what genui-guard does not catch is honest about it.

### Why not just pass the model an ID?

The obvious objection to all of this is that `FlightCard` should take a single `fareId` and read the record itself, at which point there is nothing for a guard to verify. It is the right question, and the answer has three parts.

The first is that it does not actually fix the problem here. In json-render the model streams state alongside the elements that read it, so a component resolving `state.fares["HA-2041"]` renders whatever was written to that path, and the model is one of the writers. An ID-only property narrows what the model can author about *presentation* while leaving the data itself model-reachable. What makes a bound value trustworthy is the guard owning the namespace, not the shape of the property.

The second is that it assumes a bespoke component per tool. Teams that ship this at any scale hand the model generic primitives instead, a `DataCard`, a `ComparisonTable`, a `MetricStat`, which get composed across arbitrary tools. A generic card cannot look up a `fareId`, because it has never heard of fares; it has to receive a title and a metric and a set of badges, which puts us back where we started.

The third is that the interesting components are hybrids. Even a bespoke `FlightCard` mixes strict facts, the price and the stop count, with model-synthesised presentation, the badges and the sentence explaining why this option suits the request. The facts want binding and the prose wants claim checking, and an ID-shaped property has nothing to say about the second half.

Where passing an ID *is* available, it is a good idea and genui-guard is cheap insurance on top of it rather than a replacement for it.

### One component, one record

Binding each property separately opens a failure that comparison would never notice: every reference resolves, and they resolve to different records. A card showing Harbor Air's name beside a cheaper flight's price is wrong in a way no individual property is wrong.

That is what `key: "fareId"` is for. Every bound property on one component instance must resolve to the same record, not merely to some record, and a component whose bound properties straddle two of them is blocked with a reason naming both. This was not in the original design; it came out of asking what a confused model gets wrong about a list, and the answer is position.

Comparison forces a bad choice whenever the model's number is wrong. If you rewrite the card to the correct price, it contradicts the model's own surrounding prose, which genui-guard never sees. If you hide the card, the user gets no explanation. If you show it, you are back to the original problem. Requiring a reference removes the choice entirely.

Value comparison stays available for teams whose models already write literal properties, and [docs/concepts.md](docs/concepts.md) explains that trade-off.

---

## What does genui-guard catch?

Every decision below is recorded in a trace.

| Failure | Example | Outcome |
|---|---|---|
| Model-authored data | Card hardcodes `price: 189`, the fare API says `412` | Block, repair available |
| Model-authored source | A state patch writes `189` into a path backing a bound property | Block |
| Wrong label | `stops: 0` written onto a flight with a layover | Block, repair available |
| Unsourced claim | "Free cancellation" that no fare rule supports | Repair, that claim removed, supported ones kept |
| Mixed records | One card with this airline's name and a cheaper flight's price | Block |
| Unavailable item | A sold out hotel in the results | Block |
| Unmet preference | A trip over the user's stated budget | Annotate |
| Unpermitted component | A staff only refund override shown to a customer | Block |
| Unconfirmed action | `book` fires on a single click | Gate behind confirmation |
| Unsafe URL | A `javascript:` scheme, or an unapproved image host | Repair, URL removed |
| Spoofed input | A password or card field outside an approved component | Block |
| Inaccessible markup | A hotel photo with no alt text | Repair, otherwise block |

Read that table alongside the measured numbers further down rather than instead of them. The first two rows and the structural ones are what the mechanism guarantees. The claim row depends on a topic you configured matching the wording the model used, and the held-out suite puts a number on how often that fails: a badge reading "Nonstop" on a one-stop fare is not caught, because nothing told the checker that stop counts are a claim.

---

## What does it not catch?

The guard verifies that a component's properties are faithful to the entity the model said it was showing. It cannot verify that this was the right entity. If the model binds every property correctly to a fare the user never asked about, every check passes, the trace is clean, and the card is still wrong. Choosing the right entity remains the model's job, and the eval suites measure that gap rather than hiding it.

Claim checks look for particular words, so a refund promise phrased as being able to get your money back whenever you like carries no vocabulary the rules recognise. That is measured rather than papered over: the held-out suite catches 0 of 18 paraphrased claims, and a semantic check is the first item on the roadmap.

Accessibility coverage is static only. Alt text, labels and heading structure are all visible in the specification, so the guard can check them. Contrast, focus order and ARIA correctness need the rendered DOM, which a server-side guard never sees, so those belong to a different layer.

---

## Where does genui-guard fit?

| Layer | Examples | What it covers | Relationship to genui-guard |
|---|---|---|---|
| Catalog frameworks | `@json-render/core`, assistant-ui, A2UI | Component allowlists, property schemas, streaming partial properties | Reuses their catalogs, validators, and expression resolvers |
| Text guardrails | Guardrails AI, NeMo Guardrails | Text and structured data checks | A different layer, and a different language runtime |
| Sandboxing | Artifacts style iframes, MCP apps | Isolating arbitrary generated code | For open ended UI, where genui-guard targets catalog UI |
| **genui-guard** | | Data provenance, roles, actions, URLs, inputs, traces, and evals | The trust layer on the stream |

genui-guard does not reimplement what json-render already does well. It calls `catalog.validate()` for contract validation, `resolveElementProps()` for expression resolution, and `autoFixSpec()` for structural repair. Trace viewing uses `@json-render/devtools`. The full analysis is in [docs/competitive-scan.md](docs/competitive-scan.md).

---

## How does it work?

The tool results the model fetched during the current turn are the source of truth for that turn, and `recordToolResult` is what loads them into the state paths the guard owns. As the interface streams in, the guard walks the spec as it arrives, runs its checks in order on each element, and applies the most restrictive outcome. Blocking beats gating, gating beats repairing, repairing beats annotating, and annotating beats allowing.

State patches get the same treatment as elements. A patch writing into a path that backs a bound property is rejected, because that path belongs to the host, while patches to everything else pass through untouched so ordinary interactive state keeps working.

The guard runs on the server, between the model and the transport. I require this. A check that runs in the browser is a check the client can remove.

Blocking is a tree edit rather than a filter. json-render streams the interface as a flat tree of elements that refer to each other by id. When the guard blocks an element, it removes that element and prunes its id from every parent that referred to it, so the renderer never receives a dangling reference. Blocking a container blocks everything inside it, and the trace records what was lost.

Unverified data never flashes on screen. An element whose source namespace has not been recorded yet is held on the server rather than forwarded, so the browser receives nothing to paint instead of a fare that corrects itself a moment later. The hold expires into a block rather than hanging.

This only arises when the interface streams before or alongside its tool results, which happens in optimistic and multi-agent setups rather than in a plain tool-call loop, and in a plain loop there is simply nothing to hold. Retraction is handled the same way in both: when an element is blocked after its parent has already gone out, the guard emits a `drop` event downstream carrying the id and the reason, and the adapter prunes that id from `children` and from every named slot as it reassembles. The server does not buffer the subtree and it does not rewrite history; the renderer is told to remove something it was told about, which is the one honest option once bytes have left the building.

The demo does not exercise the hold, because it records tool results before it streams, so there is nothing pending by the time elements arrive. The behaviour is covered in core's tests and the demonstration of it is the one phase 2 acceptance criterion still unticked in [docs/build-plan.md](docs/build-plan.md).

The guard is deterministic and makes no network calls. It takes `zod` v4 as a peer dependency to match json-render, and it plugs into any transport as a standard `TransformStream`.

---

## How to try it?

The interesting behaviour only shows up when something goes wrong, so start with the demo. It is a fictional travel search where an agent composes the results page.

```bash
git clone https://github.com/siddharthagrawal/genui-guard && cd genui-guard
pnpm i && pnpm --filter travel dev    # no API key needed
# http://localhost:3000       the user's view
# http://localhost:3000/?dev  with the developer panel open
```

The layout is deliberate. Chat sits on the left, the agent-composed results in the centre, and genui-guard lives in a separate dark developer panel on the right that opens on demand. The default view is the product, with no sign that a guard exists, because that is what a user of such a travel app would see. Open the developer panel on right and you get a switch for each of eight failures, and each one reports the decision it produced in the guard's own words, so you can read cause and effect from one switch rather than diffing two pages.

There are three run modes. `replay` uses recorded output and spends no tokens. `chaos` rewrites that output with the failures you select. `live` calls a real model, needs an `ANTHROPIC_API_KEY`, and injects nothing at all: json-render's generated prompt instructs the model to "include realistic sample data in state", so a model following its renderer's own instructions invents fares without being asked to. Without a key, live mode is visibly disabled and the other two are unaffected.

genui-guard works with the catalog you already have, with `@json-render/core` supported first, and with any transport that streams the interface to the browser, whether SSE, the AI SDK, AG-UI, or WebSockets.

---

## How to add it to your own agent?

Install it alongside your existing setup.

Publication was gated on the eval suites, so that the false block rate above is a measured number rather than a promise. All three packages are on npm at `0.1.0`.

```bash
pnpm add @genui-guard/core zod                 # the guard
pnpm add @genui-guard/json-render              # the adapter, if you use json-render
pnpm add -D @genui-guard/cli                   # genui-guard check and test
```

You reuse your json-render catalog and tell genui-guard only the extra things it needs to know, which are the properties that are bound and the policies to enforce.

This is [examples/quickstart.ts](examples/quickstart.ts), pasted rather than retyped. It is compiled against the packages' source on every run of `pnpm typecheck`, so a copy-paste that fails to build is a failing test rather than something you find out about.

```ts
import { createGuard, policies as p, type GuardEvent } from "@genui-guard/core";
import { fromJsonRender } from "@genui-guard/json-render";
import { catalog } from "./catalog"; // your existing json-render catalog

declare const turnId: string;
declare const session: { role: string };
declare const budget: number;
declare const fares: { fareId: string; price: number; seatsLeft: number }[];
declare const specStream: ReadableStream<GuardEvent>;

export const guard = createGuard({
  registry: fromJsonRender(catalog, {
    FlightCard: {
      entity: "fares", // backed by searchFlights results
      key: "fareId", // identifies one record, and ties every bound prop to the same one
      bound: ["airline", "price", "stops"], // must reference verified fare data
    },
  }),
  policies: [
    p.requireBinding(), // on by default
    p.dropUnsourcedClaims({
      topics: ["free cancellation", "refundable", "bag included"],
      supportedBy: ["fareRules"], // nested objects that can support a claim
    }),
    p.excludeWhere("fares", (fare) => fare.seatsLeft === 0),
    p.annotateWhere(
      "fares",
      (fare, ctx) => Number(fare.price) > Number(ctx.budget ?? Infinity),
      "Over your stated budget",
    ),
    p.requireRole(["RefundOverride"], "support_agent"),
    p.confirmActions(["book"]),
    p.safeUrls({ imageHosts: ["img.travel-demo.test"] }),
    p.restrictInputs({ allow: ["PaymentForm"] }),
  ],
});

// Source of truth for this turn. `entity` reserves the state namespace the
// guard owns, and `key` is required for an array so records are addressed by
// identity rather than by position.
guard.recordToolResult({
  turnId,
  toolName: "searchFlights",
  entity: "fares",
  key: "fareId",
  data: fares,
});

// Any transport, whether SSE, the AI SDK, AG-UI or WebSockets.
export const safe = specStream.pipeThrough(guard.stream({ turnId, session, budget }));
```

A claim topic is matched against the field names on the bound entity, with both sides reduced to crudely singularised word tokens, which is how `"bag included"` finds `bagsIncluded`. Support means the field affirms the claim rather than merely existing, so `2` bags counts and `0` does not. `supportedBy` names nested objects to look inside as well as the record's own fields, because fare rules usually live one level down.

Removing genui-guard means deleting that single `pipeThrough` line. Your json-render setup is otherwise unchanged.

Config mistakes surface at setup rather than at the first element of the first turn. Declaring a bound property with no entity, or a typo in `bound` that does not match the catalog's schema, throws from `createGuard` with a code and a fix hint.

---

## Is this a security boundary?

No. The role and input checks are defence in depth. They stop a confused model from rendering a staff only control or a stray password field. They do nothing to stop a determined client from calling your API directly, so your backend still has to enforce every permission independently. genui-guard reduces the blast radius of a confused model. It does nothing to reduce the blast radius of a hostile user, and treating it as authorisation would be a mistake.

---

## What do the evals measure?

I run two suites, because the two numbers answer different questions. Detection runs on held out cases, including paraphrased claims written without reference to the implementation, and it measures what the deterministic rules miss. False blocks run on legitimate components that must pass untouched, and this is the primary quality measure, because a guardrail that removes correct content gets switched off, and once it is off its detection rate no longer matters.

One number is deliberately absent. I do not report detection against failures injected with the same vocabulary the checker matches on, because that figure is circular and always close to perfect.

Both suites run from this repository, deterministically, with no network and no API key.

```bash
pnpm --filter @genui-guard/evals check   # validates the config and the registry
pnpm --filter @genui-guard/evals test    # runs both suites, in about a fifth of a second
```

Measured on 17 October 2026, over 51 legitimate components and 76 held-out failures. The full run is in [evals/reports/latest.md](evals/reports/latest.md), and the cases are in [evals/cases](evals/cases).

| Measure | Rate | |
|---|---|---|
| **False blocks**, legitimate components withheld | **2.0%**, 1 of 51 | the headline |
| False modifications, something true taken out of one | 0.0%, 0 of 51 | |
| Detection, held-out failures caught | 51.3%, 39 of 76 | with the gap below |

The single false block is the one I would have predicted and could not have priced without measuring: a legitimate `repeat` over the loaded fares, with properties reading json-render's `$item`. The guard blocks an expression in a bound property, because a template can interpolate a model-written fragment, and `$item` is indistinguishable to it from one. The suite carries five such cases and this is the only one that fires, so iteration over verified data is the cost of that rule, and softening it is now a decision with a number attached rather than a matter of taste.

Detection is where the honest part lives.

| Family | Caught | |
|---|---|---|
| Broken bindings: a typed price, a template, a dangling reference, two records in one card | 11 of 12 | |
| Model state overwriting the host's, which a correct binding then resolves against | 4 of 5 | |
| Contract: an unknown component, a property of the wrong type, an invented property | 3 of 3 | |
| Unavailable records reaching the results | 5 of 5 | |
| Unsafe URLs, credential fields, an unmasked loyalty number | 6 of 6 | |
| A staff control in a customer session | 2 of 2 | |
| A mutating action with no confirmation | 3 of 3 | |
| Missing alternative text and labels | 2 of 3 | |
| Claims in the words the configured topics use | 3 of 5 | |
| **Claims paraphrased**, which is how a model actually writes them | **0 of 18** | |
| **Invented urgency**: two seats left, against nine | **0 of 4** | |
| **Comparisons**: "lowest fare today", when it is not | **0 of 4** | |
| **Claims the source has no field for at all**: breakfast, a shuttle, wifi | **0 of 6** | |

Nothing in the last four rows was caught, and that is the shape of the limitation rather than a bug to fix with better keywords. `dropUnsourcedClaims` matches configured topics against the field names on the source record, so "Refundable" on a non-refundable fare is caught and "Cancel any time for a full refund" on the same fare is not. What it buys for that missed recall is precision: across 51 legitimate components it removed nothing true, which is why it is safe to leave switched on while the recall problem gets solved properly. A semantic check is the first item on [the roadmap](ROADMAP.md).

The reason a semantic check is next rather than now is latency and determinism, and the shape it has to take follows from where each check can afford to sit. Everything today is tier one: structural, provenance, role, action and URL checks, deterministic and inline, adding no measurable time before first paint. A semantic check is tier two, and cannot go inline without putting a model call inside the stream. So it holds the free-text property while the card's shell renders, or it runs behind the stream and emits the same `drop` event the guard already uses when an element has to be withdrawn after the fact. The mechanism for revoking something already sent exists; what is missing is the judgement to put behind it.

The two numbers come from different rules and it is worth not blurring them, because they fail in opposite directions. The false block is `requireBinding` refusing an expression in a bound property, which trades iteration ergonomics for provenance and costs 1 case in 51. The paraphrase gap is `dropUnsourcedClaims` matching lexically, which trades recall for precision and costs 18 cases in 18. One rule is too strict and the other is not strict enough, and no single adjustment improves both.

Two further limits came out of the run and are worth stating because neither is visible from the code. Verification only covers the properties a host declares bound, so the demo, which binds airline, price and stops, does not catch a card showing one flight's price beside another flight's departure time. And accessibility rules only fire where the host asked for them, so the demo's unlabelled text input passes. Both are configuration rather than defects, and both are the kind of gap `genui-guard check` is for.

Three of the numbers above moved because the suites found defects in code that 206 passing tests had not. Property validation against the host's schema was never wired in, a state key written as a JSON Pointer skipped the reserved-namespace screen completely, and the alternative-text repair could not read a bound name, so it withheld cards instead of repairing them.

To keep the deterministic rules from being overfitted to the cases that score them, [docs/eval-protocol.md](docs/eval-protocol.md) freezes the held-out suite before any rule is touched, and the suites run the demo's shipped configuration rather than a second copy that could be tuned quietly. It also logs the only two case corrections made afterwards, both of them fixture errors rather than results: one case used a role name the application does not have, and one asserted something a second case contradicted.

---

## How was this built?

In three passes, and the order turned out to matter more than I expected.

The guard came first: provenance, the policy set, the five outcomes, the trace. Then the travel demo, built on the real json-render renderer rather than a mock, which is where two of the project's most valuable bugs surfaced. A legitimate "Bag included" badge was being stripped because the claim topic is prose and the field is `bagsIncluded`, and a fabricated badge inside an array was receiving no checking at all because the policy only inspected strings. Both had survived a fully passing test suite. Putting real fares through a real renderer found in an afternoon what unit tests had not found in a week.

The evals came last and did the same thing one level up. Writing the held-out cases before reading the claim policy's implementation surfaced three more defects in shipped code: property validation against the host's schema was never wired in, a state key written as a JSON Pointer bypassed the reserved-namespace screen entirely, and the alternative-text repair could not read a bound value, so it withheld cards instead of repairing them. The pattern across all five is the same, and it is the one thing I would take to the next project: the code checked one representation of a thing that arrives in several.

`v0.1.0` is the published release, and the full working spec with every acceptance criterion is in [docs/build-plan.md](docs/build-plan.md), including the one still unmet.

---

## Where is the thinking written down?

[docs/prd.md](docs/prd.md) covers the problem, the users, what success looks like, and what could make this fail. [docs/decisions.md](docs/decisions.md) holds the developer-experience bar every interface is held to and then the decision log behind it, including why I enforce bindings rather than compare values, why blocking comes before repair, and why there is no dev console. [docs/concepts.md](docs/concepts.md) explains the specification tree, holding until verified, and the limits of provenance. [docs/competitive-scan.md](docs/competitive-scan.md) is the survey of the surrounding ecosystem, including the adoption numbers behind the decision to build on json-render. [docs/build-plan.md](docs/build-plan.md) is the working spec for the three phases, with the acceptance criteria each one has to pass, and [ROADMAP.md](ROADMAP.md) covers what comes after the first version.

The first version deliberately leaves out, and the decision log explains, a component catalog, renderer, or streaming parser of its own, a trace console, substituting replacement content for blocked items, probabilistic phishing detection, a hosted service, a model used as a judge, and policy editing through a user interface.

---

## How do I get in touch?

Open an [issue](https://github.com/siddharthagrawal/genui-guard/issues) for anything about the code, the design, or a claim you think is wrong. The last of those is the most welcome. For anything else, my links are on my [GitHub profile](https://github.com/siddharthagrawal).

---

*All catalog data, brands, and product claims used in this repository are fictional. MIT license.*
