# EXAM #885 — REPRO (reproduction & evidence integrity)

This file records the **environment, exact commands, exit codes, timestamps, and SHA256
hashes** for every key artifact in the #885 evidence package, plus a complete recipe to
re-run the study from the frozen `BASE_SHA`. All experiments are **in-process, fake-clock,
fake-`db`** — no PostgreSQL was opened and no developer/production data was touched.

> **NON-PERSISTENCE NOTICE.** This package lives in a **local, detached research worktree**
> (`/home/hoo/Source/exam-885`, detached at `BASE_SHA`). It was **NOT committed or pushed**
> (the task grants no commit/push authorization). A worktree is ephemeral local state: if the
> directory or repository is removed, the evidence is lost. The **durable record** is the
> GitHub Issue #885 writeback comment. Re-running from `BASE_SHA` is fully specified below.

---

## 1. Environment (verified 2026-11-05T13:49:18Z, captured in `results/final-run.txt`)

| Item | Value |
| --- | --- |
| `BASE_SHA` / `git HEAD` of worktree | `f2d44b78136cda1358148dbce891590975d4c88f` |
| Main worktree `/home/hoo/Source/exam` | branch `master`, `git status --short` **clean (0 lines)** at baseline and at end |
| Research worktree | `/home/hoo/Source/exam-885` (detached at BASE_SHA) |
| Node | `v24.22.1` |
| pnpm | `11.1.2` |
| Vitest | `vitest/4.1.7` (`linux-x64 node-v24.22.1`) |
| OS | `Linux Hu 6.18.54.1-microsoft-standard-WSL2 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux` |
| Shell | zsh |
| Harness runner | `apps/api/node_modules/.bin/vitest` (from worktree root) |
| DB | **none** — fake `fastify.db` injected in-process; `globalSetup` deliberately absent from research configs |

Pinned constants (from real source at BASE_SHA, read by the harness, not redefined):
`OPERABILITY_MONITOR_INTERVAL_MS = 15_000`, `HEARTBEAT_SCAN_INTERVAL_MS = 30_000`,
`BUSINESS_FAILURE_TICK_THRESHOLD = 4`, `T0 = 2026-09-17T08:00:00Z`, `STEP_MS = 15_000`.

Research config `env` is name-safe only: `TEST_DATABASE_URL=postgres://exam:exam@127.0.0.1:5432/exam_test_885_inprocess`
(a syntactically valid URL for `resolveTestBranchUrl`; **no connection is ever opened**),
`JWT_SECRET=research-only-not-a-real-secret-885` (a non-real placeholder, never a real secret).

---

## 2. Commands actually executed (all from `/home/hoo/Source/exam-885`)

| # | Command | Exit | Timestamp (UTC) | Produces |
| --- | --- | --- | --- | --- |
| 1 | `git worktree add --detach /home/hoo/Source/exam-885 f2d44b78…` | 0 | 2026-11-05T13:12Z | frozen worktree |
| 2 | `apps/api/node_modules/.bin/vitest run --config apps/api/vitest.885.config.ts` (smoke) | 0 | 2026-11-05T13:18Z | `results/run-transcript.txt` (first run) |
| 3 | `apps/api/node_modules/.bin/vitest run --config apps/api/vitest.885.config.ts` (full E0–E12) | 0 | 2026-11-05T13:24Z / canonical 13:49:21Z | `results/experiments.json`, `results/run-transcript.txt` |
| 4 | `node research/issue-885/harness/analyze.mjs` | 0 | 2026-11-05T13:25Z / canonical 13:49:22Z | `results/analysis.json`, `results/analysis-transcript.txt` |
| 5 | `apps/api/node_modules/.bin/vitest run --config apps/api/vitest.885.regression.config.ts` | 0 | 2026-11-05T13:26Z / canonical 13:49:26Z | `results/regression-transcript.txt` |

**Canonical final run** (`2026-11-05T13:49:18Z`, recorded verbatim in `results/final-run.txt`):

