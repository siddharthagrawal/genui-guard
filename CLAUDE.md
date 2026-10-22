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
- **Delegate, do not reimplement.** If json-render already does it, call theirs rather than writing a second one. That is the principle; what follows is what is actually wired, because the two drifted apart once and the README claimed the aspiration as fact.
- **What delegation exists today.** Property validation runs the catalog's own zod schemas, which `fromJsonRender` hands to core. Gates set json-render's own `confirm` field. Those are real.
- **What is deliberately not delegated.** `catalog.validate()` validates a whole spec, and the guard works element by element on a stream, so core runs the schemas itself. Expression *resolution* stays with json-render at render time: the adapter only classifies which of the eight property forms was used, since that is what decides whether a bound property can be attributed to a record. The guard never evaluates a template, which is why it refuses one in a bound prop.
- **What is simply not done.** Nothing calls `autoFixSpec()`, so structural repair is the host's to run around the guard. Nothing depends on `@json-render/devtools`, so a host on another catalog gets traces as data and no viewer. Do not write either of these up as if they were wired; if you implement one, update the README's "Where does genui-guard fit?" section in the same commit.

- Every thrown error uses a code from `packages/core/src/errors.ts` and carries a message and a fix hint. There is a test that iterates the catalog and asserts both.
- Vitest everywhere. Run `pnpm test` before declaring anything done.
- There is no linter, and `pnpm lint` does not exist. It used to be advertised and always exited 1, because no workspace defined the script. `tsc` with these settings catches most of what one would. If a linter arrives, add it to every workspace at once rather than to the root alone.
- Keep the public surface small. Ask before adding an exported function.
- **When behaviour or a public API changes, update every document that describes it, in the same commit.** Not just the README. Work the list: `README.md`, the affected package's `README.md`, `docs/concepts.md` for mechanism, `docs/decisions.md` for a decision or a correction to one, `docs/build-plan.md` for the surface and the acceptance criteria, `docs/prd.md` for the product claim, `docs/eval-protocol.md` if a family or criterion moves, `ROADMAP.md` for anything deferred, and this file for a rule or a trap. Grep for the old claim before assuming it lives in one place: the delegation sentence that was wrong was wrong in three files, and fixing two of them is how it survived.
- **A correction to a settled decision goes in `docs/decisions.md` as a dated correction, not as a quiet edit.** The entry's value is the reasoning at the time plus what changed, and the log already has several.
- Demo data is fictional. No real airlines, hotels or brands, and no real fare or policy claims. Harbor Air, not a real carrier.
- json-render is pre-1.0 and pinned to an exact version. Check its current docs before using an API, and never widen the pin without a contract test.

## Commands

```
pnpm install | pnpm build | pnpm test | pnpm typecheck
pnpm --filter travel dev
pnpm --filter @genui-guard/core test --coverage
pnpm --filter @genui-guard/evals check   # config and registry, with fixes
pnpm --filter @genui-guard/evals test    # both suites, writes evals/reports/latest.md
```

## Environment traps

Each of these cost time once already.

- **Do not touch `~/.npmrc`.** The machine's global npm points at an Amazon CodeArtifact registry with an expired token. This repo has its own `.npmrc` pinning the public registry, which is what makes installs work. Fixing the global config is not ours to do.
- **Stop the dev server before `pnpm -r build`.** The recursive build runs `next build`, which overwrites `.next` underneath a running `next dev` and produces a confusing 500 on every route. Symptom looks like a code bug and is not.
- **`apps/travel` relative imports must not carry `.js` extensions.** Next's bundler does not rewrite `.js` to `.ts` for app code, so `from "../lib/data.js"` fails to resolve. Package code under `packages/` does use `.js`, because it is compiled by `tsc`.
- **The travel app's `test` script runs Playwright, not Vitest.** Its real tests are the browser smoke tests in `apps/travel/e2e`. `pnpm -r test` therefore starts a dev server, reusing one if already running.
- **`strictDepBuilds: false` in `pnpm-workspace.yaml` is deliberate.** Without it a correct install exits 1 over esbuild's skipped postinstall, which would fail CI. esbuild's real binary arrives via its platform optional dependency.
- **Never run `npm publish` from inside `packages/*`.** npm reads `.npmrc` from the current directory and from the home directory, and does not walk up to the workspace root, so a publish started inside a package misses this repo's public-registry pin and resolves to the machine's global CodeArtifact registry instead. A dry run from `packages/core` reported it was publishing to `amazon-149122183214.d.codeartifact.us-west-2.amazonaws.com`. Publish with `pnpm release` from the root, which walks up and finds the right registry, and pass `--registry https://registry.npmjs.org/` if a one-off `npm` command is ever unavoidable.
- **Publishing needs an interactive terminal.** The npm account's 2FA is a security key, and pnpm completes that in a browser, so a non-TTY shell fails with `ERR_PNPM_OTP_NON_INTERACTIVE`. There is no `--otp` code to supply: a security key does not produce one. An agent cannot do this step; a human runs `pnpm release` and taps the key.
- **A dot inside a path segment is escaped as `\.`, and never split naively.** Record identifiers contain dots in real data, so `splitPath` and the adapter's pointer translation both honour the escape. Anything new that takes a path apart must use `splitPath`, `recordId` or `joinPath` rather than `String.split(".")`, which is the bug that made every bound card fail for a host whose ids looked like `UA.102.Y`.
- **A claim can deny its topic as well as assert it.** `dropUnsourcedClaims` compares the polarity of the claim with the polarity of the field, so "Non-refundable" survives on a fare that is not refundable. Do not simplify that back into a single support check; it deleted protective warnings for four days and the clean suite could not see it.
- **Commits use a repo-local noreply email.** `git config user.email` here is `5350259+siddharthagrawal@users.noreply.github.com` on purpose, so no real address enters the public history. Do not change it or fall back to the global identity.

## Eval rules

The detection suite is held out, and `docs/eval-protocol.md` is a pre-registration rather than a description. Three things follow and they are not negotiable in code review.

- **Do not reword a case because it was missed.** A case is corrected only when it is wrong about the source data or contradicts another case, and the correction is recorded in the protocol document with its reason.
- **Do not add a claim topic to catch a case in the suite.** A policy change is legitimate here only when the defect is wrong independent of these cases.
- **Do not drop a zero from the denominator.** Families the deterministic checks cannot see keep their zeros in the report, and the README states them.

The suites run the demo's own `guardConfig`, imported rather than copied, which is what keeps the configuration from being quietly tuned to the cases that score it.

## What the last two phases taught

Two of the most valuable bugs were found by putting real data through the demo, not by tests. A legitimate "Bag included" badge was being stripped because the claim topic was prose and the field was `bagsIncluded`, and the claim policy was not inspecting list props at all, so a fabricated badge in an array received no checking. Both survived a fully passing suite.

Expect the eval suites to behave the same way. Budget time for fixing what they surface rather than only for building the harness.

They did. Phase 3's suites found three defects behind a fully passing 206-test suite: contract property validation was never wired into the guard, a state key written as a JSON Pointer skipped the reserved-namespace screen because the whole pointer became the root segment, and the alt-text repair could only read literal props, so it withheld cards in the one shape that occurs in practice. The pattern in all three, and in both phase 2 bugs, is the same: the code checked one representation of a thing that arrives in several.

## Stack

pnpm workspaces, no Turborepo (four workspaces does not need a task graph). Vitest for tests, Playwright for the demo smoke test. Next.js App Router and Tailwind for the demo. Node 20+, ESM only. Web Streams for the transform.
