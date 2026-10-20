# Design decisions

This document has two parts. The first is the bar I hold every interface, error message and default to, which is the standing version of the reasoning below. The second is the decision log, one entry per choice that would be a one-way door, written close to when it was made. Each entry says what I was choosing between, what I picked, and what I gave up, because the trade-off is usually the part worth remembering.

---

## What bar does this have to meet?

These tenets exist because a trust layer is unusually easy to make unpleasant, and an unpleasant trust layer gets switched off, at which point it protects nothing.

**Someone should be able to see it work before they commit to anything.** Nobody should have to install a dependency, restructure their state, or find an API key in order to understand what this does. The first encounter is a clone and one command, and what they get is a working demonstration they can break on purpose, with the guard toggling on and off so the difference is visible rather than described. This is not only about first impressions. A trust layer makes claims that are hard to evaluate from documentation, because the interesting behaviour only shows up when something goes wrong, and letting someone cause the failure themselves is the only honest way to make the argument.

**Every error has to say how to fix it.** An error that reports what happened has done half the job, so each one carries a code, a description of what went wrong, and a concrete next action, with a test for the presence of the third rather than a habit of remembering it. This matters more here than in most libraries because these errors mostly fire during setup, when someone has described their catalog slightly wrong and has no mental model yet to debug against. Telling them that a sourced property has no way to identify its entity is useless. Telling them which property, on which component, and that it needs an identifying field, is a problem they can solve in a minute.

**Removing it has to be as easy as adding it.** Adoption is one line in the path between the model and the transport, and removal is deleting that line, with nothing else in the application having to change. Teams are reasonably suspicious of anything that sits in the middle of a critical path, and the suspicion is worse when the thing in the middle can hide their content. Making removal trivial is what makes trying it cheap, and a reversible decision gets made far more often than an irreversible one. It also keeps the project honest, because a layer that is easy to remove has to continuously justify being there.

**The product has to tell the truth about what it cannot do.** The limits are documented as prominently as the capabilities. Keyword checks miss paraphrases, verification cannot tell whether the model picked the right entity, and role checks are not authorisation. All three appear in the README rather than in a caveats section nobody reaches. The reasoning is practical rather than principled. The failure I would most regret causing is a team relaxing a real control because this layer appeared to cover it, and the only protection against that is being explicit before they find out the hard way. An overstated guarantee also tends to be discovered by exactly the people whose opinion matters most.

Three more principles belong on this list and are argued at length further down, so they appear here only as statements of intent. Integrate rather than duplicate, because a layer that reimplements its host's features is a competing framework with extra steps. Keep the default safe when the developer configures nothing, while accepting the obligation that safe defaults must not be surprising defaults. And publish only numbers that would survive someone recomputing them from the repository.

---

## Why build on json-render instead of my own catalog?

The alternative was to ship a small catalog and renderer of my own, so that the project had no external dependency and nothing could break underneath it. I rejected that, and it was the easiest decision here.

The thesis of this project is that catalog frameworks solved shape and nobody solved truth. If the repository then contains its own catalog, it has contradicted its own argument in the most visible way available, and a reader notices that long before they read any code. Beyond the self consistency point, the undifferentiated work would have crowded out the differentiated work. Writing a property schema system is a known problem with known answers, and it would have taken a meaningful share of the time available.

The adoption question turned out not to be close. As of today json-render has around 18,600 stars and roughly two million weekly downloads of its core package, having first been published in January 2026. It is Apache licensed, it was committed to two days ago, and its release cadence has slowed from roughly fortnightly minor versions in the spring to gaps of one and three months over the summer, which is what a library approaching a stable version tends to look like.

What I gave up is control. json-render is still on a zero major version, so its interfaces can change without ceremony, and it is a Vercel Labs project rather than a supported Vercel product, which means there is no stability commitment to point at. I am accepting that in exchange for not spending the project's budget on a renderer. The mitigation is that the adapter stays thin and the dependency is pinned, so an upgrade is a contained piece of work rather than a diffuse one.

---

## Why enforce bindings instead of comparing values?

The obvious design is to let the model write properties as it likes, then compare each sourced property against the tool result and fix whatever does not match. I worked the concept through that way on paper and then changed it.

Comparison has a flaw that only becomes visible once you ask what happens after a mismatch is found, which is that every available response is bad: rewriting the card contradicts the model's own surrounding prose, hiding it leaves an unexplained gap, and showing it is the original problem. Requiring a reference removes the question rather than answering it. [docs/concepts.md](concepts.md) walks through that argument with worked numbers, under "Why does pointing beat typing?".