```
CMD1 full matrix — CMD1_EXIT=0 — 2 tests passed (2) — CMD1_TS=2026-11-05T13:49:22Z
CMD2 analysis    — CMD2_EXIT=0                     — CMD2_TS=2026-11-05T13:49:22Z
CMD3 regression  — CMD3_EXIT=0 — 67 passed (67)   — CMD3_TS=2026-11-05T13:49:26Z
```

- **CMD1** = ` vitest run --config apps/api/vitest.885.config.ts` → `experiments.test.ts` +
  `smoke.test.ts`: **2 files / 2 tests passed**, duration 3.07s. Writes `experiments.json`.
- **CMD2** = `node research/issue-885/harness/analyze.mjs` → reads `experiments.json`, writes
  `analysis.json`, prints the compact 20-row latency/count table (`analysis-transcript.txt`).
- **CMD3** = ` vitest run --config apps/api/vitest.885.regression.config.ts` → the **three
  EXISTING plugin suites unchanged** at BASE_SHA: `heartbeat.test.ts` (13),
  `deadlineScanner.test.ts` (10), `operabilityMonitor.test.ts` (44) = **3 files / 67 tests
  passed**. This is the control that the frozen #547/#862/#886 contract is intact and no
  product code was modified.

> **Historical receipt.** §2 and the canonical block above record the commands **as run on
> 2026-11-05**, with the two runner configs then located in `apps/api/`. The PR #896 scope
> diet later merged them into the bundle-owned
> `research/issue-885/harness/vitest.config.ts` (mapping: §4.4); the **live** commands are
> §5 below.

**Flaky / inconclusive marking:** none of the 5 commands was FLAKY. The full matrix was run
repeatedly with identical deterministic results (fake clock, no wall-clock sleeps, no DB).
The one item explicitly marked **INCONCLUSIVE** is a *real PostgreSQL* root-cause fault
(E3 uses a PostgreSQL-shaped `42703` error in the fake `db`; no real DB fault was injected) —
that conclusion rests on SOURCE_VERIFIED query-path difference, not a measured DB incident.

---

## 3. Aggregated measured evidence (from `experiments.json`, canonical run)

```
scenarios=20  steps=556  errorLines=337  throwTicks=218  settledTicks=538
real operability.* transitions=26  counterfactual events (A/B/C/D)=168
baseSha=f2d44b78136cda1358148dbce891590975d4c88f
generatedAt=2026-11-05T13:49:21.293Z
```

Decisive reproduction (E2/E3/E6, DB healthy): 9 consecutive throw ticks per loop, 18 monitor
samples with `pingFailDeltaSum = 0`, all ticks settled, `consecutiveFailedTicks` frozen at 0,
`stallState=healthy`, **ZERO** escalated `operability.*` events → `DB_HEALTHY_THROW_GAP = CONFIRMED`.

---

## 4. SHA256 of key artifacts

Computed 2026-11-05 on the canonical evidence. Paths relative to `/home/hoo/Source/exam-885`.
`sha256sum <file>` reproduces them. Document hashes cover the six named evidence files; the
`REPRO.md` hash is intentionally omitted (a file cannot contain its own hash — recompute it
with `sha256sum research/issue-885/REPRO.md`).

### 4.1 Evidence documents
```
077f44a76a06a3c9a35fe54dfe21363ffaff65a11a2971e5c30761c919b57be6  research/issue-885/RESULTS.md
48f774c5cb09e3b35cb05e45ac7eddd699eca7c0e731de9aa606b657089c14b2  research/issue-885/SOURCE_MAP.md
f087ec64ca04a5330a1b9c4c67fc2e851c9d3817fb1868dae8555effb9646cef  research/issue-885/EXPERIMENTS.md
e7eb5fb78a299436944972586a3c853d20ece2a0dc87b911310b850f90aa17db  research/issue-885/ALERT_SEMANTICS.md
7a18186237fb495bc53754a346cf524d966be3f8dc86d8d74d7f9112cef74055  research/issue-885/DECISION.md
```

