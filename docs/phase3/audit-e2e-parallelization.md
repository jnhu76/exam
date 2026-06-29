# S9 — E2E Parallelization Constraints Audit

> **Date:** 2026-06-29
> **Branch:** `phase3/role-check-audit`
> **Purpose:** Pin down the real reasons E2E cannot raise Playwright `workers`, map the shared-seed / shared-candidate / shared-attempt collision surface, and recommend split options for the future Large/Middle E2E parallelization work (L10 / M10). Pure documentation — Playwright workers unchanged, seed untouched, no worker DB created.

---

## TL;DR

- **Playwright `workers` is hard-locked to `1` with `fullyParallel: false`.** This is *intentional and documented* in `playwright.config.ts` — the comment explains that raising `workers` would share one DB/server across workers and collide.
- **Parallelism is achieved a different way: sharding, not workers.** Both paths already exist:
  - **CI** runs a 2-shard matrix (`shardIndex: [1,2]`); each shard is a **separate GitHub Actions job with its own postgres service container**, so each shard gets its own `exam_e2e` DB + server + seed. **No cross-shard DB sharing in CI.**
  - **Local (WSL)** `run-wsl.sh` with `E2E_WORKERS>1` spins up N independent `exam_e2e_w{i}` DBs + API servers (one per shard), again fully isolated.
- **Within a single shard (one DB, one server, `workers=1`), specs run in file-declaration order.** The real collision risk lives *inside* one shard: specs that read/write the **shared demo seed** (`candidate1..4`, the admin account, global audit-log rows).
- **Good news:** **15 of 17** specs **seed their own unique candidate** (`seedExam` → timestamped `e2e-<spec>-<stamp>` username) before writing. So cross-spec candidate/attempt collisions are mostly avoided *by convention*, not by isolation.
- **Residual collision surfaces** are narrower than they first appear: (1) the shared `admin` account and global tables (audit logs, exam/course namespaces) touched by `audit-log` / `admin-flow`; (2) the read-only `demo-seed-accounts` spec that asserts fixed demo-seed state; (3) global uniqueness constraints (exam title, course code) that specs already work around with timestamps. As §5 shows, most of these are **soft** risks (assertions happen to be count-tolerant), not hard blockers.

---

## 1. Playwright Configuration

**File:** `apps/e2e/playwright.config.ts`

```ts
const workers = Number(process.env.E2E_WORKERS_PER_SHARD) || 1;
const shardTotal = Number(process.env.E2E_SHARD_TOTAL) || 0;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,     // ← file-level serial
  workers,                  // ← 1 by default
  retries: 0,
  reporter: shardTotal > 1 ? [["blob", ...]]
                       : CI ? [["list"]] : [["list"], ["html", ...]],
  use: { baseURL, trace: "retain-on-failure"|"off", actionTimeout: 15_000, ... },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

### 1.1 The config's own rationale (verbatim, lines 5-11)

> Worker count is configurable so E2E can run serially (local default) or in parallel via run-script sharding (E2E_WORKERS>1). NOTE: parallel execution is NOT enabled by raising Playwright `workers` here — that would share one DB/server across workers and collide on candidate1/audit-log state. Parallel mode instead launches N independent Playwright shards (run-wsl.sh), each with its own `exam_e2e_w{i}` DB + API server. `workers` stays 1 per shard so each shard's files run in their declared order (file-level serial respected).

**So the constraint is already understood and the workaround (sharding with per-shard DB) already implemented.** This audit documents the *why* in detail and scopes the residual in-shard collisions.

### 1.2 Why `workers=1` is required (the actual mechanism)

Playwright `workers > 1` runs test files **in parallel against the same `baseURL`**. The E2E harness points every worker at one API server backed by one DB. There is no per-worker DB routing in the Playwright layer. Two workers hitting the same server would:
- race on the shared demo-seed candidates (`candidate1`'s in_progress attempt),
- interleave audit-log inserts (breaking the deterministic row-count assertions in `audit-log.spec.ts`),
- contend on global-unique columns (exam title, course code, username) causing random 409s.

Sharding avoids this because each shard is a *separate Playwright process* with its own `E2E_BASE_URL` → its own server → its own DB. The isolation is at the process/DB level, below Playwright's worker model.

---

## 2. Two Execution Paths (both already sharded)

### 2.1 CI path — `.github/workflows/ci.yml` `e2e` job

```yaml
strategy:
  fail-fast: false
  matrix:
    shardIndex: [1, 2]
    shardTotal: [2]
