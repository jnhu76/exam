# ADR-006 — Exam Time Authority

## Status

**Accepted.** The canonical time authority plugin (`apps/api/src/plugins/now.ts`)
already exists and is in use; this ADR records that decision as binding and
adds the structural rules that prevent regression.

> This ADR does **not** introduce a new clock. `fastify.clock.now()` must not
> be added. `apps/api/src/plugins/now.ts` and the `fastify.now()` decoration it
> provides are the single runtime clock API.

## Context

Exam time is core domain state in Phase 2: `openAt`, `closeAt`,
`deadlineAt`, `startedAt`, `submittedAt`, `lastActivityAt`, the deadline
scanner's scan instant, and audit event timestamps. These must not be derived
from a mix of frontend time, the test process wall clock, ad-hoc `new Date()`
inside routes, or SQL `now()` — otherwise admin lifecycle
(publish/open/close/archive), deadline auto-submit, and the P2B-J1/J2 E2E
suite become flaky and the 409 score/export gate can fire nondeterministically.

### What already exists (binding)

`apps/api/src/plugins/now.ts` decorates the Fastify instance with:

```ts
interface FastifyInstance {
  now: () => Date;
  setNowOverride(provider: (() => Date) | null): void;
}
```

- Production default: `now()` returns `new Date()`.
- Tests can inject a fixed clock via `setNowOverride`.
- Routes and scanners already call `fastify.now()` extensively
  (`routes/attempts.ts`, `routes/exam.ts`, `plugins/deadlineScanner.ts`).
- `packages/exam-engine` and `packages/domain` are Fastify-free and already
  receive `now: Date` as an explicit parameter (`examCommands.ts`,
  `attemptCommands.ts`, `grading.ts`, `timer.ts`,
  `candidateExamSummary.ts`).

So the authority model is already in place. This ADR formalizes it and closes
the remaining gaps where raw `new Date()` / `Date.now()` / SQL `now()` still
leak into business-time paths.

## Decision

The **application server clock**, surfaced exclusively as `fastify.now()`, is
the Phase 2 exam runtime time authority. The standard call chain is:

```txt
fastify.now()
  ↓
command({ now })
  ↓
domain policy / state machine({ now })
  ↓
repo query uses now parameter
  ↓
audit uses same now
```

### Binding rules

- `apps/api/src/plugins/now.ts` is the canonical time authority plugin.
- `fastify.now()` is the only allowed runtime clock API in the
  Fastify/API layer.
- `fastify.clock.now()` must not be introduced (no second clock).
- Each request captures **one** `now` when it performs time-sensitive business
  logic and threads it through that request.
- Each scanner tick captures **one** `now` and threads it through that tick.
- Commands receive `now` explicitly.
- Domain / state-machine / policy functions receive `now` explicitly.
- Repositories receive `now` for time-sensitive queries.
- Audit events caused by the same operation use the same operation `now`.
- Frontend / browser time is **never** authoritative for exam lifecycle
  decisions.
- DB `now()` / `CURRENT_TIMESTAMP` / `clock_timestamp()` /
  `transaction_timestamp()` must **not** be used for exam business-time
  decisions. (Drizzle `defaultNow()` on `createdAt`/`updatedAt` storage columns
  is a non-business storage stamp and is allowed — see Allowlist.)
- Do not mix the application clock and DB `now()` within the same business
  decision.

### Enforcement scope (zoned, not global)

The structural guardrail is **zoned**, not a global "ban every `new Date()`"
rule. The goal is to converge exam business time, not to eliminate all
wall-clock usage in the system:

| Zone | Rule |
| --- | --- |
| `packages/exam-engine`, `apps/api/src/routes`, deadline/heartbeat/attempt/extend/submit/score-export paths, state-transition audit | **Strict.** No raw wall-clock read; use `fastify.now()` (API/plugin layer) or an explicit `now: Date` param (engine/domain). The only exception is `plugins/now.ts`. |
| `packages/db/src/repository` | Short allowlist; every entry needs a reason. `baseRepo.now()` and org/settings repo usage are storage stamps only. |
| Frontend (`apps/web`), test polling/sleep loops, performance timing (`performance.now()`), non-authoritative reporting | **Out of ADR-006 scope.** Frontend time is display-only; test polling waits on a server signal; perf timing is not business time. |

`new Date(existingDate)` / `new Date(ms)` (date **construction/arithmetic**
from an existing instant) is not a wall-clock read and is not flagged — only
empty-arg `new Date()` is.

### Allowlist (raw time sources permitted, with reason)