### 4.2 Harness source & configs
```
fc8b4596ac0d18406db93cda5690b4ac2164cce80b7588709298dee38bd76009  research/issue-885/harness/experiments.test.ts
cd230e7d35ad328d54cd074e7caec8954dff3c220174b059eab5f218bf2df08f  research/issue-885/harness/smoke.test.ts
ab151ea8cd1ad1d6335afdf556ca4d1357ad9043126d76b8fd4fe6714f0a82e4  research/issue-885/harness/analyze.mjs
5b07d022c2e94335f8c5147a4c0e4fc4c792f7bb5a1f600ae463718668a0ff46 → **78ab922dec410be26775c065b7c39eefbf655c59be2287dd889fcf9c53aae9c9**  apps/api/vitest.885.config.ts
9f42d722fb236b598b65323274caae9a268e3c3b82819f68fce7e6a8d60979b9 → **8f0e94be45752ba97c953136bc59c92685e854b98dc6103b9509ce4ca62d36f1**  apps/api/vitest.885.regression.config.ts
```

> **Amendment (implementation PR #896, 2026-11-05):** both research configs gained
> `envDir: false` to satisfy the repository `check-env-surface` gate (#741); the
> values above are the amended files (old hash → new hash). Verified
> **behaviour-neutral**: the full 20-scenario replay against the implemented code
> is scenario-for-scenario identical with and without the amendment (0/20
> differences; `envDir` only disables implicit env-file admission, and both
> configs set `test.env` explicitly). Every other entry in §4 is the pre-fix
> study's byte-identical artifact. *(Both configs were later merged into the
> bundle-owned runner by the scope diet — see §4.4.)*

### 4.3 Machine-readable results & transcripts

> **Scope-diet note (2026-11-06):** these files are **regenerable outputs of one
> deterministic run** and are intentionally **not committed** to the product
> repository (see §4.4). The hashes below remain the **canonical receipts** of
> the run as it happened — re-run §5 at the pinned SHA and compare modulo
> `generatedAt`.
```
3f0045836f2ed0e28019afc6f8b0caff6b01eed4e25bf4c799a9a59284037aec  research/issue-885/results/experiments.json
99ee001857f8ad6b768640d819fc24c486f8686af612c3ccb1851c5c246476a8  research/issue-885/results/analysis.json
725e1de34b6ef12a6c83e35bdfa5653c1779f68e08c97ac9499e425c7efcdcb0  research/issue-885/results/final-run.txt
a0f9494f4f0103d5202445d7b99483c24f957394bd6fd5c986e3bea82ad9f185  research/issue-885/results/run-transcript.txt
ef2351177147c4acbb24d53195be91acae0813a8661b4e837c92d8e99864a574  research/issue-885/results/regression-transcript.txt
6a49f85d65232e11abc8dfcdb61f1965ebab487e27798c71315e649877c31ca2  research/issue-885/results/analysis-transcript.txt
4d2ca4360f834e5b4c509f020438c9b8fce6f9ef2a8683d25df4ba11f60f843f  research/issue-885/results/_matrix_rows.md
```

Artifact sizes (compact structured observations, NOT raw log dumps, caches, or DB snapshots):
`experiments.json` 657,195 B; `analysis.json` 228,023 B; transcripts ≤ 6,237 B each. No
oversized logs, dependency caches, or DB snapshots were created or added to Git.

### 4.4 Scope-diet amendment (PR #896, 2026-11-05)

The PR-diet review removed PR surface that does not need to live in the product
repository. The frozen hashes in §4.1–§4.3 stay canonical for the study **as it
was run**; migrated/reformatted artifacts map as follows, and the post-migration
replay receipt is appended to `POSTFIX_VALIDATION.md`:

| Artifact | Frozen (as run) | Current (this PR) |
| --- | --- | --- |
| runner `apps/api/vitest.885.config.ts` | `5b07d022…` → `78ab922d…` (envDir amendment) | **removed** — merged into `research/issue-885/harness/vitest.config.ts` `4f41c671…` |
| runner `apps/api/vitest.885.regression.config.ts` | `9f42d722…` → `8f0e94be…` (envDir amendment) | **removed** — merged into the same bundle-owned runner |
| `harness/experiments.test.ts` | `fc8b4596…` | `c9e265c9…` — prettier reformat + `mkdirSync` for the now-uncommitted `results/`; behaviour-neutral (replay receipt) |
| `harness/smoke.test.ts` | `cd230e7d…` | `c79296f5…` — prettier reformat only |
| `harness/analyze.mjs` | `ab151ea8…` | `948743df…` — prettier reformat + `mkdirSync` |

The two runner configs were the only Vitest configs under `apps/api/` that were
not product configs; following the repo's #304 precedent (research-only vitest
configs are temporary and do not belong in product directories), their `include`
sets now live in **one** config owned by this bundle. The reformat is mechanical
prettier formatting plus the `mkdirSync` lines.

