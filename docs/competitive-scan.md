# Competitive scan

This analysis was done on 9 October 2026. Adoption figures were pulled from the npm registry and the GitHub API on that date, so they will drift. The raw numbers are at the end of this document and the reasoning is above it. With the rate at which things are moving in this space, i won't be surprised if new solutions emerge from existing players.

---

## What was I trying to find out?

Three questions, in order of how much they could change the plan. Whether anyone is already doing content verification for generated interfaces, because if so this project is redundant. Whether the catalog frameworks I intend to build on are adopted enough to be worth building on. And whether the boundaries drawn between genui-guard and adjacent tools hold up when examined.

---

## What do the catalog frameworks already solve?

It was rather more than the early draft of my plan assumed, which was the most useful finding here.

json-render, from Vercel Labs, defines a catalog of components with typed property schemas, generates the prompt that constrains the model to that catalog, validates what comes back, and renders it progressively as it streams. It also does several things I had intended to build earlier. It ships structural validation with issue codes, automatic structural repair that distinguishes fixes which change what renders from fixes which only relocate fields, and a devtools package with an event store, a panel, an element picker and stream taps. It resolves property expressions, which is the exact capability the verification step needs.

Discovering that reduced my scope twice. Contract checking became a call into their validator rather than an implementation of mine, and the trace console came off the plan entirely, because competing with first party devtools would have been the least differentiated work in the project.

Reading the prompt json-render generates for the model was the most valuable half hour of this analysis, and it produced the best single piece of evidence for the premise. The prompt instructs the model to emit state patches interleaved with the elements that read them, and it says to "include realistic sample data in state," offering "for product lists: 3-5 items with names, prices, descriptions" as the example. Invented data is not an edge case in this pattern, it is the documented default behaviour. The same reading corrected a design error of mine, since the model authoring state means a property reference is not trustworthy on its own.

json-render also ships an experimental composition mode, built on Jev - a decision model, which turned out to be the closest thing to an exisitng solution I found. The application pre-builds configured, data-bound component instances and the model only selects, orders and nests them. The documentation is explicit about why, saying the model would otherwise "fabricate copy, numbers, prop values, and action wiring," that "Jev cannot invent missing prose or data," and that candidate properties should be bound to host state. That is independent convergence on the central idea here, arrived at from the generation side rather than the verification side, and it is worth treating as validation and as warning in equal measure.

assistant-ui approaches the same space from the chat interface side and is the most mature of the group, having been in development since late 2023. A2UI is a protocol rather than a single implementation, with renderers for several frameworks and a separate CopilotKit renderer.

AG-UI is worth separating out because it solves a different part of the problem. It is a transport protocol for agent to user interaction rather than a component catalog, and it is the only project in this survey that has reached a stable major version. If I add a second integration, that stability makes it a safer target than the catalog frameworks.

What none of them do is verify content. Their reliability story is conformance to a schema, which answers whether the model produced a well formed card and not whether the number inside it is real. json-render's documentation is straightforward about this, framing the catalog as the allowlist and the property schemas as the constraint, with nothing claimed about truthfulness. That is the gap genui-guard is built into, and it is a gap by design rather than by oversight, for reasons I think are sound and discuss in the product document.

---

## What do the text guardrail toolkits cover?

Guardrails AI and NeMo Guardrails are the two reference points, both established since 2023 and both with a little over seven thousand stars. They validate and constrain model output, check structured text against schemas, and in NeMo's case model conversational flows with programmable rails.

They sit at a genuinely different layer, and there are two reasons the separation is clean rather than convenient. The first is conceptual, which is that they operate on text and structured data with no notion of a component, a property that is supposed to be sourced, or an action about to charge a card. The second is more practical than I expected before checking. Both are Python libraries, so they are not in the runtime where a JavaScript application renders its components, and a team wanting inline checks on a UI stream in that runtime cannot reach for either of them without crossing a process boundary.

I do not consider them competitors and a team could sensibly run both. They would check the model's prose and genui-guard would check the interface it rendered.

---

## Where does sandboxing fit?

The Artifacts style iframe and the MCP application model both isolate code the model authored, on the assumption that the code cannot be trusted and the boundary has to be enforced by the runtime.

That is the right answer to a different question. Sandboxing protects you when the model is writing arbitrary code, and it does nothing for the case this project cares about, where the component is one you wrote and reviewed and the data inside it is wrong. An isolated iframe will faithfully render a false price. The two approaches are complementary, and the dividing line is whether the model is authoring the interface or composing it from pieces you control.

---

## Is anyone doing what genui-guard does?

I could not find anything. I searched the npm registry for guardrails aimed at generative interfaces, and the results were text-oriented toolkits, assistant frameworks, and vendor SDKs. No package verifies the content of rendered components against tool results.

I expect the main risk to be a catalog framework extending its validation into provenance, and json-render's Jev composition mode is the first step toward exactly that. It restricts the model to pre-bound candidates, which attacks the same failure from the generation side.

The distinction that matters is between constraining generation and verifying output. Constraining generation means the application pre-builds candidates for each request and adopts the composer and evaluator that come with them. It only covers what the model was offered. Verifying output means checking what the model actually produced, from any agent, with no change to how it is prompted, and it reaches the roles, actions, URL rules, input rules, and measurement that have nothing to do with provenance. A team could reasonably use both.

This is not conclusive though. The work could be happening inside companies shipping at scale, or sitting further along a roadmap than public documentation shows. I cover the strategic version in the product document. The short answer is that I am betting the renderer owns shape and the host owns truth, because trust policy is specific to a tenant and often the output of a legal/security/design review, in a way that structural validity never is.

---

## What did this change?

My scope shrank, because contract checking, expression resolution, structural repair, and trace viewing all turned out to come from the host framework, and rebuilding them would have crowded out the verification work that is actually propsoed in this project.

The integration target settled on json-render, which is adopted enough to justify the dependency and is stabilising, with AG-UI as the second step because it is the only stable option and covers transport rather than the catalog.

The exposure got scoped properly. The risk applies where the model emits a UI specification, not where it only picks a tool and the application fills the properties, which is how the Vercel AI SDK works and is the more common arrangement by download volume. Those teams need the policy layer rather than the binding mechanism, and saying so makes the claim checkable.

---

## What were the numbers, exactly?

Collected 9 October 2026 from the npm registry and the GitHub API.

| Project | Stars | Weekly downloads | First release | Current version |
|---|---|---|---|---|
| json-render | 18,588 | 2.05M (`@json-render/core`) | January 2026 | 0.21.0, Apache 2.0 |
| AG-UI | 16,415 | 2.42M (`@ag-ui/core`) | May 2025 | 1.0.2 |
| A2UI | 16,650 | 112K (`@a2ui/react`) | September 2025 | 0.13.0 |
| assistant-ui | 12,464 | 1.92M (`@assistant-ui/react`) | November 2023 | 0.15.26 |
| Guardrails AI | 7,502 | not compared, Python | January 2023 | 0.11.0 |
| NeMo Guardrails | 7,270 | not compared, Python | April 2023 | 0.24.1 |

For reference, the Vercel AI SDK core package sits at roughly 29 million weekly downloads, which is the scale of the layer all of these projects sit on top of.