It also happens to be idiomatic in json-render, which already has binding expressions and already ships the resolver this needs, so it is less work rather than more.

The cost is real and worth stating plainly. This only works if the host loads its tool results into state the renderer can reference, and plenty of applications do not currently do that. For those teams the mechanism is unusable until they restructure, which is a significant adoption barrier for the strongest version of the product. That is why value comparison survives as a documented migration path even though I consider it weaker. I would rather have a mechanism I believe in and a bridge to it than a single mechanism I think is compromised.

A second cost is that this narrows what can honestly be claimed. Binding guarantees faithfulness to the entity the model selected and says nothing about whether that was the right entity. I decided to document that limit prominently rather than let readers infer a stronger guarantee.

One correction to this entry, made while verifying the premise rather than after building on it. My first version of the mechanism treated a reference as sufficient on its own, and that was wrong. Reading json-render's generated prompt showed that the model streams state patches alongside the elements that read them, and is even instructed to include realistic sample data, so the model supplies part of the data its own references resolve against. A reference to a fare price followed by a patch writing a different number into that path resolves cleanly and is still a fabrication. The mechanism only works if the guard owns the paths that back bound properties, which is the decision below.

---

## Why does the guard own the state behind bound properties?

Once it was clear that the model writes state as well as elements, the question became how much of the state the guard should take over. The options were the whole state object, which is simple to reason about, or only the paths that back bound properties, which is more bookkeeping.

I took the narrow version. Interactive state is how a generated interface works at all, and the model is the right author for most of it, so claiming the whole object would break the renderer's own features and turn genui-guard into something that fights its host. That is the opposite of the integration stance everything else here follows. The mechanism that results, which paths are reserved and how a bound reference resolves against them, is described in [docs/concepts.md](concepts.md) under "Who owns the data a pointer points at?".

The cost is the bookkeeping, since the guard now has to track path ownership across a turn and resolve against a different view of state than the renderer eventually uses, and a bug there fails in a confusing direction. The alternative was a guarantee that only held when the model happened not to write where it should not, which is not a guarantee.

---

## Why block before repair?

The original design repaired by default, on the reasoning that a corrected card is more useful to the user than no card. It also demonstrates better, because a component visibly fixing itself is a more satisfying thing to show someone than a component disappearing.

I changed the default to blocking for sourced data, and kept repair for cases where the fix only removes something. Stripping an unsupported claim, dropping an unsafe link and generating missing alt text are all subtractive, so they cannot introduce a new inconsistency. Rewriting a price or a stop count is additive in effect, because it asserts something the model did not say, and the result can be worse than showing nothing. A card repaired to show one stop, sitting underneath a sentence that promised a nonstop flight, is a more confusing experience than a card that did not render.

json-render's own interface makes a version of this argument, since it distinguishes lossy from lossless structural fixes and advises callers to prefer re-prompting over accepting a lossy fix. I am drawing the same line one layer up.

What I lose is the better demonstration, and some usefulness in the common case where the repair would have been fine. Repair remains available per policy for teams who want it, so this is a decision about defaults rather than about capability, which is the right kind of decision to be able to revisit. It is also where the safe defaults principle earns its keep, since a default that fails closed is only defensible if the false block rate stays low enough that nobody notices it failing closed on correct content.

---

## Why is an over budget result annotated rather than blocked?

An earlier version of the policy set treated a trip over the user's stated budget as a constraint violation and blocked it. That was a mistake, and it was in the headline code sample, which made it worse.

Exceeding a stated budget is not a hallucination. The data is accurate, the component is honest, and the user has simply been shown something more expensive than they asked for. Blocking it means they see nothing, cannot tell why, and have no way to decide for themselves that the extra eighty dollars is acceptable. It is also a reliable generator of exactly the false blocks this project claims to care most about.

Annotating instead keeps the information on screen and attached to the thing it describes. It forced me to add annotation as a fifth outcome, which is more surface area than I originally wanted, and I judged that worth it because the alternative was a default that punishes correct behaviour.

Two corrections to this entry, both found by a reviewer reading the README against the code rather than by using it.

The first is about where "attached to the thing it describes" happens. For a while it happened nowhere: the note was collected during merging, never applied, and never read, so configuring `annotateWhere` produced output identical to not configuring it. The fix was not to make the guard write the note into a property. Choosing which property is the host's knowledge, and overwriting a sentence the model wrote in order to warn about it would be its own small fabrication. So the guard reports annotations beside the spec, keyed by element id, exactly as it reports the ids it withheld, and the host attaches them. The demonstration does that in about twelve lines and writes only where the model left the property empty. The sentence above is now true of the product rather than of the library alone, which is the right division: the guard never authors interface copy, and it does not here either.