The `results/` dumps are **not committed** (scope diet): they are one
deterministic study run — 30,025 lines, 89% of the PR's additions — fully
regenerable from the §5 recipe against the pinned SHA. The §4.3 hashes stay the
canonical receipts of the run as it happened.

**Post-diet replay receipt (2026-11-06**, scratch worktree at the diet commit,
deps symlinked per §5**):** migrated runner CMD1 **2 files / 2 tests**, exit 0;
**19/20 scenarios tuple-identical** to candidate C with **38/38** real
`operability.tick_failure` lines, E7 reproducing the documented INSTRUMENT
ARTIFACT (225000 unpatched → 330000 with the `POSTFIX_VALIDATION.md` §3
scaffold → **20/20**) — the reformatted harness is behaviour-identical to the
study instrument; `results/experiments.json` regenerated on the spot by the
same run; BASE_SHA clean-room control (bundle copied in per §5) **67/67**;
post-fix plugin suites through the same runner (DB-free) **75/75**.

---

## 5. Re-run from frozen BASE_SHA (clean-room recipe)

The worktree reuses the main checkout's installed dependencies via symlinks; nothing
is installed, no DB is started, and the main worktree is never modified. Run in a
scratch worktree, **not** the main checkout — the recipe writes regenerable files
under `research/issue-885/results/`, which is intentionally not committed.

```bash
# 0) From the main checkout — record baseline (read-only)
cd /home/hoo/Source/exam
git fetch origin master            # baseline: origin/master == f2d44b78…
git rev-parse HEAD                # expect f2d44b78136cda1358148dbce891590975d4c88f
git status --short                 # expect empty
BASE=f2d44b78136cda1358148dbce891590975d4c88f

# 1) Create a detached scratch worktree at BASE_SHA (no branch switch, no destructive ops)
git worktree add --detach /home/hoo/Source/exam-885-replay "$BASE"
cd /home/hoo/Source/exam-885-replay
git rev-parse HEAD                 # expect the same BASE_SHA

# 2) Reuse installed deps (worktrees do not carry node_modules). From the main
#    checkout (pnpm install must have been run there), symlink: the ROOT
#    node_modules (workspace tooling / hoisted bins), each workspace package's
#    node_modules, and — the load-bearing one — apps/api/node_modules INTO the
#    harness directory: the bundle-owned runner config and the harness tests
#    both resolve `vitest` / `fastify` by walking up from research/issue-885/
#    harness/, and pnpm's root has no top-level vitest. Vite may cache the
#    bundled config under node_modules/.vite-temp (gitignored, harmless).
ln -s /home/hoo/Source/exam/node_modules node_modules 2>/dev/null || true
for d in apps/api packages/*; do
  ln -s /home/hoo/Source/exam/"$d"/node_modules "$d/node_modules" 2>/dev/null || true
done
ln -sfn "$(pwd)"/apps/api/node_modules research/issue-885/harness/node_modules

# 3) Copy the research bundle in (only if the scratch worktree is at a BASE that
#    predates the PR): research/issue-885/harness/{experiments.test.ts,smoke.test.ts,
#    analyze.mjs,vitest.config.ts}. The workspace-resolution plugin
#    (config/workspace-resolution.mjs) and the three product plugins + tests come
#    directly from BASE_SHA — they are NOT modified.
#    Receipts: pre-diet hashes §4.1–§4.2; post-diet hashes §4.4.

# 4) Smoke test (config + fake-clock + pino time sanity)
apps/api/node_modules/.bin/vitest run --config research/issue-885/harness/vitest.config.ts \
  research/issue-885/harness/smoke.test.ts

# 5) Full measured matrix (E0–E12) — writes research/issue-885/results/experiments.json
#    (the harness creates the results/ directory; it is regenerable, not committed)
apps/api/node_modules/.bin/vitest run --config research/issue-885/harness/vitest.config.ts \
  research/issue-885/harness/

# 6) Derive latencies/counts — writes research/issue-885/results/analysis.json
node research/issue-885/harness/analyze.mjs

# 7) Control: three EXISTING plugin suites unchanged at BASE_SHA (expect 67 passed)
apps/api/node_modules/.bin/vitest run --config research/issue-885/harness/vitest.config.ts \
  apps/api/src/plugins/heartbeat.test.ts \
  apps/api/src/plugins/deadlineScanner.test.ts \
  apps/api/src/plugins/operabilityMonitor.test.ts

# 8) Confirm the main worktree is still clean, then discard the scratch worktree
cd /home/hoo/Source/exam && git status --short     # expect empty
git worktree remove --force /home/hoo/Source/exam-885-replay
```

