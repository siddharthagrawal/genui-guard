# @genui-guard/cli

Two commands for a [genui-guard](https://github.com/siddharthagrawal/genui-guard) setup: one that tells you whether your configuration protects what you think it protects, and one that measures what the guard does to real components.

```bash
pnpm add -D @genui-guard/cli
npx genui-guard check
npx genui-guard test
```

## `genui-guard check`

Validates the config and the registry, and prints which components are verified against tool results and which are not. That last line is usually the useful one, because an unverified component is protection someone believes they have.

```
components
            Stack
  verified  FlightCard      fares.fareId <- airline, price, stops
  verified  HotelCard       hotels.hotelId <- name, nightly  (alt:imageAlt)
            TripSummary

  2 of 4 components declare no bound props, so nothing on them is checked against tool results: Stack, TripSummary.
  That is correct for containers and inputs. For anything that shows sourced data it is a gap.
```

It catches a bound property declared without an entity or a key, a typo in `bound` that the catalog's schema has no property for, a tool result whose array data has no key to address records by, a policy that was referenced but never called, and a threshold that is not a rate. Every problem comes with a fix rather than a restatement, and the registry half delegates to core's own lint, so `check` and `createGuard` can never disagree about what is valid.

Exits 1 when there is anything to fix.

## `genui-guard test`

Runs eval suites of your own cases and writes a report. Two kinds of suite, because they answer different questions.

A **clean** suite is legitimate components that must pass untouched. Its false-block rate is the headline number, because a guardrail that withholds correct content gets switched off, and once it is off its detection rate stops mattering. The report separates a false block, where the element never rendered, from a false modification, where it rendered with something true taken out of it.

A **detection** suite is held-out failures. It is reported per family rather than as one figure, because a blended number hides the only interesting part, which is which failures the deterministic checks cannot see.

Exits 1 when a configured threshold fails, so this works as a build step.

## Writing cases

A case says what must be true of what reaches the browser. It never names a policy, a decision or an error code, so that a refactor cannot read as a regression.

```ts
import type { EvalCase } from "@genui-guard/cli";

export const cases: EvalCase[] = [
  {
    id: "literal-price",
    family: "binding",
    describe: "A flight card showing $299 for a fare the search priced at $412.",
    spec: /* whatever your renderer takes */,
    expect: { dropped: ["card"] },
  },
];
```

The criteria are `dropped`, `kept`, `absent`, `present`, `confirmed`, `changed`, and `anyOf` for cases where more than one outcome protects the user. There is also `ideally`, which is reported and never scored, for the outcome a developer would prefer when a blunter one also kept the user safe.

## Configuration

```ts
import { defineConfig } from "@genui-guard/cli";
import { guardSpec } from "@genui-guard/json-render";
import { guardConfig } from "./lib/guard";

export default defineConfig({
  registry: guardConfig.registry,
  policies: guardConfig.policies,

  tools: [/* the tool results every case starts from */],
  ctx: { session: { role: "customer" } },

  // The adapter. The CLI knows nothing about any renderer, so you hand it one.
  run: async ({ guard, spec, ctx }) => {
    const result = await guardSpec(guard, spec, ctx);
    return { output: result.spec, dropped: result.dropped, traces: result.traces };
  },

  suites: [
    { name: "clean", kind: "clean", dir: "./cases/clean" },
    { name: "detection", kind: "detection", dir: "./cases/detection" },
  ],

  thresholds: { maxFalseBlockRate: 0.05 },
  reportPath: "./reports/latest.md",
});
```

Importing the configuration your application actually runs, rather than copying it, is worth the small amount of plumbing: a second copy can be tuned to make the numbers look better, and nobody will notice.

The CLI depends on `@genui-guard/core` and on no renderer, which is why `run` is yours to supply. `@genui-guard/json-render` provides `guardSpec` for json-render.

## TypeScript config and case files

Node 22.18 and later load `.ts` files directly. Before that, run the CLI under a loader:

```bash
node --import tsx node_modules/.bin/genui-guard test
```

The error you get otherwise says this, with the command in it.

## Options

```
--config <path>   Config file. Defaults to genui-guard.config.ts in the current directory
--mode <mode>     Only "replay" is supported, which is the default and uses no network
--suite <name>    Run one suite rather than all of them
--report <path>   Where to write the report
--json            Machine-readable output, for a CI comment
--no-report       Do not write the report file
```

## License

MIT
