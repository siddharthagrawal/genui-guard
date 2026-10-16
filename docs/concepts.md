# Concepts

This doc explains how genui-guard works and, more usefully, where it stops working. It assumes no familiarity with generative UI frameworks, and it uses one example throughout so that it's easier to understand the idea.

If you read only one section, read the one on what this cannot catch. The capabilities are the easy part; the limitations are what you need to understand before relying on any of it.

**The running example.** A travel assistant where User asks for a weekend in Lisbon, the assistant searches for flights, and the page dynamically fills with flight cards.

```
fareId   HA-2041
airline  Harbor Air
price    412
stops    1
```

---

## What changes when an AI composes the page?

In an ordinary application the path from data to screen is short, and nothing interferes with it. Your code calls an API, gets back a fare of $412, and hands it to a card that displays $412.

In a generative interface there is an extra step in the middle. The model calls the search tool, reads that the fare is $412, and then decides two separate things: which components to show, and what to put inside them. That second decision is where the risk lives.

The important nuance is that the model is not copying the fare into the card. It is *describing* it. Describing leaves room for rounding, summarising, transposing one flight's price onto another, and embellishing. Those are all reasonable things to do with text, and none of them is acceptable between an API and a price.

So this is not a problem you can prompt your way out of. The model is doing its job, and the job happens to include writing numbers it should not be writing sometimes. genui-guard sits at that middle step, sees both the real fare and what the model wants to render, and checks the second against the first.

---

## What does the model actually send?

Not finished components, which is the first thing that most people find surprising. It sends something closer to a blueprint: a numbered list of pieces, plus instructions about which piece sits inside which.

For our example the model might send this, slightly simplified:

```
root      is a Page,        containing  [results]
results   is a Section,     containing  [card-1]
card-1    is a FlightCard,  showing     Harbor Air / $412 / 1 stop
```

Three things follow from that shape, and they explain most of genui-guard's design.

**The pieces refer to each other by name.** `results` does not contain `card-1` directly, it contains the *name* `card-1`. So a decision about one piece has consequences for others, which matters when the guard decides to remove something.

**A value in a card can be one of two things.** The model can type a value directly, writing `412` into the price field. Or it can point at a value your application already loaded, writing the equivalent of "whatever is in the fare store under HA-2041, field price." The difference between typing and pointing is the most important idea in this project, and the next section covers this in more detail.

**The model also sends data, not just layout.** Alongside the blueprint it sends entries for the shared fare store those pointers refer to. That detail changes the design more than anything else here.

---

## Why does pointing beat typing?

Suppose the model types `189` into the price field for our $412 fare. Now you have a decision to make, and every available answer is bad.

You could **rewrite the card** to $412. But the model has probably also written a sentence beside it saying "I found you a great fare at $189", and genui-guard never sees that sentence and cannot correct it. You have replaced one inconsistency with a less visible one.

You could **hide the card**, which leaves the user looking at a gap with no explanation.

You could **show it**, which is the original problem.

The fix is to stop letting the model type the value at all. For any field you mark as *bound*, meaning its value must come from real data, the model may only point. It can point at the fare's price. It cannot write a number.

This removes the judgement call completely. When a bound field is only allowed to hold a reference, a typed-in number is simply not valid there, the same way a letter is not valid in a field that only takes digits. There is nothing to compare and nothing to decide, because the model was never allowed to write the value in the first place.

---

## Who owns the data a pointer points at?

Here is the subtlety that is easy to miss, and that I had wrong in my own first design.

A pointer is only safe when the thing it points at is trustworthy, and the model fills in part of that shared fare store itself. So it can do this::

```
card-1  price  points at   fares / HA-2041 / price      <- looks perfect
        and also sends     fares / HA-2041 / price = 189  <- wrong
```

Every check passes. The pointer is a genuine pointer, it resolves cleanly, and the card displays $189. Nothing is malformed. The fabrication has simply moved one step away from where anyone was looking.

What makes a bound field trustworthy is therefore not the pointing syntax. It is **who is allowed to write the data behind the pointer.**

genui-guard takes custody of exactly those locations. When your application reports a tool result, the guard writes the real fares into a reserved area and remembers which locations it filled. From then on those locations have one writer. A bound field has to point inside that area, pointers resolve against what your server loaded instead of against anything the model sent, and any attempt by the model to write into a reserved location is rejected and recorded.

Everything outside that reserved area is left alone, and that restraint matters. Interactive state is how a generated interface works at all, things like which dialog is open, what is typed in the search box, and which tab is selected. The model is the right author for nearly all of it, and taking over the whole store would break the renderer's own features. The guard claims only the locations that hold verified data, which is the smallest territory that delivers the guarantee.

One practical note from building the demo - Sometimes the model re-sends data your server already has, unchanged. That is not an attack and not a mistake, it is just redundant, and the guard reports it that way rather than counting it as a violation. Counting harmless duplication as a caught failure would overstate what happened and make the numbers meaningless.

---

## What happens when the guard removes something?

Deleting the piece is not enough, because of how the blueprint refers to things by name.

If the guard removes `card-1` but leaves `results` still listing `card-1` among its contents, the renderer goes looking for a card that no longer exists. In json-render's case its own validator reports that as a dangling reference, and the page is invalid.