**Determinism guarantees:** `vi.useFakeTimers({now: T0})`, `vi.advanceTimersByTimeAsync` in
fixed 15 s steps, a fake `fastify.db` returning the exact repo Drizzle chain shapes, and
`fileParallelism: false`. There are no `sleep`, no retries, no timeout inflation, and no
network. Re-running yields byte-identical `experiments.json` (modulo `generatedAt`) and the
same 20-row analysis table.

**What is real vs simulated in this harness:**
- **REAL (MEASURED):** the three product plugins (`heartbeat`, `deadlineScanner`,
  `operabilityMonitor`), their real `try/catch/.finally`, `lastSettledAt` stamping,
  `consecutiveFailedTicks` updates, `classifyLoopStall`, `classifyPersistentBusinessFailure`,
  `createOperabilityTransitionTracker`, and all pino JSON stdout lines. Faults enter through
  the real scanner tick entry via the injected `fastify.db`.
- **COUNTERFACTUAL (A/B/C/D):** pure classifiers over the measured telemetry; these are
  **hypotheses**, NEVER reported as delivered product behaviour. No product code was changed.

---

## 6. Evidence-class discipline & what is NOT claimed

- **MEASURED**: real plugin stdout/metrics/transitions and their latencies. Detection latency is
  measured from the **actual fault occurrence** in the fake timeline, not derived from threshold
  arithmetic.
- **SOURCE_VERIFIED**: facts read from BASE_SHA (call DAG, probe query path, freeze tests).
- **INFERRED**: reasoning over the two (e.g. the 4-scalar machine-work estimate for candidate C).
- **UNKNOWN / NOT CLAIMED**: **operator delivery latency** — no external watcher exists in the
  repo, so only stdout **event-production** latency is measured; do not say "operator notified".
  **Statistical miss/FP rates** — 20 deterministic scenarios cannot support a percentage;
  results are scenario-level. **Real PostgreSQL fault** — INCONCLUSIVE, not executed.
  **Plain ERROR logs are NOT treated as delivered active alerts** (they are outside the §3
  external-hook whitelist). Delivery, multi-instance aggregation, stdout loss, and log-shipping
  lag all remain UNKNOWN.

---

## 7. Boundaries honored

No product runtime code was modified; no `lastSettledAt` redefinition; no durable alert state or
DB schema; no new monitoring platform, env var, or tunable threshold in product; no product PR,
merge, release, or Issue close; #547/#862 historical decisions unchanged. The research verdict
(**GO_C — CONDITIONAL**) is a decision only, **not** implementation authorization.
