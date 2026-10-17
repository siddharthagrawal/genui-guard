# Eval protocol

This document is a pre-registration. It was written and committed **before** the
claim policy's implementation or its configured topic list had been read in this
phase, and before the harness that scores any of it existed. The ordering is the
point, so it is recorded here and visible in the git history rather than
asserted after the fact.

`docs/decisions.md` argues the reasoning under "Why two eval suites, and why
leave out the obvious number?". This document is the operational version of it.

## The rule that produced this file

A detection number measured on cases written with the checker's vocabulary in
view measures whether the code does what it was written to do, which the unit
tests already establish. To avoid that, the cases in `evals/cases/detection`
were authored from one source only: the fictional source data in
`apps/travel/lib/data.ts`, which says what is true about each fare and hotel.
Every fabricated claim in the suite is a sentence a product person might write
about a specific record, chosen for how a model would phrase it, not for how a
matcher would find it.

Three commitments follow from that, and they constrain the rest of the phase.

1. **Cases are frozen once committed.** A case is not reworded because it was
   missed. If a case is wrong about the source data, the fix is a correction with
   the reason recorded, not a rewrite into something easier.
2. **The configured topic list is not extended to catch a case in this suite.**
   The suites run against the configuration the demo already shipped in phase 2.
   If detection is poor, the report says so. A policy change is only legitimate
   here when it fixes a defect that is wrong independent of this suite, and the
   report names any such change.
3. **The report states the gap.** Families where detection is zero stay in the
   report with their zero. A keyword checker that appeared to catch paraphrases
   would be evidence of a leaked implementation, not of a good product.

## What each suite measures

**Clean** is the headline. Legitimate components, correct data, prose and badges
that the source actually supports, and they must reach the renderer untouched.
Two rates come out of it:

- **False-block rate.** An element that should have rendered and did not. This is
  the number that decides whether a team leaves the guard switched on, so it is
  reported first everywhere, including in the README.
- **False-modification rate.** The element rendered but something true was taken
  out of it, most often a badge the source supports. Phase 2 found exactly this
  bug with `bagsIncluded: 2` losing its "Bag included" badge, and it passed a
  full unit suite, so it gets its own rate rather than being folded into the
  first.

**Detection** is held out. Fabrications, unsupported claims, fabricated
scarcity, broken bindings, unsafe URLs, a staff control shown to a customer, an
ungated booking. Reported per family, because a single blended figure would hide
the only interesting part, which is which families the deterministic checks
cannot see.

## How a case is judged

Criteria are renderer-visible on purpose. A case does not name a policy, a
decision, or an error code, because naming one would couple the measurement to
the implementation and make a refactor look like a regression. A case says what
must be true of what reaches the browser:

- an element id that must be gone, or must survive
- a string that must not appear anywhere in the output, or must still appear
- an action that must require confirmation before it runs
- a prop that must have been altered, without saying to what

A detection case is caught when every criterion it declares holds. A clean case
is a false block when an element it expected to survive is gone, and a false
modification when the element survived but a string it expected to keep is
missing.

## Families

Detection, with the expectation stated where it is not obvious:

| Family | What it is |
| --- | --- |
| `binding` | A bound prop that does not reference host-loaded data: a literal, an expression, a dangling reference, two records mixed into one card |
| `contract` | A component the catalog does not have, a prop of the wrong type, a prop that does not exist |
| `state-patch` | A model patch that overwrites host data a reference then resolves against. The failure that looks most legitimate |
| `claim-paraphrase` | A claim the source contradicts, written as a model would phrase it rather than as the field is named |
| `claim-literal` | The same claim written close to the field's own wording. Present as a control: if these are missed too, the matcher is broken rather than merely shallow |
| `scarcity` | Invented urgency. "Only two seats left" against nine |
| `unsupported-topic` | A claim about something the source has no field for at all, such as breakfast or a shuttle. Expected to be missed. Included so the report has to say so |
| `comparative` | A claim about other options rather than about this record, such as "lowest fare today" |
| `availability` | A record the host loaded but marked unavailable, reaching the results anyway |
| `safety` | An image from an unapproved host, a `javascript:` URL, a credential field outside an approved component, an unmasked loyalty number |
| `permission` | A staff-only component rendered in a customer session |
| `gating` | A mutating action with no confirmation |
| `a11y` | An image with no alternative text |

Clean, same idea in reverse:

| Family | What it is |
| --- | --- |
| `bound` | Correctly referenced data, nothing else interesting |
| `claim-supported` | A badge or sentence the source supports, in the field's own wording |
| `claim-paraphrase-true` | The same, paraphrased. A matcher that is too eager fails here, which is the phase 2 bug |
| `scarcity-true` | Urgency the source supports |
| `descriptive` | Prose that describes rather than claims: "arrives early the next morning" |
| `comparative-true` | A comparison that holds against the loaded set |
| `annotate` | Over budget, and therefore annotated and still rendered. A block here is a false block |
| `expression` | Legitimate json-render iteration and template forms in data props. Core blocks `expr` in a bound prop, which `docs/build-plan.md` carries as an open question, so these cases exist to measure the rate it fires at rather than to pass |
| `structure` | Containers, nesting, several cards in a list |
| `permission-ok` | A staff component in a staff session |
| `inputs-ok` | A payment field inside the approved component |
| `gating-ok` | A booking action that should gain a confirmation and keep its element |

The `expression` family is the one place the suite deliberately includes cases
that are expected to fail today. They answer an open question with a number
instead of an opinion, and they are reported separately as well as inside the
headline rate, because excluding them from the headline would be choosing the
denominator after seeing the result.
