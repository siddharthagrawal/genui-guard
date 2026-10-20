# genui-guard, product requirements

This is a working document rather than a finished one. Last updated 9 October 2026, before any code was written, and it will change as the build teaches me things.

---

## What problem does this solve?

Agents have started rendering interfaces instead of only writing text, and that changes what a mistake costs. A wrong statement in a chat bubble reads like an opinion the reader is free to discount. The same statement rendered as a card, with a price in bold and a button underneath, reads like a record pulled from a system of record. People act on the second one.

The mechanism matters more than the framing, because it explains why better prompting does not fix this. Even in an application where every number genuinely comes from an API, the model sits between the API and the screen. It reads the tool result and then writes the component's properties itself. That gives it room to move a price from one flight onto another, reuse a result from an earlier search, round a figure, or attach a refund badge the fare rules do not support. None of these require the model to invent data from nothing. They only require it to be careless while assembling, which is the failure that actually shows up.

The consequences are established rather than hypothetical. In Moffatt v. Air Canada in 2024, a tribunal held the airline responsible for a bereavement fare discount its chatbot had described and that did not exist. The company owned what its assistant said. Rendered interfaces inherit that exposure and probably increase it, because a component carries more implied authority than a sentence does.

I want to be precise about what this is not. genui-guard does not defend against a hostile user trying to reach something they should not have. It defends against a confused model acting in good faith, which is both more common and more tractable.

---

## Why doesn't the existing stack already handle this?

Component catalog frameworks have solved the shape problem well. json-render, assistant-ui and A2UI all give you an allowlist of components the model may use, typed property schemas, structural validation, and progressive rendering as the model streams. json-render goes further and ships structural repair alongside a devtools panel. Every one of those capabilities answers the question of whether the model produced a well formed card. None of them answers whether the price inside it is the real price, because from the framework's point of view a string is a string and a number is a number.

It is worth scoping which applications are exposed, because the risk is not universal and overstating it would be easy to catch out.

Where the model emits a UI specification, as in json-render, A2UI and the MCP application model, the properties and some of the state are model-authored, and the exposure is direct. json-render's generated prompt even instructs the model to include realistic sample data with names and prices, which is the clearest possible statement that invented values are the expected behaviour rather than an edge case.

Where the model only selects a tool and supplies its typed input, which is how the Vercel AI SDK's `streamUI` works, the application's own code fetches the data and passes it to the component. The data never passes through the model, so provenance is already handled. Those teams still have use for the policy layer, covering claims, roles, actions, URLs and inputs, and they do not need the binding mechanism.

The first group is the primary user.

The two adjacent categories turn out not to overlap with this. Text guardrail toolkits such as Guardrails AI and NeMo Guardrails check strings and structured text, with no concept of a component or an action about to charge a card, and they are Python libraries in any case. Sandboxing isolates arbitrary code the model wrote, which is the right answer when the model is authoring code and the wrong one when it is composing from a catalog you control. [docs/competitive-scan.md](competitive-scan.md) works through both, with the adoption figures and the dates they were collected.

So the gap is content provenance and permission, and today that work falls to whoever writes each individual component. In practice it gets done inconsistently, or it gets done once in the component somebody reviewed carefully and never again.

---

## Who is this for?

The primary user is a product engineer adding generative UI to an application that already exists, increasingly with a coding agent writing much of the component code for them. They have already chosen a catalog and a renderer, and they are not looking for another framework. Their job to be done is to ship generative UI without leaving a plausible path to rendering something false, and their constraint is that they have to do it without restructuring the application they already have.

The secondary user is whoever owns trust or platform policy for that team. They care about different things, mainly whether the policy is legible to someone who did not write it, whether decisions can be audited after the fact, and whether the numbers in the eval report would survive someone checking them.

This is not for teams whose models author arbitrary UI code. That is a sandboxing problem, and genui-guard would be the wrong tool.

---

## What does the product actually do?

genui-guard runs on the server, between the model and the transport that carries UI to the browser. It treats the tool results from the current turn as the source of truth for that turn.

The central mechanism is that for properties the host marks as bound, the model may only emit a reference into data the host already loaded. It may point at a fare's price. It may not write a number. That makes a literal value in a bound property a failure by construction rather than a disagreement somebody has to settle.

A reference is only as good as the data behind it, and in these frameworks the model streams state as well as elements, so it can supply some of what its own references resolve against. The guard therefore owns the paths that back bound properties. Those paths are filled only from the turn's tool results, model writes into them are rejected, and bound references resolve against the host data rather than against whatever the renderer eventually merges. Everything outside those paths stays under the model's control, because interactive state is how a generated interface works and taking it over would break the host's own features.

That framing beats comparing values, because comparison leaves you with a decision where every answer is bad. If the model wrote 189 and the API says 412, rewriting the card to 412 makes the component disagree with the model's own surrounding prose, which genui-guard never sees and cannot correct. Hiding the card leaves the user confused about why. Showing it is the original problem. Requiring a reference removes the decision, because there is nothing for the model to get wrong.