services:
  postgres: { image: postgres:18.4-bookworm, env: { POSTGRES_DB: exam_e2e, ... }, ports: ["5432:5432"] }
env:
  DATABASE_URL: ...exam_e2e
  E2E_SHARD_TOTAL: ${{ matrix.shardTotal }}
steps:
  - db:migrate
  - db:seed:e2e                # each job seeds its OWN fresh exam_e2e
  - start API server (localhost:3000)
  - playwright test:e2e -- --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}
```

**Critical detail:** GitHub Actions gives **each matrix job its own service container**. So shard 1 and shard 2 each get a *brand-new* postgres + `exam_e2e` + seed. **The two CI shards do NOT share a database.** The only thing they share is the source checkout. This is correct isolation; CI parallelism is safe today and already halves wall-clock vs. a single shard.

Reporter: `E2E_SHARD_TOTAL=2` → blob reporter → merged by a later `merge-reports` step.

### 2.2 Local/WSL path — `scripts/e2e/run-wsl.sh`

`E2E_WORKERS` (default 1, capped at 16) controls shard count:

- `E2E_WORKERS=1` (default): single `exam_e2e` DB + single server, `workers=1`, reseeded every run (idempotent baseline+demo seed). `--no-reseed` skips reseeding.
- `E2E_WORKERS>1`: for each shard `i` — creates `exam_e2e_w{i}` DB, migrates + seeds it, starts an API server on `E2E_WORKER_BASE_PORT+i`, then runs `playwright test --shard=i/N` against that server. **Per-shard DB isolation**, same model as CI but on the host's single postgres container.

Cleanup: `drop_db_if_allowed` drops worker DBs unless `E2E_KEEP_WORKER_DB_ON_FAILURE=1`.

**Both paths converge on the same invariant: one shard = one DB = one server = `workers=1`.**

---

## 3. Seed Model — What's Shared vs. What's Unique

### 3.1 Baseline + demo seed (`apps/api/src/e2e-seed.ts`)

Every shard seeds the **same deterministic baseline + demo data**:

| Account | Username | Password | Demo-seed state |
|---------|----------|----------|-----------------|
| Admin | `admin` | `admin123` | — |
| Candidate (baseline) | `candidate` | `candidate123` | — |
| Demo | `candidate1` | `candidate123` | `in_progress` / resume |
| Demo | `candidate2` | `candidate123` | `available` / start |
| Demo | `candidate3` | `candidate123` | `disrupted` (resumable) / resume |
| Demo | `candidate4` | `candidate123` | `graded` / view_result |

Plus demo courses, exams, and `candidate1`'s in_progress attempt. This is the **shared read baseline** every spec depends on. Because each shard reseeds it identically, the baseline is *shared within a shard* but *isolated across shards*.

### 3.2 Per-spec unique data — `apps/e2e/lib/seed.ts` `seedExam` / `seedCandidate`

Every write-heavy spec calls `seedExam(request, "<unique>", {...})`, which:

```ts
const stamp = `${Date.now()}`;
const username = `e2e-${unique}-${stamp}`;        // globally unique
const candidateName = `E2E Candidate ${unique} ${stamp}`;
const candidateNo = `E2E-${unique}-${stamp}`;
// creates candidate via adminPost, then exam + questions
const examTitle = `E2E-${unique}-${Date.now()}`;   // globally unique
const code = `E2E-${unique}-${Date.now()}`;        // globally unique course code
```

**All uniqueness is timestamp-derived.** So two specs (or two runs of the same spec) never collide on username, candidateNo, exam title, or course code. The spec then logs in as *its own* seeded candidate (`candidateLogin(page, seeded.candidate)`). This is the key convention that makes in-shard parallelism *almost* safe.

---

## 4. Per-Spec Data Profile — Who Writes What

| Spec | Own unique candidate? | Writes shared state? | Parallel-safe within a shard? |
|------|-----------------------|----------------------|-------------------------------|
| `candidate-happy-path` | ✅ `seedExam("happy")` | ❌ | ✅ |
| `submit-flush` | ✅ `seedExam("submit-flush")` | ❌ | ✅ |
| `save-submit-race` | ✅ `seedExam("race-...")` | ❌ | ✅ |
| `resume-attempt` | ✅ `seedExam("resume")` | ❌ | ✅ |
| `refresh-during-exam` | ✅ `seedExam("refresh")` | ❌ | ✅ |
| `disconnect-restore` | ✅ `seedExam("disc-restore")` | ❌ | ✅ |
| `deadline-crash` | ✅ `seedExam("deadline-crash")` | ❌ | ✅ |
| `fill-blank-e2e` | ✅ `seedExam("fill-blank")` | ❌ | ✅ |
| `multi-select-e2e` | ✅ `seedExam("multi-select")` | ❌ | ✅ |
| `double-click-start` | ✅ `seedExam("double-click")` | ❌ | ✅ |
| `result-publishing` | ✅ `seedExam(...)` | ❌ | ✅ |
| `manual-grading` | ✅ `seedExam("manual-grading")` | ❌ | ✅ |
| `proctor-runtime` | ✅ `seedExam("proctor-runtime")` | admin force-submit on own attempt | ✅ |
| `proctor-monitoring-ui` | ✅ `beforeAll` seeds own data | ❌ | ✅ |
| `admin-flow` | ✅ `seedExam` (mixed) | **writes as `admin`**: courses/exams/candidates with timestamps; concurrency-tolerant assertions (`==0`, `>=2`) | ⚠️ **soft** (see §5.2) |
| `audit-log` | ❌ no own candidate | **writes as `admin`**: seeds an `exam.create` row (tolerated via `.catch`); count-tolerant assertions (`>0`, all-match, future=0) | ⚠️ **soft** (see §5.1 — effectively parallel-safe) |
| `demo-seed-accounts` | ❌ | **read-only**, per-card assertions via `exam-card-${examId}` (not list counts) | ⚠️ **soft** (see §5.3) |

**15 of 17 specs self-seed their own candidate** via `seedExam` (the 2 that don't are `audit-log` and `demo-seed-accounts`). Of those 17, **14 are in-shard parallel-safe** — the 3 that warrant care (`admin-flow`, `audit-log`, `demo-seed-accounts`) touch shared global state (the `admin` account / global tables / fixed demo-seed state). Note `admin-flow` *does* self-seed; it is flagged here for its shared-admin list-page assertions, not for lack of data ownership. As §5 shows, even these 3 are softer than they look.

---

## 5. Shared-State Collision Points (the real blockers)

### 5.1 `audit-log.spec.ts` — global audit table + admin account (SOFT, originally misread as HARD)

The spec logs in as the shared `admin`, and seeds an `exam.create` audit row (lines 29-34, wrapped in `.catch(() => {})` so a 4xx is tolerated). It then filters the global `audit_logs` table by action/targetType/date.

**On closer reading, the assertions are count-tolerant, not exact-count:**
- "views table" / "filters by action" / "filters by targetType": assert `count > 0` and "every visible row matches the filter" — both survive extra rows from a concurrent worker.
- "filters by date range": asserts `from=far-past → length > 0` and `from=far-future → length === 0`. The zero case is safe because no worker writes future-dated audit rows (`createdAt` is server `now()`).

So the real residual risk is small: the "every visible row matches filter" check assumes the filter UI returns only matching rows (server-side), which holds regardless of how many rows other workers inserted. **This spec is closer to parallel-safe than HARD-blocker.** The remaining caveat is shared-`admin` login contention (harmless — JWT is stateless) and the theoretical fragility if a future test adds an exact-count assertion.

### 5.2 `admin-flow.spec.ts` — admin writes (SOFT)

Logs in as shared `admin`, creates courses/exams/candidates via `seedExam` (timestamps → no 409s). Its list/count assertions are actually concurrency-tolerant on inspection: `toHaveCount(0)` waits for a candidate to be *absent* (a negative assertion, robust to extra rows from other workers), and the CSV export checks `lines.length >= 2` (a lower bound). So the *writes* and the *assertions* are both largely parallel-safe.

- The residual fragility is shared-`admin` semantics: concurrent logins are fine (stateless JWT), but if a future assertion depends on "admin has done X exactly once" or an exact row count, it would break. None do today.
- Verdict: effectively parallel-safe today; flagged SOFT because it depends on the *kind* of assertion staying lower-bound/negative.

### 5.3 `demo-seed-accounts.spec.ts` — fixed demo-seed state (SOFT, originally misread as HARD)

Pure read-only (for the candidate1..4 card-state assertions), and asserts the **fixed** `availabilityStatus` / `primaryAction` / `bestScore` of `candidate1..4`. The expected states live in `SEED_STATES` (lines 56-86); the helper `findExpectedSummary` / `expectUiSummary` is at lines 339-383; the loop that asserts them is at lines 415-441. Crucially, it locates each card by `getByTestId('exam-card-${examId}')` (line 371) — i.e. it targets the *specific* demo exam card, not a list row-count. So extra exams/candidates created by a concurrent worker on the list page do **not** break these assertions.

> Note: the file also contains a separate "exhausted 2/2" test (lines 443+) that creates its own candidate + exam and starts/submits attempts — so the *file* is not purely read-only, but the candidate1..4 fixed-state assertions it is characterized by are read-only and target the demo seed.

The only real risk is a *future* spec that mutates a demo candidate (`candidate1..4`) — none do today. So this spec is parallel-safe today; flagged SOFT because it encodes an implicit "no spec touches the demo seed" contract that isn't enforced anywhere.

### 5.4 Uniqueness columns (partially mitigated, partially convention-only)

The DB uniqueness story is **mixed**, not uniformly "globally unique":

| Column | DB constraint | Scope |
|--------|---------------|-------|
| `users.username` | `users_org_username_unique` on `(organizationId, username)` | **org-scoped** unique |
| `courses.code` | `courses_org_code_unique` on `(organizationId, code)` | **org-scoped** unique |
| `exams.title` | **none** — only two CHECK constraints (`latestStartOffsetMinutes >= 0`, `minSubmitAfterStartMinutes >= 0`) | **not unique at all** |
| `candidates.candidateNo` | **none at DB level** — `candidateNo` lives inside `candidateProfiles.fields` JSONB; the only uniqueness is an app-level `unique: true` flag on the `candidateFields` metadata row | app-level only |

So `username` and `courses.code` collisions are genuinely DB-prevented within one org, and specs timestamp-suffix them anyway (so same-ms seeds in two workers are the only residual risk). But `exams.title` has **no DB uniqueness** — two specs could create exams with the same title and the DB would accept it; the timestamp suffix is pure convention, not collision-avoidance. `candidateNo` uniqueness is enforced only at the candidate-import/validation layer, not by a DB index. The timestamp convention is load-bearing for `username`/`code` (DB would 409 on a same-ms collision) and for `candidateNo` (app layer would reject a duplicate); it is hygiene-only for `examTitle`.

---

## 6. `beforeAll` / `afterAll` / DB Reset

- **`beforeAll`:** only `proctor-runtime.spec.ts:32` and `proctor-monitoring-ui.spec.ts:20` — both seed their own unique data once per file. Safe.
- **`beforeEach`:** only `demo-seed-accounts.spec.ts:411` — resets browser context (not DB). Safe.
- **`afterAll` / `afterEach`:** **none.** No spec cleans up its seeded data.
- **DB reset between specs:** **none.** The DB accumulates state across the whole shard run. This is acceptable because (a) each shard starts from a fresh reseed, (b) specs use unique timestamped data, and (c) the few shared-state specs use count-tolerant/per-card assertions (§5) that survive the accumulated rows. There is **no per-test or per-spec truncation** in the E2E layer (unlike vitest's worker-DB isolation).

> **Implication:** within a shard, the DB only grows. A spec that depended on "the table has exactly N rows" (like `audit-log`) is permanently incompatible with in-shard parallelism unless reset-on-isolation is added.

---

## 7. Parallelization Options

### Option A — Per-worker database (the vitest model) — RECOMMENDED for full `workers>1`
Mirror vitest's worker-DB isolation: route each Playwright worker to its own DB (`exam_e2e_w{workerIndex}`), migrate+seed on worker init, truncate/drop on worker exit.
- **Pro:** enables true Playwright `workers=N` within one server/one shard; solves §5.1–5.3 by giving each worker its own audit table + demo seed.
- **Con:** Playwright doesn't natively route `baseURL` per worker; needs a worker-scoped fixture that picks a DB+server. Either spin a server per worker (heavy) or make one server multi-tenant on DB (requires API support for per-request DB selection, which the app does not have — it's single-tenant per server).
- **Verdict:** highest isolation, highest implementation cost. Best long-term target but a Large effort. This is essentially what the WSL `E2E_WORKERS` path already does at the *shard* level — promoting it to the *worker* level is the jump.

### Option B — More shards (incremental) — RECOMMENDED short-term
Raise CI `shardTotal` from 2 → 4 (or more) and WSL `E2E_WORKERS` correspondingly. Each shard is already fully isolated (own DB+server+seed).
- **Pro:** zero code change; linear speedup; the isolation machinery exists.
- **Con:** each shard pays full migrate+seed+server-start overhead; diminishing returns past ~4–6 shards; CI minutes cost. Spec distribution across shards is Playwright's default (round-robin by file), which is fine since specs are independent.
- **Verdict:** cheapest win. The L10/M10 report should recommend trying 3–4 shards before any code change.

### Option C — Read-only spec parallelism (partial)
Allow `workers>1` but mark write-heavy specs `test.describe.serial` and let only the read-only specs (`demo-seed-accounts`, parts of `audit-log`) run in parallel.
- **Pro:** modest speedup with small change.
- **Con:** `audit-log` *writes* (it seeds an exam.create), so it's not pure read-only; and per §5 the write-heavy specs are already concurrency-tolerant, so the read/write split buys less than it appears. Marginal value.
- **Verdict:** low value. Not recommended — Option B captures the same gain more simply.

### Option D — Unique-seed enforcement + assertion hygiene (targeted)
Double down on the timestamp convention and the count-tolerant assertion style: (1) add a lint/test that every write-heavy spec uses `seedExam` (no bare demo-candidate writes); (2) keep `audit-log`/`admin-flow` assertions lower-bound/negative/all-match (avoid exact-count), so they stay parallel-safe as the suite grows. With these in place, `workers>1` is safe for all 17 specs.
- **Pro:** addresses the root cause (shared global state + brittle assertions) rather than working around it; turns the SOFT risks in §5 into enforced non-risks.
- **Con:** requires discipline/lint to prevent future exact-count assertions from creeping back in.
- **Verdict:** good hygiene regardless, and the natural complement to Option B.

### Recommended sequence
1. **B first** — try 3–4 shards in CI/WSL; measure. Likely sufficient for current spec count.
2. **D as hygiene** — enforce the self-seed convention; keep shared-state assertions count-tolerant/per-card (no exact-count).
3. **A only if needed** — per-worker DB if shard count hits diminishing returns (≥6 shards). Treat as Large.

---

## 8. Spec-Distribution Reality Check

Playwright's `--shard=i/N` distributes **test files** round-robin, not by data affinity. With 17 spec files and 2 shards, each shard runs ~8-9 files. Because 15/17 specs self-seed and even the 2 shared-state read specs use count-tolerant/per-card assertions (§5), distribution does not matter for correctness — any spec can land on any shard. The 3 "warrant care" specs (`audit-log`, `admin-flow`, `demo-seed-accounts`) are safe *across* shards (each shard has its own DB), and—as §5 showed—are softer than HARD even *within* a shard. **There is no "must run on same shard" affinity today.** This is what makes Option B trivially safe.

---

## 9. Risk Summary

- **R1 — `workers>1` on one server would collide** on demo-seed candidates and global audit rows. This is why `workers=1` is locked. Resolved only by sharding (per-shard DB) or per-worker DB.
- **R2 — `audit-log` reads the global audit table.** Originally read as a HARD blocker; on inspection its assertions are count-tolerant (`>0`, all-match-filter, future-date=0), so it is **SOFT** — effectively parallel-safe today. Would only block if a future test adds an exact-count assertion.
- **R3 — `demo-seed-accounts` asserts fixed demo-seed state.** Read-only, per-card (not list-count), and no spec mutates demo candidates today → **SOFT**, parallel-safe. Encodes an unenforced "no spec touches the demo seed" contract.
- **R4 — No per-spec DB cleanup.** State accumulates within a shard; safe today because of self-seeding + count-tolerant assertions + fresh reseed per shard.
- **R5 — Timestamp uniqueness is load-bearing for some columns, hygiene for others.** `users.username` and `courses.code` are org-scoped DB-unique, so a same-ms seed across workers would 409. `exams.title` has **no DB uniqueness** (timestamp suffix is convention only). `candidates.candidateNo` has no DB unique index — uniqueness is app-level only. Worth a lint guard so specs keep the `${Date.now()}` suffix on the DB-unique / app-unique columns.
- **R6 — Shard startup overhead.** Each shard pays migrate+seed+server-start; this caps the useful shard count (Option B diminishing returns).

---

## 10. File Inventory

### Config / harness

| File | Role |
|------|------|
| `apps/e2e/playwright.config.ts` | `workers=1`, `fullyParallel:false`, sharding config, the rationale comment |
| `scripts/e2e/run-wsl.sh` | WSL sharding: per-shard `exam_e2e_w{i}` DB + server; `E2E_WORKERS`, `--no-reseed`, cleanup |
| `scripts/e2e/run.sh` | Docker-based E2E path (throwaway container volume, not host DBs) |
| `.github/workflows/ci.yml` (e2e job) | 2-shard matrix; **per-job** postgres service container → isolated `exam_e2e` per shard |

### Seed

| File | Role |
|------|------|
| `apps/api/src/e2e-seed.ts` | baseline (`admin`/`candidate`) + demo (`candidate1..4`) seed runner |
| `packages/db/src/seed.ts` | baseline seed |
| `packages/db/src/demo-seed.ts` | demo seed (candidates, courses, exams, candidate1 attempt) |
| `apps/e2e/lib/seed.ts` | `seedExam` / `seedCandidate` — timestamp-unique per-spec data |
| `apps/e2e/lib/flow.ts` | `candidateLogin(page, seeded.candidate)` — logs into the spec's own candidate |

### Specs (17)

See §4 for the per-spec data profile. Write-heavy (self-seeding): 14. Shared-state: `audit-log`, `admin-flow`, `demo-seed-accounts`.

---

## 11. Documentation References

| Doc | Content |
|-----|---------|
| `docs/phase3/job-cards.md` §S9 | This job card |
| `docs/phase3/job-cards.md` §M10 | The follow-on "E2E Parallelization Readiness Report" Middle job this feeds |
| `docs/phase3/plan.md` | Lists L10 (E2E parallelization Large) as deferred |
| `apps/e2e/playwright.config.ts:5-11` | The verbatim rationale for `workers=1` |
| `AGENTS.md` §Local Database Discipline | The `exam`/`exam_test`/`exam_e2e` three-DB contract (E2E reseeds `exam_e2e` only) |
