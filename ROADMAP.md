# Roadmap

What the first version covers, what comes after it, and why in that order. Dated 9 October 2026 and expected to change once the evals show where the real weaknesses are.

---

## What is in the first version?

Three pieces of work. The guard itself, which covers binding verification, the policy set, the five outcomes and the trace. A travel search demonstration where an agent composes flight and hotel results and a chaos mode replays recorded output with failures injected, so the difference between the guard being on and off is something you watch rather than something you read about. And the measurement work, which is two eval suites and a continuous integration check that reports both of them on every change.

That is deliberately smaller than the original plan. The reasoning is in the decision log, and the short version is that a coding agent integration, three extra adapters and a trace console were either duplicating tooling the host framework already ships or adding breadth where the project needed depth.

---

## What comes next, and why in this order?

The first item is a semantic check for claims that keyword matching misses. This is top of the list because it addresses the weakness I expect to be largest, and because I will have measured it by then rather than guessed at it. Someone writing that you can get your money back whenever you like has made a refund claim using none of the vocabulary a keyword rule looks for, and the first version will publish how often that happens.

The open question is not whether a model could catch those cases, since it clearly could, but whether the cost is acceptable. A model call in the middle of a stream adds latency I have been careful to keep small, and it makes the same input capable of producing different decisions on different days, which undermines the auditability that is part of the point.

The likely shape is an optional check that runs on free text properties only, outside the hot path where it can, with the deterministic rules still responsible for everything sourced. I would rather ship that late and correct than early and surprising.

The second is the coding agent integration, which is the cut from the original plan I expect to regret most. Most generative UI components are going to be written by coding agents, and an agent that can explain why a component was blocked and can add the right verification rules when it scaffolds a new component closes a loop that documentation alone does not. The reason it is second rather than first is that it depends on traces existing and being good, and once they do it is a small piece of work rather than a phase.

The third is a second catalog integration, which exists to prove the central claim rather than to serve users. The argument that this is a layer rather than a plugin for one renderer is only credible if it runs on something else, and keeping the core free of renderer specific types is what makes that cheap. assistant-ui is the likely target because it is the most mature of the alternatives. AG-UI is a separate and probably earlier step, since it covers transport rather than the catalog and it is the only project in this space at a stable major version.

The fourth is a value comparison path for hosts that cannot restructure. Binding verification requires the application to load tool results into state the renderer can reference, and plenty of applications do not do that today. Comparison is the weaker mechanism for reasons the decision log covers, and it is the difference between those teams getting partial protection now and none at all, so it needs to exist as a documented bridge rather than as the recommended approach.

The fifth is a question rather than a commitment, and it is the one I find most interesting. The check model generalises past truth and permission. Design-system conformance is deterministically checkable in the same way, covering a destructive variant on a non-destructive action, two primary buttons competing in one view, a heading level that breaks the document hierarchy, or a spacing value off the token scale. The outcomes map cleanly onto the five that already exist, and repair is more defensible there than it is for data, because snapping an off-scale value to the nearest token asserts nothing false about the world.

The reasons to be cautious are that a catalog's enum properties already constrain much of this, that generation-side approaches are addressing it by giving the model only pre-approved component instances, and most of all that a trust layer which also lints design tokens becomes a general purpose UI linter, which is a more crowded category and a less useful thing to be. I would want evidence that someone wants it in the same place as the truth checks before building it.

Accessibility is the same shape of question. Static checks on alt text, labels and heading structure are in the first version, and anything needing the rendered DOM is not reachable from the server at all.

The sixth is tracing that connects to the systems teams already run. Emitting decisions as spans alongside the rest of a request's telemetry is how this becomes reviewable during an incident rather than only during development, and it should be an optional import so that nobody pays for it who does not want it.

---

## What am I not planning to do?

These are permanent positions rather than scope cuts. What is merely deferred to a later version is in [docs/prd.md](docs/prd.md), which keeps the two apart.

**A catalog, renderer or streaming parser of my own.** This is the least likely of any of them to change, because the whole argument of the project depends on not doing it.

**Probabilistic phishing or intent detection.** Deciding whether a plausible looking interface is trying to manipulate someone is a genuinely different problem, it is not solvable deterministically, and a confident wrong answer there is worse than no answer.

**Policy editing through a user interface.** Policy belongs in the repository, where it can be reviewed, versioned and tested like anything else that decides what users see. Making it editable elsewhere would quietly remove it from that process.

**An authorisation system.** The role and input checks reduce what a confused model can render, and they are not a security boundary. That is a distinction I would rather keep restating than let erode.

**A hosted service.** This one becomes tempting once there are traces worth centralising, and the reason to be wary is that it would change what the project is. A library running inside your own request path has a trust story that a service receiving your tool results does not.
