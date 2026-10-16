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
  "fareId": "HA-2041", "airline": "Harbor Air", "price": 412, "stops": 1, "seatsLeft": 4
} } }
```

What happens next depends on which pattern your stack uses, and it is worth being precise because the risk is not universal.

In the pattern genui-guard targets, the model emits a UI specification. It writes out a new `FlightCard` and fills in each property itself, putting the airline in one field and the price in another. Nothing forces what it types to match what it read. It can write `189` into the price field instead of `412`, label a one stop fare as nonstop, or add a free cancellation badge the fare never offered. Each of those is still a structurally valid `FlightCard`, so the catalog raises no objection. This is not a hypothetical. json-render's own generated prompt instructs the model to "include realistic sample data in state," and offers "for product lists: 3-5 items with names, prices, descriptions" as the example.

In the other common pattern, used by the Vercel AI SDK's `streamUI`, the model only chooses a tool and supplies its typed input, and your own code fetches the data and passes it to the component. The data never passes through the model, so provenance is already solved there and the policies further down are what still apply.

The common defence in the first pattern is comparison. You let the model write what it wants, then check each value against the source and repair the mismatches. Here, I am proposing something stricter. For any property you mark as bound, the model may not write a value at all. It may only emit a reference that resolves into data your server loaded from a real tool result.

```jsonc
// FlightCard, as the model emits it
{
  "type": "FlightCard",
  "props": {
    "airline": { "$state": "fares.HA-2041.airline" },  // resolves into host data (allowed)
    "price":   { "$state": "fares.HA-2041.price" },    // resolves into host data (allowed)
    "stops":   0,                                      // model wrote a value into a bound prop (blocked)
    "badges":  ["Refundable", "Free cancellation"]      // unsourced claim removed, the rest kept
  }
}
```

`$state` is json-render's syntax for a property whose value is looked up from application state at render time rather than written into the component. Other catalogs spell it differently, and the general idea is a reference instead of a literal.

When the model writes a literal number into a bound property, that is a failure by construction. There is nothing to compare, because the model was never allowed to author the number.

A reference on its own is not enough, though, and this is the part that is easy to get wrong. In json-render, the model streams state alongside the elements that read it, so it can emit a reference to `fares.HA-2041.price` and then emit a state patch that puts `189` at exactly that path. The reference would resolve perfectly and still be a fabrication. What makes a bound property trustworthy is therefore not the syntax but the namespace. The guard owns the paths that back bound properties, populates them only from `recordToolResult`, rejects any model-authored state patch that writes into them, and resolves bound references against host state rather than against the merged result.

With that in place a bound value can never be invented. It is either a reference that resolves into data your server loaded, or it is absent. Whether it resolves against the *right* record is a separate question, and the section on what genui-guard does not catch is honest about it.

Comparison forces a bad choice whenever the model's number is wrong. If you rewrite the card to the correct price, it contradicts the model's own surrounding prose, which genui-guard never sees. If you hide the card, the user gets no explanation. If you show it, you are back to the original problem. Requiring a reference removes the choice entirely.

Value comparison stays available for teams whose models already write literal properties, and [docs/concepts.md](docs/concepts.md) explains that trade-off.

---

## What does genui-guard catch?

Every decision below is recorded in a trace.

| Failure | Example | Outcome |
|---|---|---|
| Model-authored data | Card hardcodes `price: 189`, the fare API says `412` | Block, repair available |
| Model-authored source | A state patch writes `189` into a path backing a bound property | Block |
| Wrong label | "Nonstop" shown on a flight with a layover | Block, repair available |
| Unsourced claim | "Free cancellation" that no fare rule supports | Repair, that claim removed, supported ones kept |
| Unavailable item | A sold out hotel in the results | Block |
| Unmet preference | A trip over the user's stated budget | Annotate |
| Unpermitted component | A staff only refund override shown to a customer | Block |
| Unconfirmed action | `book` fires on a single click | Gate behind confirmation |
| Unsafe URL | A `javascript:` scheme, or an unapproved image host | Repair, URL removed |
| Spoofed input | A password or card field outside an approved component | Block |
| Inaccessible markup | A hotel photo with no alt text | Repair, otherwise block |

---

## What does it not catch?

The guard verifies that a component's properties are faithful to the entity the model said it was showing. It cannot verify that this was the right entity. If the model binds every property correctly to a fare the user never asked about, every check passes, the trace is clean, and the card is still wrong. Choosing the right entity remains the model's job, and the eval suites measure that gap rather than hiding it.

Claim checks look for particular words, so a refund promise phrased as being able to get your money back whenever you like carries no vocabulary the rules recognise. The evals publish how often that happens rather than papering over it, and a semantic check is the first item on the roadmap.

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

Unverified data never flashes on screen. While a spec is still streaming, the guard holds bound properties until they are verified, so the user sees a placeholder rather than a brief flash of an unverified fare. If the tool result behind an element never arrives, the hold expires and the guard blocks the element.

The guard is deterministic and makes no network calls. It takes `zod` v4 as a peer dependency to match json-render, and it plugs into any transport as a standard `TransformStream`.

---

## How to try it?

The interesting behaviour only shows up when something goes wrong, so start with the demo :) It is a fictional travel search where an agent composes the results page.

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

```bash
pnpm add genui-guard zod
```

You reuse your json-render catalog and tell genui-guard only the extra things it needs to know, which are the properties that are bound and the policies to enforce.

```ts
import { createGuard, policies as p } from "genui-guard";
import { fromJsonRender } from "genui-guard/json-render";
import { catalog } from "./catalog";   // your existing json-render catalog