So removing a piece has three parts. The piece goes away, every mention of it by name goes away, and anything that lived only inside it goes away too. That last part has a consequence worth sitting with because it means **removing a container removes everything inside it.** If a rule trips on the `results` section instead of on one card, the whole results list disappears. That is a good reason to be careful about applying rules to containers, and a good reason the trace records what was lost rather than only what was examined.

The upside of working on a whole blueprint, instead of a stream of independent components, is that I can check the result before it goes out. Whatever reaches the renderer holds together, and that is what lets me promise a blocked component never breaks the page.

---

## What about the parts that arrive gradually?

Generative interfaces feel fast because they render as they arrive instead of waiting for the whole answer. That fights with checking, because a value cannot be verified until it has finished arriving.

The way through is to let the structure render and hold back only the values that need verifying. Layout, headings, and labels appear right away, so the user sees the shape of the answer forming. Wherever a verified value belongs, the renderer shows a placeholder until that value has arrived and passed its check.

I made this ordering deliberate. A price that appears and then quietly corrects itself is worse than a price that appears half a second later, because the first version was on screen long enough to be read and believed.

That leaves the question of what happens when the data never arrives, which is a real case. A model can describe a card that depends on a search still running, or on one that failed. Waiting forever is not an option, so the hold expires, the card is blocked, and the trace says so. This path matters more than it looks, because it is the one that runs when something upstream has already gone wrong.

---

## What are the five possible outcomes?

Every component ends up in exactly one of these. When several rules apply, the most restrictive one wins.

| Outcome | What happens | Example |
|---|---|---|
| **Allow** | Renders unchanged, and is still recorded | A correctly bound flight card |
| **Annotate** | Renders, with a note attached | A fare over the budget the user stated |
| **Repair** | Renders with something removed | A "free cancellation" badge the fare rules do not support |
| **Gate** | Renders, but an action needs confirmation first | Book, which would charge a card |
| **Block** | Does not render, and a fallback takes its place | A price the model typed instead of pointed at |

Three of these deserve explanation, because the reasoning is not obvious from the names.

**Allow is recorded too.** A trust layer that only logs its interventions cannot answer the question "did you actually look at this?" The allows are the only evidence that the guard is examining everything rather than blocking indiscriminately, and that is the difference between a careful guard and a trigger-happy one.

**Repair only ever removes.** Stripping an unsupported claim, dropping an unsafe link, or filling in missing alt text from the component's own title each take something away or restate something already there. None of them asserts a new fact. Rewriting a price to a different price would assert something the model never said, which is how you end up with a card that contradicts the sentence above it. When a repair touches a list, such as a card's badges, it removes only the offending entries and keeps the ones the data supports.

**Annotate exists because blocking is sometimes the wrong tool.** A fare over the stated budget is accurate, honest data. The user is being shown something more expensive than they asked for, and they may well want it anyway. Hiding it means they see nothing and cannot tell why.

---

## What can this not catch?

Three limits. The first does not go away with more rules, and it is the one to understand before relying on any of this.

**It cannot tell whether the model picked the right thing.** Verification confirms that a card's fields faithfully describe the fare the model said it was showing. It cannot confirm that this was the right fare to show. If the model points every field correctly at a flight the user never asked about, every check passes, the trace is clean, and the card is wrong. Choosing the right fare stays the model's job. What the guard removes is the large and common class of failures where the model had the right fare and described it badly. What remains are failures of reasoning rather than of transcription, and those need a different kind of defence.

There is one partial exception worth knowing. If a card's fields point at two different fares, showing one flight's price beside another's departure time, the guard does catch it, because the fields no longer describe a single thing. That transposition is the most realistic failure of the lot, and it is caught by checking that all of a card's bound fields agree on which record they describe.

**It misses claims phrased in unfamiliar words.** The claim checks look for particular words and phrases. Someone writing "you can get your money back whenever you like" has made a refund promise using none of the vocabulary the rules recognise. I measure and publish that gap rather than paper over it, and closing it is first on the roadmap.

**It cannot see anything that only exists once rendered.** Because the guard runs on the server, accessibility checking reaches only what is visible in the blueprint, which is alt text, labels, and heading structure. Colour contrast, focus order, and whether an ARIA role suits its context all need the rendered page, which the server never sees. That is a real gap, and it is the price of running somewhere the browser cannot reach in and switch it off. Runtime accessibility belongs in the browser, and the two would work together rather than compete.

---

## How do bindings and rules divide the work?

It helps to see these as answering two different questions.

**Bindings** answer whether the data in the interface came from somewhere real. That is the mechanism described above: point, do not type, and the guard owns what you point at.

**Rules**, which the code calls policies, answer everything else: whether this interface should exist in this form, for this person, right now.

That split is why bindings alone are not enough, even though they are the stronger mechanism. A perfectly bound card can still promise free cancellation no fare rule supports, show a hotel with no rooms left, expose a staff-only refund override to a customer, fire a booking without asking, or load an image from a host nobody approved. Every one of those is a property of the composition rather than of any single value, which is exactly what a binding cannot express.

There is a practical consequence that matters for adoption. A team gets most of the rule-based value immediately, because rules need no change to how their application is built. Bindings require loading tool results into state the renderer can reference, and that is the part that takes real work. So adoption does not have to happen all at once, and the order that works is rules first, bindings when you are ready.