On top of provenance sit the checks that bindings cannot express, and these cover most of the remaining risk in practice. Free text claims like free cancellation have to be supported by the entity's own rules. Items that are unavailable should not appear in results. Controls meant for staff should not render for customers. Actions that move money or change a booking should need a confirmation rather than firing on one click. Links and image sources should use approved schemes and hosts. Credential and payment inputs should only appear inside components the host approved. Images need alt text.

Each element ends up allowed, annotated, repaired, gated, or blocked, and every outcome is recorded with a reason a developer can read. Two of those five change the element, two change the tree or an action, and annotation changes neither: it is reported beside the result for the host to place, because the guard does not author interface copy of its own.

---

## Why is this a layer rather than a feature of the renderer?

This is the question that decides whether the project is worth building, so it deserves a direct answer. json-render already ships structural validation, automatic structural repair, and a devtools event store, which shows that the renderer's maintainers are willing to own correctness tooling. If provenance is valuable, why would they not simply add it?

The answer is that the two sit on different sides of a natural boundary. A renderer is horizontal and generic, so it can own the things every application wants identically, and structural validity is exactly that. Trust policy is vertical, specific to one tenant, and often the output of a legal or security review. No renderer can reasonably own which image hosts your security team approved, which controls your support tier is allowed to see, or which claim topics your counsel flagged after reading a tribunal ruling. The source of truth is on the host's side too, in its tool results, where the renderer has no visibility.

So the boundary I am betting on is that the renderer owns shape and the host owns truth, and genui-guard is where the host gets to say what truth means for its domain.

The honest risk is that this bet is wrong, and there is already evidence pointing both ways. json-render ships an experimental composition mode where the application pre-builds data-bound component instances and the model only selects, orders, and nests them, with the documentation stating plainly that the model cannot invent missing prose or data, and recommending that candidate properties be bound to host state. That is independent confirmation that the premise is real, since the framework's own authors reached the same conclusion from the other direction. It is also the risk arriving early.

What survives the overlap is the difference between constraining generation and verifying output. That mode works by restricting what the model can choose from, which means adopting their composer and building candidates for each request. genui-guard checks what a model actually produced, from any agent, deterministically, and adds the roles, actions, URL rules, input rules, and measurement that sit outside provenance entirely. The two compose rather than compete. If provenance turns out to be universal rather than per tenant, the renderer absorbs it, and what remains is policy and measurement, which is a smaller and less interesting product. I would rather find that out early, which is part of why the eval work comes before the adapter work.

---

## What does success look like?

The developer facing targets are the ones that can be influenced directly. Someone should be able to see the thing work before they commit to it, which means a clone and a single command gets them a running demonstration with no API key. Someone who decides to adopt it should reach a first guarded component in a few minutes. Removing it should be a one line change.

The metric that actually decides whether this survives is the false block rate on legitimate UI. A guardrail that blocks correct components gets switched off within a week, and after that its detection rate is irrelevant. I treat false blocks as the primary quality measure and detection as the secondary one, which is the reverse of how these systems are usually marketed.

Detection still matters, and it has to be measured on cases the rules were not written against, including paraphrased claims nobody had in mind while implementing the keyword checks. A detection number measured against failures I injected myself, using the same vocabulary the checker matches on, is circular and would say nothing.

---

## What am I deliberately not doing?

Everything in this section is a scope decision about the first version rather than a permanent position. The things I do not intend to build at all are in [ROADMAP.md](../ROADMAP.md), which separates the two.

I am not building a component catalog, a renderer, or a streaming parser, because those exist and are better than mine would be. I am not building a trace console, since json-render's devtools already cover that surface and duplicating it would be effort spent on the least differentiated part of the system.

genui-guard does not substitute replacement content when it blocks something. Picking a different hotel to show would make the guard an author of UI rather than a checker of it, and it would force it to invent a ranking there is no basis for. Blocking with a plain summary, and letting the host decide what to do next, keeps the responsibility in the right place.

A model used as a judge is deferred rather than rejected. It would catch the paraphrased claims keyword rules miss, and it is not defensible before the deterministic version has measured results, so it sits first on the roadmap.

## What could make this fail?

Deterministic rules will miss paraphrases, because someone who writes that you can get your money back whenever you like has made a refund claim without using any of the words the checker looks for. That is not fixable in the first version, so I measure it and publish the gap.

There is a blind spot that cannot be closed within this design at all, and it is the one I would want a reader to understand before relying on any of this. Verification confirms that a card describes the fare the model said it was showing, and not that this was the right fare to show. The guarantee is narrower than it first sounds. [docs/concepts.md](concepts.md) works through what that does and does not cover, including the one transposition case the guard does catch.

The project also depends on a renderer that has not reached a stable major version, and on hosts being willing to restructure enough that the model can reference loaded data rather than writing values. The second of those is the real adoption risk, and it is why value comparison has to remain available as a migration path even though I consider it the weaker mechanism.