The second is more embarrassing and worth recording for that reason. The demonstration's budget was $800 and no fare in the fictional dataset cost more than $798, so this outcome, the one this entry exists to argue for, never once fired on screen. It was configured, documented in the README's table, styled in the developer panel, and unreachable. The stated budget is now $600, which annotates exactly one of the four fares shown, and it is the refundable one, so the card the traveller actually asked for is the card that carries the note. That is a better demonstration than anything I would have constructed deliberately, and a browser test now fails if the outcome stops appearing.

The broader principle this surfaced is that genui-guard should check whether the interface tells the truth, not whether the model satisfied the user's intent. Intent satisfaction is product logic, it belongs to the application, and policies that drift into it will produce confident wrong decisions.

---

## Why not offer a substitute when something is blocked?

Blocking a sold out hotel leaves a gap in a results list, and the tempting next step is to fill it with the next available option. I decided not to.

Choosing a replacement means ranking candidates, and there is no basis here for a ranking. The user's preferences, the application's business rules, and whatever the model was trying to achieve with the ordering it chose are all unavailable at this layer. Any ranking I invented would be arbitrary and would occasionally be worse than the gap. It would also quietly make the guard an author of interface rather than a checker of it, which contradicts the position that genui-guard never adds UI of its own.

So the guard blocks, renders whatever fallback the host defined, and records why. The host is in a position to re-request or to fill the gap itself, and it has the context to do that well.

---

## Why does the guard only run on the server?

I considered allowing it to run in the browser, since that is simpler to set up and would have made the demonstration easier to assemble.

A check that runs on the client is a check the client can remove, and every guarantee would then be contingent on the browser behaving. For a layer whose entire value is trust, that is not a trade I can make at any price, so the constraint is stated as a requirement in the README rather than as a recommendation buried in the documentation.

The cost is that nothing which only exists after rendering can be caught, which is why runtime accessibility checking is out of scope for now rather than solved.

---

## Why deterministic checks before a model as judge?

A model judging whether a claim is supported would catch paraphrases that keyword rules miss, and the miss rate on paraphrases is the most obvious weakness in this design.

I am still doing deterministic first, for three reasons that compound. The same input has to produce the same decision every time, because a trust layer that is occasionally generous is not auditable and cannot be reasoned about in an incident review. Latency has to stay small enough to sit inside a stream without being noticed, and a model call does not. And there is no honest way to evaluate whether a judge is worth its cost before measuring what the cheap version misses.

The consequence is that I will publish a detection number with a visible gap in it. That is uncomfortable, and I think it reads as more credible than the alternative, since a deterministic keyword checker reporting near perfect recall is evidence of a flawed test rather than of a good product.

---

## Why no console?

The original plan had a local viewer for browsing traces, policy hit counts and eval trends, and it was the most immediately appealing part of the build.

While surveying the ecosystem I found that json-render already publishes a devtools package with an event store, a panel, an element picker and stream taps, which covers most of that surface for the renderer I am targeting first. Building a second one would have been the least differentiated work in the project, competing directly with first party tooling, and it would have consumed roughly a sixth of the schedule. This is the clearest case of integrating rather than duplicating, and it was also the most tempting one to get wrong, because the console is the part of a trust layer that demonstrates most easily.

I dropped it, and decisions will surface through the existing devtools plus a trace drawer in the demonstration. The loss is that inspection now depends on the renderer, so a host using a different catalog gets a worse experience until I do something about it. That seems like the right thing to be behind on.

One correction to this entry, made after the fact. The devtools half never happened: nothing in this repository depends on `@json-render/devtools`, and the demonstration's panel is its own. So the position is stronger than "we rely on theirs" and weaker than it sounded: the packages emit traces as data and ship no viewer, and the only viewer that exists is in the demo. The reasoning for not building a console still holds, but the sentence above described an integration that was an intention rather than a fact, and it was repeated as fact in the README until a reviewer went looking for the call.

---

## Why two eval suites, and why leave out the obvious number?

The natural report is a before and after comparison showing how many violations get through with the guard off versus on, and that number would have looked excellent.

It would also have been meaningless. If I inject failures using the same vocabulary the checker matches on, I am measuring whether my code does what I wrote it to do, which the unit tests already establish. Near perfect detection on self authored fixtures is a sign of a circular test rather than of a working product, and anyone with evaluation experience reads it that way.

So the report covers two things instead. Detection is measured on held out cases, including paraphrases written without reference to the implementation, which gives a number that can be wrong and therefore means something. False blocks are measured on a suite of legitimate components that must pass untouched, and that is the primary quality metric, because it is the one that determines whether anyone leaves the guard switched on.

