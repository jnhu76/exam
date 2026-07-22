# Audit — P3-M7 Redis Unavailable Fallback Guard

> **Date:** 2026-07-02
> **Type:** Audit / decision record (documentation only)
> **Job card:** `docs/phase3/job-cards.md` § "M7 — Redis Unavailable Fallback Tests"
> **Predecessor audit:** `docs/phase3/audit/audit-current-redis.md` (S5 baseline)
> **Verdict:** **DEFER — no meaningful Redis integration exists beyond diagnostics; document N/A.**

---

## Background

The original M7 card ("Redis unavailable fallback tests should prove Redis failure
does not corrupt PostgreSQL authoritative exam state") was written under the
assumption that Redis participates in exam-state flows. This audit re-checks
that assumption against the **current merged code** and determines the smallest
valid guardrail work — or whether the card is N/A for Phase 1.

**Hard constraints in force (from `AGENTS.md` and the M7/M2 cards):**
- Redis must remain a runtime cache / infrastructure dependency only.
- Redis must never be authoritative for exam state.
- Do not invent Redis features to satisfy an old card.

---

## 1. Current Redis usage map

Every Redis usage site in production code (`apps/api/src`, `packages`), verified
by `rg "fastify\.redis\."`:

| Site | What it does | File:line |
| --- | --- | --- |
| Diagnostics ping | `if (fastify.redis) { await fastify.redis.ping() }` → `redisStatus.connected / latencyMs` | `apps/api/src/routes/system.ts:267-273` |
| Redis plugin | Registers + decorates `fastify.redis: RedisClient \| null`; `null` when disabled | `apps/api/src/plugins/redis.ts:30-43` |

**That is the entire Redis surface.** One read-only `ping()` in diagnostics.
Zero writes, zero reads of exam/answer/score/attempt/presence/heartbeat/
rate-limit data anywhere in the runtime.

---

## 2. Current non-usage map

Redis is **NOT** used for any of the following (verified by grep — zero
`fastify.redis.` calls outside `system.ts`):

| Concern | Redis used? | Evidence |
| --- | --- | --- |
| presence | ❌ No | "conflicting presence source" is a Phase-2 contract comment only (`packages/contracts/src/proctorMonitoring.ts:24`); no implementation |
| heartbeat cache | ❌ No | `apps/api/src/plugins/heartbeat.ts` has zero Redis references; heartbeat writes PG (`exam_attempts.lastActivityAt`) |
| rate limit | ❌ No (in-memory) | `apps/api/src/plugins/rateLimit.ts` uses `@fastify/rate-limit` with an in-memory store — no Redis store |
| candidate start/resume/save/submit | ❌ No | `apps/api/src/routes/attempts.candidate.ts` has zero Redis references |
| answer persistence | ❌ No | answers go to PostgreSQL via `@exam/db` repos |
| final submit | ❌ No | PostgreSQL only |
| score | ❌ No | PostgreSQL only |
| audit log | ❌ No | PostgreSQL only |
| attempt status | ❌ No | PostgreSQL only |

---

## 3. Existing Redis unavailable behavior

| Scenario | Behavior | Evidence |
| --- | --- | --- |
| Redis disabled (`REDIS_URL` unset/empty) | Plugin decorates `fastify.redis = null`; diagnostics `if (fastify.redis)` is false → `connected:false, latencyMs:null` | `plugins/redis.ts:34`; `routes/system.ts:268-270` |
| Redis `ping()` throws | Diagnostics route catches → `connected:false, latencyMs:null`; never throws | `routes/system.ts:274-275` |
| Diagnostics overall | Never fails the response — degrades to `connected:false` | `routes/system.ts:267-275` |
| Candidate core flow | **Identical with or without Redis** — candidate routes never reference `fastify.redis`, so Redis being absent/throwing has zero effect on start/save/submit or PG state | grep: no `fastify.redis` in `attempts.candidate.ts` |

---

## 4. Existing tests

### Redis diagnostics tests (already present)
- **`apps/api/src/routes/system.test.ts`** — `reports redisStatus connected:false when redis ping throws` (added in P3-M5A). Injects a fake client whose `ping()` rejects, asserts `connected:false, latencyMs:null`.
- **`apps/api/src/routes/system.test.ts`** — the diagnostics shape test runs with the test app **not registering the Redis plugin** (`fastify.redis === undefined`), so it implicitly exercises the `connected:false` path.
- **`apps/api/src/routes/redis.test.ts`** — plugin lifecycle: `connects and decorates fastify.redis` (skips if unreachable), `decorates null when REDIS_URL unset`, `decorates null when REDIS_URL empty`, `closes connection gracefully`, test-prefix isolation.

### Candidate core flow tests (copyable patterns)
- **`apps/api/src/routes/attempts/candidate-start.test.ts`** — `POST /attempts/:examId/start` (201, `status: in_progress`, snapshot, deadline).
- **`apps/api/src/routes/attempts/candidate-save-submit.test.ts`** — save + submit flows.
- Harness: `buildTestApp` (`routes/testHelpers.ts`) + `buildSharedAttemptFixture` (`routes/attempts/attempts.testHelpers.ts`).
- **Critical fact:** `buildTestApp` does **not** register the Redis plugin → the candidate tests already run with `fastify.redis === undefined`, i.e. **with Redis effectively absent**. They assert PG-backed fields (`status`, `examId`, `candidateId`, `questionSnapshot`, `deadlineAt`).

### Patterns available to copy
- Diagnostics: fake-throwing redis client decoration (`system.test.ts` M5A pattern).
- Candidate PG guardrail: `ctx.app.inject` + candidate cookie + PG field assertions (existing `candidate-start.test.ts` pattern).

---

## 5. N/A items from the original M7 card

The original card listed these scenarios. Each is **N/A for Phase 1** because the
feature it guards does not exist:

| Original M7 scenario | Status | Why |
| --- | --- | --- |
| Redis client connect failed | ✅ Covered | `redis.test.ts` plugin lifecycle + `system.test.ts` ping-throws |
| presence write failed | ❌ N/A | No presence implementation |
| heartbeat cache failed | ❌ N/A | Heartbeat writes PG (`exam_attempts.lastActivityAt`); no Redis cache |
| rate limit fallback | ❌ N/A | Rate limit is in-memory `@fastify/rate-limit`; not Redis-backed |
| diagnostics degraded | ✅ Covered | `system.test.ts` ping-throws → `connected:false` |
| core PG state unaffected | ✅ Vacuously true | No exam-state code reads/writes Redis; existing candidate tests already run Redis-absent |

---

## 6. Minimal valid implementation plan

Because **no candidate flow touches Redis**, a "candidate flow with throwing
Redis" guardrail test is **vacuous** — it would pass today and prove nothing
the existing candidate tests don't already prove (they already run Redis-absent
and assert PG correctness).

