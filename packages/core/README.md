# @genui-guard/core

The trust layer for generative UI. Runs on your server, between the agent that decides what to show and the renderer that draws it, and checks that what the user sees is true, permitted and safe.

Part of [genui-guard](https://github.com/siddharthagrawal/genui-guard). Research prototype, pre-1.0.

## What problem this solves

A component catalog makes generated UI *valid*. It does not make it *true*. A perfectly well formed `FlightCard` can still show a fare the API never returned, a refund policy that does not exist, or a Book button nobody confirmed.

The reason is that the model sits between your API and the screen. It reads the tool result and then writes the component's properties itself, so it can transpose a price, reuse a stale result, or attach a claim the data does not support.

## How it works

For properties you mark as bound, the model may not write a value at all. It may only emit a reference into data your server already loaded from a real tool result. A literal in a bound property is malformed by construction, so there is no mismatch to adjudicate.

A reference is only as good as the data behind it, and in these frameworks the model streams state as well as elements. So the guard takes ownership of the paths that back bound properties: they are populated only from `recordToolResult`, model writes into them are rejected, and bound references resolve against host data rather than against anything the model sent.

On top of that sit policies for the things bindings cannot express, covering unsourced claims, availability, roles, action confirmation, URL safety, sensitive inputs, field masking and static accessibility.

Every element ends up allowed, annotated, repaired, gated or blocked, strictest outcome wins, and every decision including every allow is traced with a plain-language reason.

An annotation is reported rather than applied. The note travels in the trace, so the element renders as the model composed it and the host decides whether and where to show the note; `annotationsFrom` in the json-render adapter collects them by element id. Writing the note into a property would mean the guard choosing which property and overwriting whatever the model had put there.

## Install

```bash
npm install @genui-guard/core zod
```

`zod` v4 is a peer dependency. It is the only runtime dependency.

## Usage

```ts
import { createGuard, createRegistry, policies as p } from "@genui-guard/core";

const guard = createGuard({
  registry: createRegistry([
    { name: "FlightCard", entity: "fares", key: "fareId", bound: ["airline", "price", "stops"] },
  ]),
  policies: [
    p.requireBinding(),
    p.dropUnsourcedClaims({ topics: ["free cancellation", "refundable"], supportedBy: ["fareRules"] }),
    p.excludeWhere("fares", (fare) => fare.seatsLeft === 0, "it is sold out"),
    p.confirmActions(["book"]),
    p.safeUrls({ imageHosts: ["img.example.test"] }),
  ],
});

// The source of truth for this turn.
guard.recordToolResult({
  turnId,
  toolName: "searchFlights",
  entity: "fares",
  key: "fareId",
  data: fares,
});

// Any transport. Deleting this line is how you remove genui-guard.
const safe = agentEvents.pipeThrough(guard.stream({ turnId, session }));
```

Trust is scoped to one turn. A follow-up that calls no tool has to be handed the earlier results again, which is an in-process call rather than a second search, and recording the same tool's same data twice is accepted rather than treated as a conflict. Set `staleAfterMs`, pass `at` when recording and `now` on the context, and an element reading data older than your tolerance is annotated with its age rather than withheld: the card is probably still right and the authoritative check belongs at your transaction. Core reads no clock, so all three values come from you. Release a turn with `endTurn`, or let the oldest be evicted past `maxTurns`.

Hosts using a component catalog go through an adapter instead of listing components by hand. See [@genui-guard/json-render](https://www.npmjs.com/package/@genui-guard/json-render).

## What this does not catch

Verification confirms that a component describes the record the model said it was showing. It cannot confirm that this was the right record to show. If the model references a fare the user never asked about, every check passes and the card is still wrong.

Claim checks read a claim as asserting its topic or denying it, and the source has to agree with whichever was meant, so an honest "Non-refundable" badge survives on a fare that is not refundable. They still look for particular words, so a refund promise phrased as "you can get your money back whenever you like" uses none of the vocabulary the rules recognise. The held-out eval suite puts a number on it: 0 of 18 paraphrased claims caught, against 3 of 5 when the same claim is written in the configured topic's own words. What that buys is precision, since across 51 legitimate components nothing true was removed.

`maskFields` reaches a value the model typed and nothing else. A bound sensitive field is annotated rather than masked, because the renderer resolves the reference on the client against state the guard does not own: rewriting it would break the binding, and masking the spec would not help while the full value sits in the state the host hydrates. Redact it where that state is built.

Role and input checks are defence in depth, **not authorisation**. They stop a confused model from rendering a staff control or a stray password field, and they do nothing to stop a client calling your API directly. Your backend must still enforce every permission.

Full detail in [docs/concepts.md](https://github.com/siddharthagrawal/genui-guard/blob/main/docs/concepts.md).

## MIT
