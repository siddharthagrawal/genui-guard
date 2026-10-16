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

Hosts using a component catalog go through an adapter instead of listing components by hand. See [@genui-guard/json-render](https://www.npmjs.com/package/@genui-guard/json-render).

## What this does not catch

Verification confirms that a component describes the record the model said it was showing. It cannot confirm that this was the right record to show. If the model references a fare the user never asked about, every check passes and the card is still wrong.

Claim checks look for particular words, so a refund promise phrased as "you can get your money back whenever you like" uses none of the vocabulary the rules recognise.

Role and input checks are defence in depth, **not authorisation**. They stop a confused model from rendering a staff control or a stray password field, and they do nothing to stop a client calling your API directly. Your backend must still enforce every permission.

Full detail in [docs/concepts.md](https://github.com/siddharthagrawal/genui-guard/blob/main/docs/concepts.md).

## MIT
