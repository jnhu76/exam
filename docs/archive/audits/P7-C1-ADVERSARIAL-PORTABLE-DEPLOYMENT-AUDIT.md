# P7-C1 / PR #273 — Adversarial Reality Audit

Repository: `jnhu76/exam`
Target PR: [#273](https://github.com/jnhu76/exam/pull/273)
Branch: `feat/p7-c1-portable-single-node-deployment`
Audit date: 2026-08-10
Audit method: adversarial attack/proof per the P7-C1 audit mission (do not assume PR text, tests, green CI, or comments are correct; falsify the claimed invariants with isolated runtimes; do not fix findings during the pass).

---

## 1. Baseline / PR head / CI state

| Item | Value |
|---|---|
| PR base SHA | `2a1a9eb30fc40a10d119571d4ad3befb5b52e26e` (`origin/master`) |
| Head at audit start (expected) | `11ff7d05268394e95d4d5dabae2537f975d6c523` |
| Head at audit end (HEAD moved — recorded per mission) | **`3bd2cab781398f055978da6c16276bc951589b47`** |
| Head movement | `11ff7d05 → 5c2b88aa (fix: drill seed-refusal assertion) → 3bd2cab7 (fix: uid-999 PGDATA pack/extract via sudo)` |
| Working tree at audit end | reverted to `master` by an external process during the audit (see §20.1); all product evidence was read via `git show <sha>:<path>` and built containers |
| Changed files (base..final head) | 43 |
| Main CI on final head | Static checks ✅ Build ✅ API/Web/Package coverage ✅ E2E shards 1/2 ✅ (all SUCCESS) |
| P7-C1 relocation drill (clean-host) on final head | **A: SUCCESS (all 9 steps), B: SUCCESS (all 10 steps)** — run `31324409704` |
| Drill on intermediate heads | `11ff7d05`: FAILURE (seed-refusal assertion, pipefail bug); `5c2b88aa`: FAILURE (pack tar permission, missing sudo) — both deterministic workflow bugs, fixed in-branch |

CI state note: the clean-host workflow is **red on the two earlier heads and green only on the final head**. The final head's green run is the only clean-host evidence; it is real and passed every step (see §12).

---

## 2. Scope and non-goals

Audited: C1.1 canonical data root, C1.2 image-only contract, C1.3 migration preflight, C1.4 relocation drills, C1.5 Redis non-authority, C1.6 launchpad, C1.7 docs/roadmap, plus P6 regression preservation. Not in scope (not implemented, correctly absent): C2 logical backup, C3 historical restore, PITR, retention, P7-E settings, Admin backup UI, Desktop/offline-first, HA, Kubernetes, generic job system. No production code was modified during the audit (temporary mutations were restored; §26).

## 3. Executive verdict

**DO NOT MERGE** — two P1 findings (A/B-class) must be corrected first:

1. **P1-1 — FRESH_INSTALL oracle is false for untracked non-fresh databases** (HYP-1 proven at runtime). Any DB with business tables/data but a missing or empty `drizzle.__drizzle_migrations` journal is classified `FRESH_INSTALL` (exit 0), and the subsequent migrate **silently applies nothing** (`42P07` from migration `0000`'s bare `CREATE TABLE` is swallowed by `migratePostgres`'s concurrent-worker tolerance), leaving the DB permanently untracked — every restart re-reports `FRESH_INSTALL` and future image upgrades will silently never apply (the exact C0 P2-1 "silently misbehaves" class the preflight was built to close).
2. **P1-2 — Relocation drill / Redis proof inherit `EXAM_DATA_ROOT` from the environment and can seed a real deployment** (demonstrated at runtime). The p6 smoke sets its own isolated root; the two C1 scripts do not. With `EXAM_DATA_ROOT` exported (the deployment docs' own layout), `pnpm drill:p7-c1-relocation` boots compose A against `${EXAM_DATA_ROOT}/postgres` and the entrypoint's `RUN_SEED=e2e` seed runs against the real deployment DB (default-credential accounts + demo data) before the drill's `FRESH_INSTALL` assertion fails.

A P2 finding (launchpad unusable through the documented ordinary path; see P2-1) and several P3s are also recorded. Clean-host relocation, image-only deployment, Redis non-authority, and first-Admin single-winner concurrency are otherwise proven (details below).

## 4. Claimed invariants — verdicts

| Invariant | Verdict |
|---|---|
| INV-C1-1 Canonical durable root = `${EXAM_DATA_ROOT:-./data}/postgres` | PARTIAL — bind-mount design and contract guards hold; two drill scripts can redirect the root via inherited env (P1-2) |
| INV-C1-2 Ordinary relocation recovers same state | PROVEN (local clean-root drill + clean-host CI run, byte-identical invariants + admin login) |
| INV-C1-3 Image authority | PROVEN (image-only compose, `EXAM_IMAGE:?` required, guards, identity layers documented) |
| INV-C1-4 Migration compatibility (fresh/normal/upgrade proceed; stale/divergent refuse) | FAILED for the FRESH_INSTALL branch (P1-1); NORMAL/FORWARD_UPGRADE/STALE/DIVERGENT branches verified correct on the real journal |
| INV-C1-5 Redis non-authority | PROVEN at runtime (proof script, Redis enabled, counters reset, business state identical) |
| INV-C1-6 Launchpad = first-install handoff, exactly one first Admin | PARTIAL — single-winner authority proven (incl. HTTP-vs-CLI); the launchpad itself is inert in the bundled compose (token never forwarded) |
| INV-C1-7 Launchpad never reopens | PARTIAL — holds for all supported operations (last-Admin removal/disable verified); reopens after hard-deleting org+users (operator corruption only) |

## 5. Canonical-data-root audit (Attack Area A)

Compose facts (SOURCE_FACT): production topology has zero named volumes; db binds `${EXAM_DATA_ROOT:-./data}/postgres`, redis binds `${EXAM_DATA_ROOT:-./data}/redis`; the topology contract refuses named volumes and missing binds (mutation tests M7/M8).

Script isolation matrix:

| Script | Overrides EXAM_DATA_ROOT? | Verdict |
|---|---|---|
| `p6-corr1-compose-smoke.sh` | Yes — sets `${REPO_ROOT}/.tmp-p6-smoke-data-<N>-<PID>` with strict prefix guard + export | SAFE |
| `p7-c1-relocation-drill.sh` | **No** (exports only POSTGRES_PASSWORD/JWT_SECRET/CORS_ORIGIN/PUBLIC_WEB_ORIGIN) | HAZARD (P1-2) |
| `p7-c1-redis-nonauthority-proof.sh` | **No** (same export set) | HAZARD (P1-2) |
| `.github/workflows/p7-c1-relocation.yml` | No, but runners have no EXAM_DATA_ROOT → default `./data` under RUNNER_TEMP project dirs | SAFE |

Demonstration (RUNTIME_PROOF):

```bash
# with EXAM_DATA_ROOT inherited:
EXAM_DATA_ROOT=/opt/real-deploy/data docker compose -f docker-compose.yml config
# → volumes: - type: bind  source: /opt/real-deploy/data/postgres
# unset:
docker compose -f docker-compose.yml config
# → source: /tmp/demo-drill/data/postgres
```

Attack scenario (static reasoning, non-destructive): operator exports `EXAM_DATA_ROOT=/opt/real-deploy/data` (the documented deployment layout) and runs `pnpm drill:p7-c1-relocation` from that shell. Drill A copies compose + writes `.env` (no EXAM_DATA_ROOT), boots with the seed override; compose resolves the bind to the **real** root; the real postgres starts on its existing PGDATA; entrypoint preflight classifies NORMAL (proceeds), migrate is a no-op, then `RUN_SEED=e2e` runs the canonical E2E seed **against the real deployment DB** (baseline admin/admin123 + candidate accounts + demo courses/exams/attempts). Only afterwards does the drill's `FRESH_INSTALL` assertion fail. Cleanup removes only the drill's temp base. Result: real deployment polluted with demo data and default-credential accounts; drill fails confusingly. The compose comment claims "smoke/drills override it to a unique temp dir for isolation" — false for these two scripts.

Dangerous-values check: `EXAM_DATA_ROOT=""` → `${VAR:-./data}` fallback applies (compose semantics), `EXAM_DATA_ROOT=/` and `./`-relative values are not validated by any script; `rm -rf` in both scripts is guarded by strict `.tmp-p7c1-` / `.tmp-p6-smoke-data-` prefix checks — no unvalidated `rm -rf`, no `docker system prune`. Empty-value handling: UNSAFE_BUT_OPERATOR_OWNED (the scripts' own cleanup is guarded; the hazard is the inherited-root bind).

## 6. Image/version authority audit (Attack Areas B, C)

Mutation matrix (all mutations restored):

| # | Mutation | Topology contract | Image/version contract | Caught? |
|---|---|---|---|---|
| M1 | `app` gains `build: .` | FAIL | FAIL | ✅ |
| M2 | `email-worker` gains `build: .` | FAIL | FAIL | ✅ |
| M3 | `EXAM_IMAGE:?...` → literal tag | FAIL | PASS | ✅ |
| M4 | postgres `18.4-bookworm` → `19.4-bookworm` | PASS | **PASS** | ❌ **no static oracle** |
| M5 | postgres → `latest` | PASS | FAIL | ✅ |
| M6 | redis `7.4.10-alpine` → `7-alpine` | PASS | FAIL | ✅ |
| M7 | db → named volume `pgdata` | FAIL | PASS | ✅ |
| M8 | db bind removed | FAIL | PASS | ✅ |

Identity semantics (SOURCE_FACT): docs distinguish OCI version label (metadata) / OCI revision (source provenance) / `EXAM_IMAGE` reference (the actual identity), recommend digest pinning for relocation, and the drill records `RepoDigests`. Docs never equate a mutable tag with immutable identity. PASS.

HYP-6 (PG-major drift): **TRUE** (mutation M4). `EXPECTED_PG_MAJOR = 18` in `apps/api/src/scripts/preflight.ts` and the compose `postgres:18.4-bookworm` are separate authorities with no CI/static synchronization oracle. The runtime preflight fails closed (`SHOW server_version_num` major ≠ 18 → refuse), so drift is survivable but only discovered at boot. Redis: exact-patch pin enforced by the image/version contract (M6 caught). P3 finding.

## 7. Migration-preflight adversarial audit (Attack Areas D, E)

### 7.1 FRESH_INSTALL oracle (D1–D4) — HYP-1: PROVEN TRUE

`runPreflight()` sets `isFreshInstall = true` when `to_regclass('drizzle.__drizzle_migrations')` is NULL **or** the journal has 0 rows — with no check on business-schema presence. Isolated PostgreSQL states (all via docker exec against throwaway DBs; never touched dev/prod data):

| State | Constructed as | Preflight outcome | migrate.js outcome |
|---|---|---|---|
| D1 truly fresh (no tables, no journal) | new DB | FRESH_INSTALL ✅ | applies 29 migrations ✅ |
| D2 business schema + data, journal dropped | migrate fully, `DROP SCHEMA drizzle CASCADE` | **FRESH_INSTALL (WRONG)** | **silent no-op: exit 0, "Migrations complete.", journal 0 rows** |
| D3 journal exists but empty + business data | same DB after D2 | **FRESH_INSTALL (WRONG)** | silent no-op |
| D4 partial restore (organizations/users/exam_attempts only, no journal) | new DB + 3 tables | **FRESH_INSTALL (WRONG)** | silent no-op (0 journal rows) |

Root cause (RUNTIME_PROOF + SOURCE_FACT): migration `0000_cultured_fantastic_four.sql` uses bare `CREATE TABLE` (no `IF NOT EXISTS`). On a tables-present DB, drizzle's per-file transaction throws `42P07 duplicate_table`; `migratePostgres` swallows `42P07` as "concurrent worker already applied" (`isDuplicateTableDuringMigration`); `migrate.js` prints "Migrations complete." and exits 0; the journal stays empty forever.

Consequence chain (first link runtime-proven, later links mechanical): every restart re-reports FRESH_INSTALL; a future image with new migrations will fail at 0000 again, so **new migrations never apply** while the app keeps starting — the silent-schema-drift hazard (C0 P2-1) the preflight was created to close. The docs claim ("an incompatible DB/image combination refuses to start instead of being silently mutated") is overstated: this dangerous state is approved and then silently NOT migrated. Classified: P1 (matches the P1 example "supported startup incorrectly classifies dangerous DB as fresh and mutates it" — here the mutation is a silent non-tracking no-op that permanently defeats future upgrades).

How D2-D4 states can arise: operator mistake, journal corruption, partial/dirty restore, old/manual deployment. The preflight's stated purpose is to refuse dangerous states, so these are in scope even though abnormal.

### 7.2 Membership/frontier algorithm (Attack E) — 13-case matrix on the REAL journal

Ran `classifyMigrationCompatibility` against the real bundled journal (29 migrations; verified backward `when`s for 0022/0024; no duplicate `when`s; allowlist tags match real tags — note the synthetic unit-test tag `0027_convergence` does NOT exist; the real tag is `0027_converge_skipped_migrations`):

| # | Case | Outcome | Expected |
|---|---|---|---|
| 1 | fully current DB | NORMAL | ✅ |
| 2 | forward upgrade (last missing) | FORWARD_UPGRADE | ✅ |
| 3 | DB ahead (future row) | STALE_IMAGE_DB_AHEAD | ✅ |
| 4 | hash mismatch at max when | DIVERGENT | ✅ |
| 5 | unknown older row | DIVERGENT | ✅ |
| 6 | missing non-allowlisted below frontier (0001) | DIVERGENT | ✅ |
| 7 | missing 0004 (allowlisted) | NORMAL | ✅ |
| 8 | missing 0022 (allowlisted) | NORMAL | ✅ |
| 9 | missing 0024 (allowlisted) | NORMAL | ✅ |
| 10 | historical omissions, converged (missing only 0004/0022/0024) | NORMAL | ✅ |
| 11 | converged after 0027 | NORMAL | ✅ |
| 12 | 0027 absent but 0028 present | **DIVERGENT** | ✅ |
| 13 | forged combo (0022 + 0003 missing) | DIVERGENT | ✅ |

Key adversarial question answered: allowlist holes are tolerated **only when the convergence migration (0027) is present** — a DB missing 0027 is DIVERGENT (case 12), so the "repair evidence" requirement holds implicitly. Docs do not claim schema-effect integrity (they describe journal-history compatibility), so no overclaim here. PASS.

## 8. Historical-migration exception audit (part of Attack E)

The `HISTORICAL_OMISSION_TAGS = {0004_wide_phantom_reporter, 0022_engine_policy_seam, 0024_breezy_tigra}` allowlist matches the real journal tags (verified). 0022/0024 `when`s genuinely predate 0021/0023 (real journal: 0022=1785253697471 < 0021=1787200000000; 0024=1785621462155 < 0023=1787600000000), so drizzle would skip them on converged DBs — the exception is justified by journal mechanics, not asserted by comment. Convergence evidence (0027) is implicitly required (case 12). PASS.

## 9. Launchpad authority audit (Attack Areas H, J, K, M, N)

### 9.1 Two command bodies (HYP-2): CONFIRMED — duplication without demonstrated divergence

`bootstrapInitialAdmin` (CLI adapter) and `bootstrapInitialAdminWithLock` (HTTP) are two ~60-line copies of the irreversible mutation (org resolve/create → first Admin → primary assignment → `admin.bootstrap` audit). Differences: the CLI path checks "active Admin count" (refuses unless `--force`); the HTTP path checks org/user existence under an advisory lock and never re-checks after its org INSERT resolves a conflict. Runtime concurrency evidence (§10) shows no correctness divergence under the supported adapters; the duplication is an authority hazard for future edits. P3 (per severity model: duplication without demonstrated divergence).

### 9.2 Crash atomicity (Attack M)

SOURCE_FACT: org → user → assignment → audit run in ONE `executeInTransaction` (default **repeatable read** + serialization-failure retry, `packages/db/src/types.ts`); the advisory lock is transaction-scoped (auto-release on commit/rollback). Any failure rolls back all four writes; no orphan states. The concurrency runs also demonstrate the loser leaves no partial state (single org/user/assignment/audit). Not fault-injected (would require code instrumentation); classified structurally proven.

### 9.3 Permanent completion (Attack J) — HYP-5: PARTIALLY FALSE

Runtime on a completed install:
- delete all users (org remains) → `/status` = COMPLETED; POST with correct token → 409. ✅ (also covered by `launchpad.test.ts`)
- **hard-delete org AND users (manual SQL) → `/status` = READY — launchpad reopens and bootstraps a new first Admin (runtime-proven: 201 after reopening).**

`isInstallationFresh` derives "ever existed" from **current** org/user existence (`SELECT 1 ... LIMIT 1` on each table). The docs' "permanently COMPLETED once any org/user has ever existed" is stronger than the persisted evidence. Reachable via supported runtime: NO (the only supported hard-delete is `DELETE /users/:id`; no organization delete endpoint exists; org persists → COMPLETED holds). Reachable via manual DB manipulation / future historical-restore interactions: yes. Classified: OPERATOR_CORRUPTION / FUTURE_INTERACTION → P3 (docs wording).

### 9.4 Setup-token oracle after completion (Attack K) — HYP-4: PROVEN TRUE

On a completed installation (`{"state":"COMPLETED"}`):

```text
POST /api/launchpad/bootstrap  wrong token   → 403 LAUNCHPAD_SETUP_TOKEN_INVALID
POST /api/launchpad/bootstrap  correct token → 409 LAUNCHPAD_ALREADY_COMPLETED
```

The route validates the token **before** the freshness check, so a completed installation discloses whether a guessed deployment secret is correct (distinct status codes; timing not meaningfully distinguishable over loopback). Token comparison is constant-time (`tokensMatch`), the token never enters logs/audit/OpenAPI (only the schema property `setupToken` exists in openapi.json, no example literal) or the frontend URL (body-only, component state only). Practical impact: the setup token is high-entropy and re-bootstrap is impossible, so the leak is not exploitable without a weak token — but the safe property ("completed installation should not validate/disclose deployment-secret correctness") is violated. Severity: P3 (cheap fix: freshness check before token comparison).

### 9.5 Rate limiting / Redis-required (Attack L)

- Route-level limit `{max: 10, timeWindow: 60s}` verified with Redis **disabled**: burst of 12 POSTs → 429s after the budget (in-memory store). ✅
- `REDIS_MODE=required` with unavailable Redis: the rate-limit plugin fails closed (`503 RATE_LIMIT_UNAVAILABLE`, DelegatingRateLimitStore) — a fresh install in that mode cannot reach bootstrap until Redis is healthy; this is the declared P7 contract (fail-closed), not a C1 regression. NOT_PROVEN by a live run; declared behavior per `plugins/rateLimit.ts` (SOURCE_FACT).
- `GET /api/launchpad/status`: two `LIMIT 1` probes per call, no amplification → P3 non-issue (recorded, no action).

### 9.6 Launchpad UI is not authority (Attack N)

`LaunchpadPage.tsx`: freshness from `GET /status` (server-authoritative), no role/organizationId fields, no auto-login (navigates to /login after success), token in body only, not persisted. `/register` → `403 AUTH_REGISTER_DISABLED` (runtime-proven). LoginPage does not advertise registration. PASS.

## 10. Launchpad concurrency matrix (Attack I)

| Pair | Deterministic seam | Result (4 runs) | Verdict |
|---|---|---|---|
| HTTP vs HTTP (different usernames) | unit test (`launchpad.test.ts` P2-5) | one 201 + one 409, exactly 1 user/org/audit | PROVEN |
| HTTP vs CLI | fresh DB + `BEFORE INSERT` trigger with `pg_sleep` on `organizations` as a deterministic barrier (polled `pg_stat_activity` for the in-flight INSERT before firing the HTTP request) | exactly one winner in every run; loser gets a coherent refusal (CLI: "An active Admin already exists"; HTTP: 409 ALREADY_COMPLETED or 201) | PROVEN — **HYP-3 FALSIFIED** |
| CLI vs CLI | same mechanism | single winner | PROVEN by mechanism (see below) |

Mechanism (SOURCE_FACT + RUNTIME_PROOF): the advisory lock is NOT what serializes cross-adapter races — `bootstrapInitialAdminWithLock` takes it, the CLI does not. The actual serialization is `executeInTransaction`'s **repeatable-read** isolation + the **`ON CONFLICT DO UPDATE` on `organizations.slug`**: a concurrent org INSERT against a row committed after the snapshot raises `40001 serialization_failure`; the retry loop re-runs the body, whose fresh/count check then observes the committed first Admin and refuses. Both directions were observed (HTTP wins → CLI refuses; CLI in-flight org INSERT → HTTP still wins the insert race → CLI refuses), always exactly one first Admin, never two. Note the invariant therefore rests on RR+retry semantics, not on the advertised "one lock" — worth a comment/test, but the property holds.

## 11. Launchpad secret-boundary audit

- `LAUNCHPAD_SETUP_TOKEN` never logged (no logging statement), never in audit metadata (audit stores username/name/source only), never in OpenAPI examples, never in frontend URL/query (body-only), not persisted by the page. PASS.
- **P2-1 (runtime-proven): the token never reaches the app container.** `docker-compose.yml` has no `LAUNCHPAD_SETUP_TOKEN` in any `environment:` block and no `env_file:`; the image has no `/app/.env`. Docs (portable guide §6/§7, runbook §5/§7, `.env.example`) instruct setting it **in `.env`** — Compose uses `.env` for interpolation only, so the container sees nothing. Verified: with the token in `.env`, container `LAUNCHPAD_SETUP_TOKEN=[UNSET]`, `/status` = OPERATOR_ACTIVATION_REQUIRED, POST = 403 LAUNCHPAD_SETUP_REQUIRED. The documented recommended first-install path cannot work; the operator must hand-edit the compose (undocumented) or use the CLI. P2 (material C1.6 readiness blocker; the launchpad deliverable is inert in the bundled deployment).

## 12. Relocation proof audit (Attacks O, P)

### 12.1 Clean-host (CI)

Final head `3bd2cab7` run `31324409704`: Job A steps 1–9 all success (build → boot fresh A with seed override → FRESH_INSTALL + seed-refusal assertions → record invariants → `down` (data preserved) → pack via **sudo tar** → upload); Job B steps 1–10 all success (download → extract via **sudo tar** → `docker load` → `compose pull db` → boot B ordinary path → preflight NORMAL, no seed ran → **invariants byte-identical** (migration count + per-table counts/md5) → seeded admin login works → teardown). Clean-host relocation: **PROVEN** at the final head.

Workflow history (important): the same workflow FAILED on `11ff7d05` (seed-refusal assertion under `set -euo pipefail` — the guard throws by design so `docker exec | grep -q` fails even when grep matches; reproduced locally) and on `5c2b88aa` (pack tar without `sudo`: PGDATA is 700/uid-999, runner uid 1000 → `Permission denied`; reproduced from the log). Both were fixed in-branch (`5c2b88aa`, `3bd2cab7`). At the audited HEAD the proof was therefore NOT_PROVEN; at the final head it is PROVEN. The two bugs are resolved but demonstrate the drill's fragility.

### 12.2 Clean-host without checkout (HYP-7)

Job B's checkout step is unused by the deployment: all B steps after download operate on `${RUNNER_TEMP}/bundle` + the extracted dir; no step reads `${GITHUB_WORKSPACE}`. The passing run on a fresh runner with only the bundle proves the deployment does not depend on checkout (deployment dependency: NONE; the checkout is verification-tooling-only in name and unused in practice). HYP-7: FALSIFIED (deployment independent of checkout).

### 12.3 Transport metadata (Attack P)

Pack: `sudo tar -czf` (root) on runner A; extract: `sudo tar -xzf` (root) on runner B → uid/gid (999), modes (700), and directory layout are preserved; the relocated postgres (uid 999) can read PGDATA — evidenced by B's successful boot + identical md5s (which also exercise the app, not just file presence). One passing run is evidence, not a universal guarantee — supported-host assumption documented: GitHub-hosted ubuntu runners with sudo + `docker compose pull db` for the pinned image. `docker save`/`load` transports the exact image bytes (tag + RepoDigests recorded in A).

## 13. Redis non-authority proof (Attack R)

`scripts/deployment/p7-c1-redis-nonauthority-proof.sh` executed end-to-end on the audited code (from a pristine /tmp export): **ALL CHECKS PASSED** — Redis profile ON with authenticated counters, business state captured (counts/md5), shutdown, relocation WITHOUT Redis state, restart with Redis ON, rate-limit counters reset, business state byte-identical, seeded admin login OK on first attempt. Redis non-authority: PROVEN. (Stale-Redis restoration was not separately executed; conclusion is limited to the proven reset behavior — labeled honestly.)

## 14. Regression-guard mutation tests (Attack T)

- Static guards: 7 of 8 mutations caught (§6); M4 (PG 18→19) not caught statically — P3.
- `verify:static` wiring: `verify-static-includes-guards.mjs` asserts `lint:repo-contract` ∈ `verify:static`; `package.json` chains both contract scripts into `lint:repo-contract`. Verified.
- Unit tests: `preflight.test.ts` (12 cases), `launchpad.test.ts` (8 + concurrency). CI API coverage SUCCESS on final head.
- Clean-host workflow triggers: `workflow_dispatch` + push to `feat/p7-c1-portable-single-node-deployment` only — **after merge the clean-host proof never runs automatically (HYP-8 TRUE)**; the permanent gate is the local clean-root drill (`pnpm drill:p7-c1-relocation`, manual) + static contracts. Classified: P3 coverage debt (deliberate, documented; but note the workflow required 3 commits to pass, so its "manual drill" value depends on it being run — recommend at least a scheduled/manual-on-master trigger).

## 15. Existing P6 deployment regression check (Attack S)

`p6-corr1-compose-smoke.sh` re-run against the PR-head compose (isolated temp root, own image build; local run needed `APP_PORT=3901` because the developer's `pnpm dev` holds host port 3000): **RUN #2: ALL CHECKS PASSED** — POSTGRES_PASSWORD required-expansion; Redis optional at parse; redis profile authenticated (requirepass, healthcheck PONG, startup guard without password fails); db→app→email-worker ordering; migration-once; worker heartbeat; bootstrap-admin single explicit Admin; login; no default Candidate accounts; production seed refusal; Redis absence does not block startup. Old P6 invariants: **PRESERVED**.

## 16. Documentation / operator usability

Wording bans: no "relocation == backup" (portable guide: "Do not use the relocation procedure as a backup/restore procedure"); no "raw PGDATA == version-independent backup" (PG-major caveat stated); no "Redis == authority" (both guides mark Redis non-authoritative); no "Launchpad == registration" (`/register` stays 403, launchpad first-install only); no "mutable tag == immutable identity" (§4 distinguishes the layers). Operator Q&A: data location ✅; down/down -v semantics ✅ (down preserves, down -v no-op on data, `rm -rf ${EXAM_DATA_ROOT}` destructive); relocation procedure ✅ (stop stack first — "PG stopped or fully flushed"); image identity ✅; Redis loss ✅; "./data copying ≠ historical backup" ✅ ("does not go back in time"); "recover yesterday's state" — no (C2/C3 not implemented) ✅; PITR — no ✅; first Admin ✅; setup-token holder ✅; launchpad after Admin removal ✅; preserve besides ./data — `.env` (compose + secrets) ✅.

Doc errors found:
- `portable-deployment.md` §5: "surfaced in `/api/system/diagnostics` as `preflightBypassed: true`" — **no such field exists in any code** (grep across apps/packages: only the WARN log line in `preflight.ts`). P3.
- "smoke/drills override it [EXAM_DATA_ROOT] to a unique temp dir for isolation" (docker-compose.yml comment) — false for the C1 drill and Redis proof (P1-2 companion).
- "permanently COMPLETED once any org/user has ever existed" — overstated vs. current-existence semantics (P3, §9.3).

## 17. Scope-leak check

No `pg_dump`/`pg_restore`/`pg_basebackup`/`archive_mode`/`archive_command`/PITR/retention/scheduler/backup artifact/restore command in runtime code (grep of apps/packages/compose/Dockerfile/entrypoint; hits are pre-existing "swallow/restore-command" attempt-recovery code and comments). Docs mention C2–C7/PITR strictly as future phases. No generic startup reconciler, job queue, Admin restore button, DB-backed backup settings, or Desktop code entered C1. **C2+ scope leak: NONE.**

## 18. Findings

### P0
None.

### P1

**P1-1 — FRESH_INSTALL oracle false for untracked non-fresh databases (HYP-1).**
- Invariant violated: INV-C1-4 (dangerous non-fresh DB must not be classified FRESH_INSTALL).
- Exact code: `apps/api/src/scripts/preflight.ts` (`isFreshInstall = table absent || 0 rows`); `packages/db/src/postgres.ts` (`isDuplicateTableDuringMigration` swallows 42P07); `packages/db/migrations/postgres/0000_*.sql` (bare `CREATE TABLE`).
- Reproduction: migrate a DB fully, `DROP SCHEMA drizzle CASCADE` (or truncate the journal; or create a 3-table subset) → run preflight → FRESH_INSTALL (exit 0) → run `node dist/scripts/migrate.js` → "Migrations complete." exit 0, journal 0 rows.
- Observed: approval of a non-fresh DB; silent no-op migration; app starts; every restart re-reports FRESH_INSTALL; future image upgrades will silently never apply.
- Expected: refusal (or a distinct "UNTRACKED_DB" outcome) for any DB with business-schema evidence and no journal.
- Impact: defeats the preflight's stated safety purpose (C0 P2-1); permanent untracked state + silent future upgrade drift.
- Smallest acceptable correction boundary: fresh-install oracle must include business-schema evidence (e.g., any known business relation present ⇒ not FRESH_INSTALL); classify as refuse until an operator decision (docs must not claim "refuses instead of being silently mutated" for this class).
- Required regression test: preflight integration test over D2/D3/D4 states asserting non-FRESH refusal; migrate test asserting a journal-less tables-present DB is not silently "complete".

**P1-2 — C1 drill / Redis proof inherit `EXAM_DATA_ROOT` and can seed a real deployment.**
- Invariant violated: INV-C1-1 (no authoritative state may secretly depend on a host-global root) / shared-test-data hazard.
- Exact code: `scripts/deployment/p7-c1-relocation-drill.sh` and `scripts/deployment/p7-c1-redis-nonauthority-proof.sh` (no EXAM_DATA_ROOT handling; compose uses `${EXAM_DATA_ROOT:-./data}`).
- Reproduction: `EXAM_DATA_ROOT=/opt/real-deploy/data bash scripts/deployment/p7-c1-relocation-drill.sh` → compose resolves db bind to `/opt/real-deploy/data/postgres` (demonstrated via `compose config`); drill A's entrypoint then runs preflight (NORMAL) + migrate + RUN_SEED=e2e seed against that DB before the FRESH_INSTALL assertion fails.
- Observed: real-root bind resolution (runtime-demonstrated); seed-before-assert ordering (code).
- Expected: drill forces its own isolated root (like the p6 smoke) or refuses to run when EXAM_DATA_ROOT is set to a non-temp path.
- Impact: default-credential accounts (admin/admin123) + demo data injected into a real deployment by a documented verification command; drill result meaningless.
- Smallest acceptable correction boundary: `EXAM_DATA_ROOT="$(mktemp -d ...)"` with a strict prefix guard (mirror the smoke) or an explicit `unset EXAM_DATA_ROOT` + assertion it is unset.
- Required regression test: drill run with EXAM_DATA_ROOT exported must fail fast (or isolate) and must never write outside its temp root.

### P2

**P2-1 — Launchpad unusable via the documented ordinary path (token never forwarded).** `docker-compose.yml` omits `LAUNCHPAD_SETUP_TOKEN` from the app environment (no `env_file:`); docs/`.env.example` say "set it in .env". Runtime: token in `.env` → container env unset → status OPERATOR_ACTIVATION_REQUIRED → POST 403 LAUNCHPAD_SETUP_REQUIRED. The C1.6 headline first-install path is inert in the bundled deployment; operator must hand-edit compose (undocumented) or use the CLI. Fix: forward `${LAUNCHPAD_SETUP_TOKEN:-}` in the app service environment (guarded by the topology contract), or document a required override file; add a smoke assertion that a token-bearing `.env` yields READY.

**P2-2 — Clean-host proof is historical-only after merge (HYP-8).** Workflow triggers: `workflow_dispatch` + the feature branch. Post-merge there is no automatic clean-host gate; a later PR can break relocation while ordinary CI stays green. Combined with the workflow's demonstrated fragility (3 commits to pass), the "permanent guard" claim should be re-scoped: either accept as documented manual drill (P3) or add a schedule/manual-master trigger. Recorded as P2 for the PR's "permanently guarded" wording; smallest fix is a docs statement + optional scheduled trigger.

### P3

- **P3-1** PG-major drift (HYP-6): compose tag ↔ `EXPECTED_PG_MAJOR` have no static oracle; runtime preflight fails closed (mutation M4).
- **P3-2** Docs claim `/api/system/diagnostics` surfaces `preflightBypassed` — field does not exist (only a log WARN).
- **P3-3** Launchpad token oracle (HYP-4): completed install distinguishes correct/wrong setup token (403 vs 409); constant-time compare, no logging; impact limited to weak tokens — fix by checking freshness before token validation.
- **P3-4** "Permanently completed once ever existed" (HYP-5) overstated: reopen after hard-deleting org+users (operator corruption; no supported path) — align docs wording with current-existence semantics.
- **P3-5** Duplicated bootstrap command bodies (HYP-2): no demonstrated divergence, but a maintainability/authority hazard.
- **P3-6** Clean-host gate is a manual drill post-merge (see P2-2 for the re-scoped classification if accepted as documented).
- **P3-7** `/api/launchpad/status` unauthenticated DB probes: two LIMIT-1 queries, no amplification — recorded, no action.

## 19. Unknowns / not-proven items

- Attack M crash injection (kill mid-transaction) not executed — structural proof only; the retry/409 behavior under real concurrency is runtime-verified.
- Stale-Redis restoration (restore old counters, observe over/under-limit) not executed — only the reset direction is proven.
- P1-2's full drill-run-against-real-root was NOT executed (deliberately non-destructive); the bind resolution is runtime-demonstrated and the seed-before-assert ordering is code-verified.
- D2-state "future upgrade silently never applies" is a mechanical inference from the runtime-proven silent no-op + the migrator loop semantics.
- `REDIS_MODE=required` + unavailable Redis at bootstrap: classified from the declared fail-closed store behavior, not a live run.

## 20. Exact commands and runtime evidence

All experiments ran on a local Docker engine with an image built from the audited tree (`exam-p7c1-probe:latest`), isolated temp data roots, and throwaway DB names (`p7c1_audit_d2/d4`, `p7c1_race3_db`, etc.). The developer's `exam`/`exam_test`/`exam_e2e` databases were never touched (the `exam` dev project running on port 3000 was left untouched; the p6 smoke was re-run with `APP_PORT=3901` for that reason).

Key evidence lines (see report body for full command context):
- `git rev-parse HEAD` before/after: `11ff7d05…` → `3bd2cab7…` (PR head moved; recorded).
- `gh pr view 273 --json statusCheckRollup`: final head all SUCCESS incl. "A — build + seed + pack" and "B — consume bundle + verify".
- `gh run view 31324409704 --json jobs`: A/B step-by-step SUCCESS (9/10 steps).
- Reproduction of CI seed-refusal failure at `11ff7d05`: `docker exec -e APP_MODE=production … node dist/seed.js 2>&1 | grep -q …` → pipeline exit 1 while `grep -c` finds the message (pipefail + expected non-zero exit).
- D2/D3/D4: preflight output `{"preflight":"FRESH_INSTALL",…}` on all three; `migrate.js` "Migrations complete." + `SELECT count(*) FROM drizzle.__drizzle_migrations` → `0`.
- `EXAM_DATA_ROOT=/opt/real-deploy/data docker compose config` → `source: /opt/real-deploy/data/postgres`.
- HYP-4: POST wrong → `403 LAUNCHPAD_SETUP_TOKEN_INVALID`; POST correct → `409 LAUNCHPAD_ALREADY_COMPLETED` (completed install).
- HYP-3: 4 concurrent HTTP-vs-CLI runs, always exactly 1 user/1 org/1 assignment/1 audit.
- HYP-5 hard case: `DELETE FROM organizations; DELETE FROM users;` → `/status` READY.
- P2-1: `.env` token set → `docker exec … printenv LAUNCHPAD_SETUP_TOKEN` → unset; status OPERATOR_ACTIVATION_REQUIRED; POST 403.
- `pnpm proof:p7-c1-redis-nonauthority` → ALL CHECKS PASSED; local drill → ALL CHECKS PASSED (clean-root); p6 smoke → ALL CHECKS PASSED (run #2).
- Mutation matrix §6 (all mutations restored; `git status` clean apart from pre-existing untracked logs).

### 20.1 Environment note
During the audit the repository working tree was reset to `master` twice by an external process (a concurrent local run of the drill/CI tooling left `.tmp-ci-fail*.log` in the tree). All evidence above is anchored to commit SHAs (`git show`), built images, and isolated containers — the tree resets do not affect the findings. The audit report itself is a new untracked file.

## 21. Merge recommendation

**DO NOT MERGE** until P1-1 and P1-2 are corrected with their required regression tests (P2-1's compose forwarding is a one-line fix that should ride along; P2-2 wording re-scope recommended). Everything else audited is proven or acceptable debt.

---

## 22. Required corrective actions (for the author, after human review)

1. **P1-1**: extend the fresh-install oracle with business-schema evidence; refuse untracked non-fresh DBs (new outcome or DIVERGENT); regression test D2/D3/D4. Optionally make the `42P07` swallow distinguish "concurrent worker" from "untracked DB" (fail loudly instead of "Migrations complete.").
2. **P1-2**: force an isolated EXAM_DATA_ROOT in both C1 scripts (strict temp prefix, mirror the p6 smoke) or refuse when a non-temp EXAM_DATA_ROOT is inherited; regression test with the env exported.
3. **P2-1**: forward `${LAUNCHPAD_SETUP_TOKEN:-}` in the app service environment (or documented override); smoke assert READY with token set.
4. **P3 fast-follow**: fix the `preflightBypassed` diagnostics doc claim (implement or reword); align "permanently COMPLETED" wording; consider freshness-before-token ordering on POST /bootstrap; document the clean-host gate's post-merge trigger semantics.

---

## Experiment matrix (required form)

| Attack | Expected result | Observed result | Evidence | Verdict | Severity |
|---|---|---|---|---|---|
| fresh DB | FRESH_INSTALL | FRESH_INSTALL, 29 migrations applied | drill A / D1 run | PASS | — |
| non-fresh DB without journal | refuse | **FRESH_INSTALL (exit 0)** | D2 preflight | **FAIL** | P1 |
| empty journal + business tables | refuse | **FRESH_INSTALL** | D3 preflight | **FAIL** | P1 |
| healthy current DB | NORMAL | NORMAL (29/29, frontier match) | audit-a preflight | PASS | — |
| forward upgrade | FORWARD_UPGRADE | FORWARD_UPGRADE | real-journal matrix #2 | PASS | — |
| DB ahead | STALE_IMAGE_DB_AHEAD | STALE_IMAGE_DB_AHEAD | matrix #3 | PASS | — |
| hash divergence | DIVERGENT | DIVERGENT | matrix #4 | PASS | — |
| historical 0022/0024 omission | NORMAL | NORMAL | matrix #8/9/10 | PASS | — |
| bad historical omission combo | DIVERGENT | DIVERGENT | matrix #6/13 | PASS | — |
| 0027 absent + 0028 present | DIVERGENT | DIVERGENT | matrix #12 | PASS | — |
| HTTP vs HTTP launchpad | 1 winner | 1 winner (201+409) | unit test + code | PASS | — |
| HTTP vs CLI bootstrap | 1 winner | 1 winner ×4 runs | race3 runs | PASS (HYP-3 falsified) | — |
| CLI vs CLI bootstrap | 1 winner | 1 winner (mechanism) | RR+retry analysis | PASS | — |
| wrong token (fresh) | 403 INVALID | 403 INVALID | runtime | PASS | — |
| correct token (fresh) | 201 | 201 + admin | runtime | PASS | — |
| completed + wrong token | no oracle | 403 INVALID (distinguishable) | runtime | **FAIL (oracle)** | P3 |
| completed + correct token | 409 | 409 ALREADY_COMPLETED | runtime | PASS | — |
| last Admin disabled/removed | stays COMPLETED | COMPLETED, 409 on POST | runtime + unit test | PASS | — |
| hard-delete org+users | stays COMPLETED (claimed) | **READY — reopens** | runtime | **FAIL (claim)** | P3 |
| bootstrap crash before commit | rollback, no orphans | structural (single tx, RR+retry); 409 on loser | code + concurrency runs | PASS (structural) | — |
| container recreation | same state | NORMAL on re-boot | drill B / audit-a re-runs | PASS | — |
| local clean-root relocation | identical | ALL CHECKS PASSED | drill run | PASS | — |
| clean-host relocation | identical | ALL CHECKS PASSED | CI run 31324409704 | PASS | — |
| clean-host without checkout | succeeds | succeeds (no checkout file consumed) | workflow inspection + pass | PASS | — |
| Redis-enabled relocation w/o Redis state | counters reset, state identical | ALL CHECKS PASSED | proof run | PASS | — |
| old P6 Compose smoke | P6 invariants hold | ALL CHECKS PASSED | smoke run #2 | PASS | — |
| compose app gains build: | guard fails | FAIL/FAIL | M1 | PASS | — |
| email-worker gains build: | guard fails | FAIL/FAIL | M2 | PASS | — |
| EXAM_IMAGE requirement removed | guard fails | FAIL | M3 | PASS | — |
| PG 18→19 (minor pin) | guard fails | **PASS/PASS** | M4 | **FAIL (no static oracle)** | P3 |
| PG floats to latest | guard fails | FAIL | M5 | PASS | — |
| Redis floats | guard fails | FAIL | M6 | PASS | — |
| db returns to named pgdata | guard fails | FAIL | M7 | PASS | — |
| canonical data bind removed | guard fails | FAIL | M8 | PASS | — |

## Special hypotheses

| Hypothesis | Verdict | Evidence |
|---|---|---|
| HYP-1 journal-less DB classified FRESH_INSTALL | **TRUE** | D2/D3/D4 runtime |
| HYP-2 two copies of the mutation body | **TRUE** (duplication) | code; no divergence demonstrated → P3 |
| HYP-3 HTTP serialized but CLI not (cross-adapter race) | **FALSE** | RR+retry serialization; 4 runtime runs single-winner |
| HYP-4 completed launchpad validates token first (oracle) | **TRUE** | 403 vs 409 runtime |
| HYP-5 "ever existed" stronger than evidence | **TRUE** | hard-delete reopen runtime |
| HYP-6 EXPECTED_PG_MAJOR vs compose tag unguarded | **TRUE** | mutation M4 |
| HYP-7 clean-host uses checkout in B | **FALSE** | no checkout file consumed; run passed |
| HYP-8 clean-host proof not a permanent gate after merge | **TRUE** | workflow triggers branch-only |

---

```
PR #273 P7-C1 ADVERSARIAL AUDIT — DO NOT MERGE

P0: none
P1: P1-1 FRESH_INSTALL oracle false for untracked non-fresh DBs (HYP-1, runtime)
     P1-2 C1 drill/Redis proof inherit EXAM_DATA_ROOT → can seed a real deployment
P2: P2-1 launchpad token never forwarded by compose (documented path inert)
     P2-2 clean-host proof historical-only after merge (HYP-8)
P3: P3-1..P3-7 (PG drift oracle, preflightBypassed doc claim, token oracle,
     "ever existed" wording, duplicated bootstrap bodies, manual-drill gate, status probes)

Portable data root:
  PARTIAL
Image-only deployment:
  PROVEN
Migration preflight:
  FAILED
Clean-host relocation:
  PROVEN (final head only)
Redis non-authority:
  PROVEN
Launchpad first-Admin authority:
  PROVEN
Launchpad cross-adapter concurrency:
  PROVEN
Launchpad permanent-close semantics:
  PARTIAL
Secret boundary:
  PARTIAL
Old P6 deployment invariants:
  PRESERVED
C2+ scope leak:
  NONE

Merge blockers:
  [P1-1 FRESH_INSTALL oracle, P1-2 EXAM_DATA_ROOT drill hazard]
```
