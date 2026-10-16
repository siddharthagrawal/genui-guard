# genui-guard

Trust layer for generative UI. TypeScript monorepo. Checks that model-composed interfaces are true, permitted and safe before they reach the renderer.

Read `docs/build-plan.md` for the current phase and its acceptance criteria. Read `docs/concepts.md` before touching the guard, and `docs/decisions.md` before changing a default. Those decisions are settled. Do not re-litigate them in code.

## Invariants

These are the claims the product makes. Breaking one is a bug even if tests pass.

- **The guard owns the state behind bound props.** `recordToolResult` populates a reserved region. Bound props must reference a path inside it. Model state patches writing into a reserved path are rejected. Bound refs resolve against host state, never against merged state.
- **A bound prop may not hold a model-authored value.** A literal in a bound prop is a block, not a comparison.
- **Never let an unchecked element reach the renderer.** Fail safe. Block or fall back, never crash, never pass through on error.
- **Blocking is a tree edit.** Remove the element, prune its id from every parent's children, cascade to its subtree. Never emit a dangling reference.
- **Every decision emits a trace entry, including `allow`.** No silent changes.
- **Decision precedence is `block > gate > repair > annotate > allow`.** Strictest wins. Conflicting repairs on one prop block.
- **Repair is subtractive only.** Strip a claim, drop a URL, add alt text. Never rewrite a value to a different value by default.
- **Core is deterministic.** Same input, same decision, every time. No network calls, no clock reads, no randomness in core.

## Rules

- TypeScript strict. No `any` without a comment saying why.
- `zod` v4 as a **peer** dependency, matching json-render. It is the only runtime dependency of core.
- **Core must not import or reference json-render types.** Core speaks its own neutral element and event types. Renderer specifics live in the adapter. This is what makes the layer claim provable.
- **Delegate, do not reimplement.** Contract validation calls `catalog.validate()`. Expression resolution calls `resolveElementProps()` / `resolvePropValue()`. Structural repair calls `autoFixSpec()`. Trace viewing uses `@json-render/devtools`. If json-render already does it, call theirs.
- Every thrown error uses a code from `packages/core/src/errors.ts` and carries a message and a fix hint. There is a test that iterates the catalog and asserts both.
- Vitest everywhere. Run `pnpm test` before declaring anything done.
- Keep the public surface small. Ask before adding an exported function.
- When a public API changes, update `docs/` and the README quickstart in the same commit.
- Demo data is fictional. No real airlines, hotels or brands, and no real fare or policy claims. Harbor Air, not a real carrier.
- json-render is pre-1.0 and pinned to an exact version. Check its current docs before using an API, and never widen the pin without a contract test.

## Commands

```
pnpm install | pnpm build | pnpm test | pnpm lint
pnpm --filter travel dev
pnpm --filter @genui-guard/core test --coverage
```

## Stack

pnpm workspaces, no Turborepo (four workspaces does not need a task graph). Vitest for tests, Playwright for the demo smoke test. Next.js App Router and Tailwind for the demo. Node 20+, ESM only. Web Streams for the transform.