| Path | Raw time allowed | Reason |
| --- | --- | --- |
| `apps/api/src/plugins/now.ts` | `new Date()` | Canonical `fastify.now()` implementation — the one place the wall clock is read. |
| `packages/db/src/repository/baseRepo.ts` | `now()` helper | `createdAt`/`updatedAt` **storage** stamps only; not a business-time decision. |
| `packages/db/src/repository/organizationRepo.ts` / `settingsRepo.ts` | `now()` (from baseRepo) | Organization/settings `updatedAt` storage stamps only (non-business). |
| `packages/db/src/repository/systemStatsRepo.ts` | `new Date()` | **Reporting/dashboard day-boundary only — NOT exam business time.** (1) reporting/dashboard only; (2) NOT used for exam lifecycle / deadline / submit / score-export gate; (3) NOT authoritative for candidate/admin runtime decisions; (4) TODO: future cleanup should derive `startOfDay` from `APP_TIMEZONE` or the org timezone explicitly. Carries an inline TODO. |
| `packages/exam-engine/src/answerProtocol.ts` | one resolved fallback | The single `state.now ?? new Date()` resolution; the API layer always supplies `state.now`, so the engine never reaches the fallback in production. |
| `apps/api/src/routes/export.ts` | `Date.now()` | Used only to generate a unique CSV download filename suffix (cache-busting); not a business-time decision. |
| `apps/api/src/routes/testHelpers.ts` | `new Date()` / `Date.now()` | Test/factory helpers (fixture generation, unique-id suffix); never asserts server business-time authority. |
| Test files (`*.test.ts`) / factories | `new Date()` / `Date.now()` | Allowed for fixtures/assertions; never used to assert business-time authority of the server. |
| `apps/web/**` | `new Date()` / `Date.now()` | Display / local UI only; never server authority. |

A structural test (`apps/api/src/runtime/time-authority.structural.test.ts`)
scans source text and fails the build if a raw wall-clock read appears outside
this allowlist in business paths.

## Runtime timezone (display only)

`APP_TIMEZONE` (default `Asia/Shanghai`) and the `TZ` / `PGTZ` env vars
configure **display, logs, diagnostics, and fixture readability**. They do
**not** change business-time comparison semantics.

- `openAt`, `closeAt`, `deadlineAt`, `submittedAt`, … are **absolute
  instants**; comparisons are instant-to-instant regardless of timezone.
- `APP_TIMEZONE` must be a valid IANA timezone (validated at startup via an
  `Intl.DateTimeFormat` probe; invalid values fail fast).
- Ambiguous abbreviations such as `CST` must not be recommended.

## Construction hard rule (binding)

Every time-sensitive operation must obtain `now` from `fastify.now()` exactly
once for the request/tick and pass it down explicitly:

```txt
request/tick
  -> const now = fastify.now()        (single capture)
  -> command({ now })                 (explicit param)
  -> policy / stateMachine({ now })   (explicit param)
  -> repo.method(ctx, ..., now)       (explicit param for time-sensitive queries)
  -> recordAudit(..., metadata)       (same operation now)
```

Any business path that reads the wall clock directly (`new Date()`,
`Date.now()`, SQL `now()`) instead of the threaded `now` is a bug.

## Non-goals

- No Redis.
- No MQ.
- No job queue.
- No distributed clock.
- No NTP management.
- No WebSocket / SSE.
- No new timing modes.
- No broad `createdAt` / `updatedAt` refactor.
- No full P2B-J2 publish/open/close/archive business hardening.
- No rename of `fastify.now()` and no second clock API.

## Consequences

- Positive: one authority for exam runtime time; the score/export 409 gate,
  deadline auto-submit, and audit ordering are provably consistent; tests can
  freeze time via `setNowOverride`; a structural test blocks regression.
- Negative: business paths must thread `now` explicitly — slightly more
  verbose than reading the wall clock inline. This is intentional and required
  for determinism.
- Neutral: ADR-001..004 stay `Deferred`; this baseline is synchronous HTTP +
  in-process scanner + DB-backed state, consistent with single-instance
  Phase 2.

## Alternatives considered

- **Introduce `fastify.clock.now()` as a new API.** Rejected — `fastify.now()`
  already provides exactly this with an injectable override; a second clock
  would split the authority and invite drift.
- **Make the DB the time authority (use SQL `now()` in business queries).**
  Rejected — it couples exam decisions to DB transaction timing and makes
  deterministic tests impossible. DB time is allowed only for storage stamps.
- **Capture `now` per call site instead of once per request.** Rejected — a
  single operation could then see two different instants (e.g. the gate reads
  `t1`, the audit reads `t2 > t1`), producing inconsistent decisions/records.