export const guard = createGuard({
  registry: fromJsonRender(catalog, {
    FlightCard: {
      entity: "fare",                        // backed by searchFlights results
      key: "fareId",
      bound: ["airline", "price", "stops"],  // must reference verified fare data
    },
  }),
  policies: [
    p.requireBinding(),                       // on by default
    p.dropUnsourcedClaims({ topics: ["free cancellation", "refundable", "bag included"] }),
    p.excludeWhere("fare", (f) => f.seatsLeft === 0),
    p.annotateWhere("fare", (f, ctx) => f.price > ctx.budget, "Over your stated budget"),
    p.requireRole(["RefundOverride"], "support_agent"),
    p.confirmActions(["book"]),
    p.safeUrls({ imageHosts: ["img.travel-demo.test"] }),
    p.restrictInputs({ allow: ["PaymentForm"] }),
  ],
});

// source of truth for this turn
guard.recordToolResult({ turnId, toolName: "searchFlights", data: fares });

// any transport, whether SSE, the AI SDK, AG-UI or WebSockets
const safe = specStream.pipeThrough(guard.stream({ turnId, session, budget }));
```

Removing genui-guard means deleting that single `pipeThrough` line. Your json-render setup is otherwise unchanged.

Config mistakes surface at setup rather than at the first element of the first turn. Declaring a bound property with no entity, or a typo in `bound` that does not match the catalog's schema, throws from `createGuard` with a code and a fix hint.

---

## Is this a security boundary?

No. The role and input checks are defence in depth. They stop a confused model from rendering a staff only control or a stray password field. They do nothing to stop a determined client from calling your API directly, so your backend still has to enforce every permission independently. genui-guard reduces the blast radius of a confused model. It does nothing to reduce the blast radius of a hostile user, and treating it as authorisation would be a mistake.

---

## What do the evals measure?

I run two suites, because the two numbers answer different questions. Detection runs on held out cases, including paraphrased claims written without reference to the implementation, and it measures what the deterministic rules miss. False blocks run on legitimate components that must pass untouched, and this is the primary quality measure, because a guardrail that removes correct content gets switched off, and once it is off its detection rate no longer matters.

One number is deliberately absent. I do not report detection against failures injected with the same vocabulary the checker matches on, because that figure is circular and always close to perfect.

**Not built yet.** The eval suites, the `genui-guard` CLI and the GitHub Action are the remaining phase of work, and this section describes the design rather than something you can run today. No numbers are published here, and none will be estimated. When the suites exist, the results will come from a run reproducible from this repo.

What does exist is the measurement the demo already produces. Every decision, including every allow, is traced with a plain-language reason, and the demo's developer panel reports interventions separately from the elements the guard examined and allowed.

---

## How was this built?

Each stage is a git tag, so you can check one out to see the project at that point.

| Chapter | Tag | What it shows |
|---|---|---|
| The guard | `ch1-core` | A model authored fare blocked, an unsourced claim stripped, a sold out hotel removed from the tree, and a staff only button hidden, all in unit tests |
| Travel search | `ch2-travel` | Agent composed flights and hotels rendered with json-render, chaos mode, guardrails on and off |
| Proof | `ch3-evals` | Not built yet. Detection and false block numbers, and a pull request comment with the change against `main` |

---

## Where is the thinking written down?

[docs/prd.md](docs/prd.md) covers the problem, the users, what success looks like, and what could make this fail. [docs/decisions.md](docs/decisions.md) holds the developer-experience bar every interface is held to and then the decision log behind it, including why I enforce bindings rather than compare values, why blocking comes before repair, and why there is no dev console. [docs/concepts.md](docs/concepts.md) explains the specification tree, holding until verified, and the limits of provenance. [docs/competitive-scan.md](docs/competitive-scan.md) is the survey of the surrounding ecosystem, including the adoption numbers behind the decision to build on json-render. [docs/build-plan.md](docs/build-plan.md) is the working spec for the three phases, with the acceptance criteria each one has to pass, and [ROADMAP.md](ROADMAP.md) covers what comes after the first version.

The first version deliberately leaves out, and the decision log explains, a component catalog, renderer, or streaming parser of its own, a trace console, substituting replacement content for blocked items, probabilistic phishing detection, a hosted service, a model used as a judge, and policy editing through a user interface.

---

*All catalog data, brands, and product claims i have used in this repository are fictional :) MIT license.*
