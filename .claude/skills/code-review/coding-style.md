# Exam TypeScript Coding Style — Review Heuristics

> Conceptual adaptation of [SGLang-Omni's coding-style guide](https://github.com/sgl-project/sglang-omni/blob/main/.claude/skills/code-review/coding-style.md) for Exam. This is a **review aid**, not an additional normative authority. The repository's `AGENTS.md`, `docs/standards/code-quality.md`, `docs/standards/testing.md`, Accepted ADRs, and frozen product/contracts take precedence.

## 1. Goal: small, correct, understandable changes

Optimize for correctness, explicit ownership, and lifecycle maintainability rather than minimum line count. Match established conventions and preserve existing contracts.

- Prefer an existing authoritative implementation over a second path, registry, adapter, DTO, config owner, or compatibility mechanism.
- Avoid speculative interfaces, factories, plugin frameworks, generalized utility packages, and wrappers with no real semantic benefit.
- A helper with one call site is valid when it owns a meaningful boundary (transaction, resource lifecycle, error classification, domain operation) or substantially reduces cognitive cost. Do **not** apply the upstream Python guide's "two call sites" rule literally.
- Do not deduplicate **independent validation** just because the conditions appear identical. Schema validation, authorization, state transition, transaction conflict detection, and database constraints protect different boundaries. Removal requires evidence proportional to risk (`AGENTS.md` §3).
- Do not impose an arbitrary 400-line split or an 80-line function cap. Exam's rule is **review structure when a file exceeds 2000 lines**; split by independent reasons to change, ownership, lifecycle, and testability, not mechanically.
- Touch only the authorized scope. A quality review can identify follow-ups without adding them to the current PR.

## 2. Names, units, and public contracts

Use established TypeScript naming: `camelCase` for local values/functions/methods, `PascalCase` for exported types/classes/React components, and existing conventions for constants/files. Do not import Python's `snake_case` rule.

- Name the domain meaning, not just the implementation role: `attemptId`, `serverVersion`, `receivedAtMs`, `deadlineAtMs`, `organizationId`, `saveOutcome`.
- Make units explicit for ambiguous measured quantities: `timeoutMs`, `durationMs`, `bytesWritten`. A bare `timeout` is ambiguous when seconds and milliseconds coexist.
- Familiar local conventions such as `ctx`, `req`, `tx`, `id`, or `db` can be reasonable in narrowly scoped, established APIs. Do not rename them mechanically.
- Respect HTTP JSON keys, database columns, persisted enum values, env names, generated types, library callback shapes, and externally visible contracts. An internal rename must not silently change wire/persistence behavior.
- Permanent source names describe **current purpose**, not campaign/phase/Issue IDs; see `docs/standards/code-quality.md` §17.1.

## 3. Types and trust boundaries

Follow `docs/standards/code-quality.md` §3 and the actual `tsconfig.base.json`. The repository uses strict TypeScript including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

- Prefer inference for obvious locals, and explicit types for public boundaries, non-obvious results, APIs, schema-derived contracts, and domain concepts. Unnecessary annotations are not a quality improvement.
- Use precise union/discriminated-union types when they represent real alternatives. Narrow with exhaustive branches, guards, or Zod parsing; do not manufacture default states that hide invalid data.
- Do not introduce `any`, `as any`, `!`, unsafe double assertions, or `@ts-ignore` to silence a contract mismatch. Existing uses deserve context-aware review, not indiscriminate churn. If an exceptional assertion is unavoidable, it must have a proven boundary/invariant and a clear reason.
- `unknown` is appropriate for untrusted input or caught exceptions, **but requires narrowing or schema validation before field access**. Prefer `z.infer<typeof Schema>` and the canonical `@exam/contracts` schemas rather than duplicate handwritten DTOs.
- Generics, `keyof`, indexed access, mapped types, and callback function types are legitimate TypeScript mechanisms when they preserve a real relationship. Do **not** transplant Python's ban on `Generic`, `TypeVar`, or `Callable`.
- Favor a domain-specific type or tagged result over a collection of unrelated booleans. Do not brand/cast an authorization or transaction capability into existence.
- A TypeScript type is **not** runtime validation. Trust boundaries still require authoritative schema/permission checks.

Example (untrusted boundary):

```ts
const payload: unknown = request.body;
const input = SaveAnswerInputSchema.parse(payload); // use the actual canonical schema/import
await saveAnswerCommand(context, input);
```

The names above are illustrative; reuse existing Exam functions and schemas, not new duplicates.

## 4. Control flow, modules, and dependencies

- Guard clauses and early returns are valid; **do not** require an `else` for every `if` or add `else { /* nothing */ }`.
- Keep the happy path obvious, but never erase important error, cleanup, ordering, or audit paths to make control flow shorter.
- Prefer one module for one cohesive responsibility, not one function per file. Avoid callback/closure extraction that obscures captured state or changes lifetime.
- Use static imports and `import type` where appropriate; `import()` is legitimate for an intentional lazy boundary. Do not adopt a blanket ban on imports inside functions from Python.
- Import shared types/behavior from the package that **owns** them; don't create cross-package re-exports, runtime dependency cycles, or duplicate schemas merely for shorter imports.
- Respect `docs/standards/code-quality.md` §6: `@exam/domain` as domain leaf, `@exam/contracts` for API DTOs, `@exam/exam-engine` for exam commands, repository for business data access, no server/database packages in `apps/web`.
- The actual `pnpm lint:arch` gate enforces **named bans**, not a global allow-list or full source-level cycle detector. Code review must inspect boundaries beyond those checks.

## 5. Ownership: domain, HTTP, repository, UI

- Fastify routes should orchestrate request parsing, canonical validation, context, and the right command/repository; do not put complex state transitions, grading, question snapshot rewrites, or direct table writes in routes.
- Repository calls must preserve `RequestContext` and organization scoping. Do not infer tenancy from user-controlled slugs or build a new multi-tenant mode.
- Exam/ExamAttempt transitions go through the domain command/engine and keep authorization, persistence, conflict and audit contracts intact.
- Server time is authoritative; client timers are presentation only. Published/start-of-attempt snapshots must remain frozen by later edits.
- Answer writes preserve version checking, idempotency, and conflict behavior. "Simplifying" a branch must not silently adopt last-write-wins.
- UI code should reuse `apps/web/src/components/ui/` primitives, shared components, and the existing typography/surface system; do not duplicate Radix focus/overlay primitives. Follow `docs/standards/ui-system.md` and `docs/architecture/frontend.md` for visual changes.
- A front-end permission guard is usability, **not** authoritative authorization.

## 6. Async, transactions, and resource lifecycle

TypeScript adds failure modes the source Python style document does not cover:

- Every launched Promise needs an owner: awaited, returned, intentionally supervised, or explicitly fire-and-forget with a real error/cleanup contract. Check lost rejections without pretending a nonexistent `no-floating-promises` lint gate runs.
- Cancellation and teardown must be consistent across timers, polling, listeners, database connections, transactions, worker tasks, and React effects. A `finally` block may be necessary even when it adds lines.
- Preserve transaction atomicity and connection/lock ordering. Never move database operations across transaction boundaries for the sake of a shorter helper.
- Do not infer that a transaction-bound repo handle becomes unusable after commit/rollback without runtime evidence; scrutinize escaped callbacks and capability provenance.
- Use deterministic barriers/deferred Promises/controlled clocks for ordering and timeout claims. Avoid sleep-based tests or timing guesses.
- Deduplication, at-least-once delivery, retries, and idempotency are **protocol choices**, not generic utilities to add preemptively.
- Review stale-result races and effect cleanup in React; avoid state updates from superseded requests. Respect framework hooks' real dependency and ownership rules rather than silencing lint comments.

## 7. Errors, logging, privacy, and configuration

Read `docs/standards/code-quality.md` §9–11 before modifying these areas.

- For domain/HTTP failures use the existing `AppError` hierarchy and unified response serializer. Startup configuration failures intentionally use ordinary `Error` and fail before request handling; **do not** manufacture a domain `ConfigurationError`.
- Catch only where an error boundary can classify, restore invariants, retry under an explicit policy, or report a failure. Never turn a failed operation into a fabricated success or swallow a rejected Promise.
- Resist broad `try/catch`, speculative fallbacks, redundant null checks against proven internal contracts, and undifferentiated "safe default" return values.
- Keep pino/Fastify structured logging; do not replace it with `console.log` or a second logging system. Record stable event fields with minimal sensitive content.
- Never log passwords, full tokens, full exam answers, complete identity fields, or sensitive personal data; verify redaction on error paths, E2E artifacts, and worker logs.
- Config has an existing authoritative source and admission path. Don't add duplicate environment reads, magic defaults, hardcoded deployment endpoints, or a second bootstrap validation mechanism.

## 8. Comments, documentation, and maintainability

- Comments should carry non-obvious `WHY`, `INVARIANT`, `OWNERSHIP`, `LOCK ORDER`, `PROTOCOL`, or `INTENTIONAL` reasoning. Do not narrate straightforward statements or write a historical incident log in production comments.
- Read and preserve nearby normative comments. A code cleanup that invalidates an invariant comment without updating it is a defect.
- Prefer executable types/schemas/tests for enforceable facts; avoid documentation that merely paraphrases source.
- Preserve license/attribution where required. Source comments must not carry irrelevant provenance/process slogans.
- Do not apply Python docstring/f-string/no-backticks rules to TS/TSX; use idiomatic JSDoc selectively where a public contract genuinely needs explanation.
- User-facing strings obey Exam's i18n copy policy. Do not hardcode school-, student-, course-, or institution-specific assumptions in production paths.

## 9. Tests and the difference between evidence and ceremony

Read `docs/standards/code-quality.md` §13.5, `docs/standards/testing.md`, and `AGENTS.md` §7.

- Every regression test should name the plausible code diff or behavior that would make it fail. Prefer reproducing a historical failure, proving a meaningful invariant, or preventing a real protocol/lifecycle regression.
- A test should assert the externally observable behavior or a meaningful boundary; do not only verify that a mock was called or restate a constant or implementation detail.
- Behavior-known bug/feature: establish a failing regression or independent witness before fixing when feasible. Unknown root cause, performance, concurrency, or runtime upgrade: measure/characterize first.
- Use Vitest for domain/unit/integration coverage, **real PostgreSQL** for SQL/transaction/repository behavior, and Playwright for browser-observable UI flows. The smallest sufficient test layer is best; not every fix requires E2E.
- Prefer deterministic clocks, barriers, explicit state transitions, and interleaving control over longer sleeps, timeouts, or unbounded retries.
- Keep CI meaningful. Do not skip tests, weaken assertions, replace real semantics with fake implementations, or raise retry counts merely to turn red green.
- Respect database ownership/isolation in `docs/standards/testing.md` §2.8, especially before migrations, cleanup, or launching DB/E2E commands.

## 10. Tooling: real enforcement, not invented rules

`docs/standards/code-quality.md` §1–5 classifies checks as **A (enforced), B (partial), C (review-only), D (not implemented)**. Re-check the current repo scripts before claiming a gate.

| Concern | Actual status at guide creation |
| --- | --- |
| Strict TypeScript through `pnpm typecheck` | A: configured as workspace typecheck scripts; does not prove runtime validation |
| Prettier through `pnpm format:check` | A: formatting; repo uses default Prettier, with Markdown ignored |
| `pnpm lint` | B: a limited text scan for `console.log`/`console.error`, **not general ESLint** |
| `pnpm lint:arch` | B: specified import/manifest/route/lifecycle/resolution bans, **not every dependency edge or cycle** |
| `pnpm lint:eslint` | A within its defined scope: `apps/web` UI rules and `react-hooks/rules-of-hooks` |
| `@typescript-eslint/no-explicit-any` / `react-hooks/exhaustive-deps` | no-op compatibility stubs in the web config, **not enforced** |
| `no-floating-promises`, `consistent-type-imports`, `no-unused-vars`, `import/no-cycle`, arbitrary complexity limits | D: no corresponding all-repo execution point; review manually if material |
| `any`/unsafe assertions, code cohesion, domain responsibility, privacy | C: required review, not a falsely claimed automated pass |

Relevant existing semantic commands (use current root `package.json` as source of truth):

```sh
pnpm format:check
pnpm lint
pnpm lint:eslint
pnpm lint:arch
pnpm typecheck
pnpm test
pnpm verify:static
pnpm verify
pnpm e2e
```

Run the smallest tests first and expand based on the change's risk and the repository's resource-safety contract. `pnpm verify` includes a real-PostgreSQL coverage lane and build checks; it does **not** itself include E2E. Do not add new tooling or rules merely because this guidance names a potential defect class.

## 11. Review checklist and acceptance

Use `docs/standards/code-quality.md` §16 as the **authoritative checklist**. At minimum verify:

- No duplicate `@exam/domain` / `@exam/contracts` types or avoidable `any`/casts.
- Route and repository boundaries, `RequestContext` and `organizationId` isolation.
- Domain commands, server time, immutable snapshots, versioned answer writes, and audit needs.
- Unified errors, safe logs, secure boundaries, and no hardcoded business scenario.
- Meaningful tests, justified dependencies, no uncontrolled async or resource escape.
- Every claimed gate is an actually run check with the correct A/B/C/D interpretation.

A P2 readability recommendation should identify a tangible long-term cost and why the smallest proposed diff reduces it. Do not refactor solely to satisfy a preference copied from another language.

After implementation, report the **five Job outputs required by `docs/standards/code-quality.md` §17**; remain explicit about unrun checks and residual risks.