### What is already done (no action)
- Diagnostics ping-failure test → **exists** (`system.test.ts`, M5A).
- Diagnostics Redis-disabled behavior → **implicitly covered** (test app has no plugin).

### Optional, tiny, non-vacuous polish (≤ a few lines)
- Add one explicit assertion in the existing diagnostics shape test:
  `expect(body.redisStatus.connected).toBe(false)` — makes the implicit
  Redis-absent path an explicit, named assertion. One line; optional.

### What must NOT be done
- Do **not** write a duplicate "candidate flow with Redis disabled" test —
  the existing candidate tests already run Redis-absent; a duplicate is vacuous.
- Do **not** wire Redis into any exam-state path to "make the guardrail
  meaningful" — that invents features and violates the "Redis is infra-only"
  constraint.
- Do **not** add presence / heartbeat-cache / rate-limit-Redis-store — all
  Phase 2+ or out of scope.
- Do **not** refactor the Redis plugin or diagnostics.

### Conclusion
**The smallest meaningful PR is: nothing (or at most the 1-line assertion above).
There is no real Redis integration left to guard in Phase 1.**

---

## 7. Scope traps

- Wiring Redis into candidate/answer/score/submit "to make the test meaningful" —
  violates "Redis remains runtime cache/infra only".
- Adding presence / heartbeat-cache / Redis-backed rate-limit — Phase 2+ / out of scope.
- Duplicating existing candidate tests as "Redis-disabled" variants — vacuous.
- Refactoring the Redis plugin or diagnostics diagnostics — out of scope for M7.

---

## 8. Revisit triggers

Re-open M7 (and write real fallback tests) when **any** of these land:
1. Redis becomes a heartbeat cache or presence store.
2. Rate limit switches to a Redis store (`RedisStore`).
3. Any candidate/answer/score/submit path gains a Redis read or write.
4. A resident email worker (`processDueEmails` daemon) stores job state in Redis.

Until then, Redis is a diagnostics-only dependency and the "PG authoritative
state unaffected by Redis failure" invariant holds **by construction**, not by
test.

---

## 9. Cross-references

- M7 job card: `docs/phase3/job-cards.md` § "M7 — Redis Unavailable Fallback Tests"
- S5 baseline audit: `docs/phase3/audit/audit-current-redis.md`
- Diagnostics implementation: `apps/api/src/routes/system.ts` (M5A), contract
  `packages/contracts/src/system.ts` (`redisStatus`, `emailStatus`)
- Diagnostics tests: `apps/api/src/routes/system.test.ts`
- Redis plugin: `apps/api/src/plugins/redis.ts`; tests `apps/api/src/routes/redis.test.ts`
- Candidate runtime tests: `apps/api/src/routes/attempts/candidate-start.test.ts`,
  `candidate-save-submit.test.ts`
- AGENTS.md constraints: "Redis must remain runtime cache / infrastructure
  dependency only"; M2/M7 non-goal "Do NOT make Redis an authoritative state source"