The cost is that the headline numbers will look worse than they would under the conventional framing. I am accepting that deliberately, because a figure that would not survive someone recomputing it is worth less than no figure at all.

---

## Why does the eval harness not know what json-render is?

The quick version of the CLI would take a json-render spec, call `guardSpec` itself, and read the result. Every suite in this repository targets json-render, so the indirection buys nothing today.

I gave the CLI a `run` adapter in the config instead, so it depends on core and on no renderer. The reason is the same one that keeps renderer types out of the core, and it applies more sharply to the tooling: the claim that this is a layer rather than a plugin for one renderer is tested by whether a second catalog can be measured with the same harness. A harness welded to one renderer would mean the first adapter arrives with no way to produce comparable numbers, and the numbers are the entire argument. It also keeps the case criteria honest, since a case can only talk about what reached the browser and not about internals the CLI happens to share with the guard.

What I gave up is a few lines of plumbing in every config, and a small amount of type safety at the boundary, since the spec arrives as `unknown` and the config casts it.

A related choice inside the harness. Case criteria never name a policy, a decision or an error code; they name an element that must be gone, a string that must not appear, an action that must ask first. That makes some failures harder to diagnose, because the report says a fabrication survived without saying which check should have caught it. I took that cost deliberately, because criteria written in the implementation's vocabulary turn a refactor into a regression and quietly recreate the circularity the two-suite design exists to avoid.

---

## Why keep the core free of renderer types?

It would be faster to let the core work directly with json-render's specification types, since that is the renderer being built against first and the adapter would mostly disappear.

I am keeping a neutral representation in the core anyway. The claim that this is a layer rather than a plugin for one renderer is only credible if it can be demonstrated on a second catalog, and that becomes impossible once the renderer's types have spread through the core. The discipline costs very little now and would be expensive to retrofit, since retrofitting would mean reworking every policy. It also insulates the project from the dependency risk accepted earlier, because interface changes land in one adapter instead of everywhere.

The cost is an extra translation step and some duplicated concepts, which is a reasonable price for keeping the main strategic claim provable.

---

## Why not describe any of this as a security boundary?

Role checks and input restrictions look like security features, and it would be straightforward to describe them that way.

They are not security features. They stop a confused model from rendering a staff control or a stray password field, and they do nothing whatsoever to stop a client from calling the underlying API directly. Describing them as a security boundary would encourage exactly the mistake I would least want to cause, which is a team removing a backend permission check because the guard appears to cover it.

So there is a section in the README that says this in plain language, rather than a caveat buried in the policy reference. It makes the product sound less impressive. It is the only defensible choice.

---

## Why does a repair remove entries from a list rather than clearing the property?

Claims arrive as a single string sometimes and as a list of badges or tags more often, and the first version of the claim policy only inspected strings. That meant a `badges: string[]` property, which is how most catalogs model this, received no claim checking at all. A fabricated badge in a list passed straight through.

Fixing the omission raised a second question, which is what a repair should do once it finds one bad entry among several good ones. Clearing the whole property is simpler and it discards the claims the source genuinely supports, which is a different kind of wrong answer. So the repair removes only the offending entries and keeps the rest, and the reason string says which ones went and that the others stayed.

Building the demonstration for this found a false repair that the unit tests had not. A fare with `bagsIncluded: 2` was having its "Bag included" badge stripped, for two reasons that compounded. The topic is written in prose and the field name is camelCase and plural, so `"bag included"` never matched `bagsIncluded` as a raw string. And the support check only accepted `true` or a non-empty string, so a count of `2` did not register as support at all. Both sides are now reduced to crudely singularised word tokens before comparison, and a number greater than zero counts as support while `0` and `false` do not.

That bug is worth recording because of how it was found. It did not show up in tests written against the policy; it showed up the moment the demo put real data through it, which is an argument for building the demonstration early rather than after the evals.

---

## Why three phases instead of six?

The original plan ran to six phases across six weeks, covering the core, the demonstration, a coding agent integration, evals, four adapters and the console.

Two of those phases turned out to duplicate first party tooling, and the adapter work was breadth rather than depth. I cut to the core, the demonstration and the evals, which is the smallest set that supports the central claim and then proves it with measurements. The coding agent integration is the one cut I expect to regret, since it is a genuinely distinctive piece and it becomes cheap once traces exist, so it sits at the top of the roadmap rather than in the discard pile.

The reasoning that settled it is that unnecessary scope reads as an inability to prioritise, and a smaller project with honest measurements is stronger than a larger one carrying a thin layer of everything.
