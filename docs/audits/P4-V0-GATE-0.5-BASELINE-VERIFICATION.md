# P4-V0 — Gate 0.5 Baseline Verification

> **Job:** `P4-V0 — Gate 0.5 Baseline Verification`
> **Type:** Verification + evidence + report **ONLY**.
> **Production code modified:** `no`.
> **Branch:** `feat/rbac-reality-audit`
> **Tested commit:** `f2a7a806a1527db607e441012570ab9dd52f09bd` (`f2a7a80`)
>   — `docs(audit): p4-r0 mvp role switch reality audit …`
> **Verification date:** 2026-07-24
> **Authority chain read first:** `AGENTS.md`,
> `docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md` (the immediate Job
> authority / P4-B-01 owner), `docs/architecture/authorization.md`,
> `docs/status/implementation-status.md`,
> `docs/archive/phase3/RBAC-M10-F-FINAL-VERIFICATION-1.md` (the historical
> Gate 0.5 / M10-F evidence contract),
> `docs/adr/ADR-010-scoped-rbac-architecture.md`,
> `docs/archive/phase3/p4-mvp-rbac-route-matrix.md` (historical; superseded).

> **Revision: 2026-07-24 (corrective re-issue).** The initial P4-V0 report
> declared PASS but did **not** actually execute the repository's `pnpm verify`
> command (its §13.9 said components were "run individually"). The historical
> M10-F closure contract required `pnpm verify` as the explicit final gate, so
> this re-issue closes that evidence gap. Changes: `pnpm verify` was executed in
> full and **passed** (exit 0) — see §13.9; §13.3 and §13.4 file/test counts were
> corrected against real `vitest run` output (9→10 files / 92→151 tests in
> §13.3; 14→15 files / 178→272 tests in §13.4); every grouped suite in §13 now
> carries its exact command. The verdict remains **PASS**. No production code or
> tests were modified.

---

## 1. Executive Summary

P4-V0 is the **blocking preflight** that establishes a trustworthy pre-change
RBAC baseline before any P4-C corrective implementation begins. It re-runs the
Gate 0.5 / M10-F verification contract against the current code, produces the
normalized **runtime** route inventory (not merely a source-grep count),
classifies every runtime route by authorization mechanism, reconciles runtime
routes against `ROUTE_PERMISSION_REGISTRY`, and runs the required authorization
regression suites.

**The Gate 0.5 contract is met.** Every blocking check passes:

- The actual registered runtime route tree was captured via a Fastify `onRoute`
  hook over the full production composition (`registerApiRoutes`). It contains
  **131 raw registrations = 91 primary application routes + 40 auto-generated
  HEAD aliases** (one per GET). The 91 primary routes reconcile **exactly** to
  the contract's provisional `91 / 81 / 10` (capability-gated /
  authenticate-only + public).
- All **81 protected runtime routes are represented by
  `ROUTE_PERMISSION_REGISTRY`** with `MATCH` status — **0** `RUNTIME_ONLY`,
  **0** `REGISTRY_ONLY`, **0** `GATE_MISMATCH`, **0** `CAPABILITY_MISMATCH`.
- **0 active `requireRole` route preHandlers** and **0 active
  `requirePermission` route consumers** (verified both at source and at runtime
  via the captured preHandler classification).
- **0 runtime authorization decisions based on `users.role` or the JWT `role`
  claim**. `users.role` / JWT `role` are compatibility projections / drift
  telemetry only; `ctx.capabilities` (the assignment-backed union) is the sole
  runtime authority.
- Assignment-backed authority remains fail-closed (`no_active_assignments` →
  401; `db_error` / `subject_mismatch` / `unknown_role` / `zero_primary` /
  `multiple_primary` → 503; never falls back to `users.role`).
- Every required M10-F / Gate 0.5 and authorization regression suite passes.

The difference between the audit's source-level `91` and the runtime-captured
`131` is fully explained (the 40 Fastify-auto-generated `HEAD` aliases), and
the primary-route count reconciles exactly. No classification was manipulated
to preserve `91/81/10`; the observed runtime result is authoritative and it
happens to agree.

This Job does **not** implement P4-C1/C2/C3, does **not** modify any production
source, and does **not** declare P4 closed.

---

## 2. Verdict

```text
PASS
```

Justification mapped to the §12 PASS checklist is in §12 below. No blocker was
found. The one advisory anomaly (the dedicated score-capability gate carries no
`.authz` introspection metadata) is the **already-documented** M10-F exception
("80 metadata gates + 1 dedicated score gate = 81"); it is not a drift and is
proven at runtime by `scores.ts:416` and `scoreCapability.test.ts`.

---

## 3. Repository and commit baseline

```text
Branch:                feat/rbac-reality-audit
Tested commit:         f2a7a806a1527db607e441012570ab9dd52f09bd (f2a7a80)
Commit subject:        docs(audit): p4-r0 mvp role switch reality audit …
Commit author/date:    jnhu / 2026-07-24T02:20:57+08:00
Working tree at start: clean (git status --short empty)
Working tree at end:   only the new docs/audits/P4-V0-… report + the two
                       status-doc updates added by this Job (no production
                       source touched).
```

Initial repo checks (`git status --short`, `git branch --show-current`,
`git log -1 --oneline`) confirmed the expected branch was checked out with no
unrelated uncommitted production changes. No rebase, merge, push, or branch
switch was performed.

> **Corrective re-execution (2026-07-24).** This report was re-issued to close
> the `pnpm verify` evidence gap. At the start of the corrective pass the working
> tree held exactly the P4-V0 documentation changes above (`docs/status/…` and
> `docs/architecture/…` modified; this report untracked) and no production or
> test changes — confirmed by `git status --short`. `pnpm verify` was then run
> in full against the same commit `f2a7a80` (see §13.9). The verdict remained
> PASS; §13.3 and §13.4 file/test counts were corrected against real
> `vitest run` output.

---

## 4. Gate 0.5 contract found

The Gate 0.5 contract is **not invented**; it is located in the repository.
Applying the authority order of task §5 (current code/tests > current
architecture/status docs > accepted ADRs > current P4-R0 audit > archived
migration docs):

### 4.1 Contract identity

- **Name:** "Gate 0.5" = the **post-PR-197 rerun of the M10-F final
  verification**.
- **Original M10-F contract document:**
  `docs/archive/phase3/RBAC-M10-F-FINAL-VERIFICATION-1.md` — the historical
  PASS record (commit `94bc020`, branch `verify/rbac-M10-F`, 2026-07-20). It
  defines the 24 exit conditions, the route inventory method (Fastify `onRoute`
  capture over the shared composition), the legacy-residue checks, the
  registry/runtime parity table, the assignment-authority dataflow, and the
  fail-closed contract.
- **Why a rerun was required:** PR-197 (and the surrounding corrective series)
  invalidated the M10-F evidence. `docs/status/implementation-status.md` Known
  limitations and `docs/architecture/authorization.md` Gate 0.5 caveat both
  state Gate 0.5 is **PENDING** and blocks future RBAC-sensitive changes.
- **P4-R0 ownership:** `docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md`
  §13 files this rerun as **P4-V0** (Gap `P4-B-01`), a blocking preflight whose
  acceptance boundary is "Gate 0.5 re-run **PASS**; the unique route inventory
  (91/81/10) is formally accepted as the baseline."

### 4.2 Required commands / fixtures / environment

From M10-F §L and the P4-R0 acceptance boundary, the required verifications are:

```text
- Fastify onRoute route-tree capture over the full production composition
- ROUTE_PERMISSION_REGISTRY ↔ runtime reconciliation
- requireRole / requirePermission source + runtime sweep
- users.role / JWT-role authority sweep
- assignment-authority fail-closed suite
- routeRegistryConformance.test.ts (the direct Gate 0.5 artifact)
- the authorization regression suites named in M10-F §L
- APP_MODE=test, test database (exam_test) only, worker-database isolation
```

### 4.3 Expected PASS conditions (M10-F exit conditions, condensed)

```text
- 0 production requireRole consumers
- 0 production requirePermission consumers
- 0 users.role authority decisions
- 0 JWT-role authority decisions
- assignment union is the only human runtime authority
- registry/runtime authorization zero drift (81/81 gated routes)
- scoped resolver fail-closed
- cross-org and cross-owner boundaries hold
- last-effective-admin invariant holds
- full verify / authorization suites pass
```

### 4.4 Documents that must be updated after PASS

```text
docs/status/implementation-status.md  (Gate 0.5 PENDING → PASS)
docs/architecture/authorization.md    (Gate 0.5 caveat → PASS, re-verified)
```

### 4.5 Conflicts

No conflict between authority tiers. The historical M10-F document, the current
architecture/status docs, the P4-R0 audit, and the current executable code all
agree on the contract. The single historical-count difference (M10-F recorded
"1501 passed / 5 skipped"; the current suite is "1499 passed / 5 skipped") is
test evolution, not a contract conflict — the 5 skipped are the same
environment-gated Redis tests.

---

## 5. Runtime route inventory method

### 5.1 Harness

Per task §6.1/§6.2, P4-V0 preferred an existing app/test bootstrap and an
`onRoute` capture. The existing harness
(`apps/api/src/authz/routeRegistryConformance.test.ts`) already implements the
proven `classifyPreHandler` + `onRoute` capture, but it registers only the 17
route-plugin subset it asserts against (M10-A/B/C/D) — it does **not** expose
the full runtime tree including auth / self / public / proctor-monitoring /
client-events.

P4-V0 therefore built a **temporary** harness outside tracked source that
re-uses the **identical** classification logic and registers the **full**
production composition via `registerApiRoutes(app)` (the same function
`server.ts:117` and `openapi/swagger.ts` call). The harness:

1. builds a Fastify app and registers the production plugins needed so the
   authorization decorators exist and carry their `_isAuthenticate` /
   `_isRequireRole` / `_isRequirePermission` introspection tags and their
   `.authz` metadata (`fastifyCookie`, `setupSecurity`, `setupErrorHandler`,
   `zodProviderPlugin`, `authPlugin`, `authzScopedPlugin`);
2. attaches an `onRoute` hook that captures every registration with its full
   runtime URL and classified preHandler chain;
3. calls `registerApiRoutes(app)` — applying the real `/api` prefix (and
   `/api/auth` for auth routes);
4. deduplicates identical `(method, url)` rows (Fastify fires `onRoute` per
   encapsulated plugin) and prints the normalized inventory as JSON.

The temporary file lived at `apps/api/p4v0.route-inventory.tmp.ts` (outside
`src/`, so `tsc` never compiled it), was used only to produce the evidence, and
was **deleted before this report was committed**. No production source was
modified. The working tree is clean of it.

### 5.2 Classification (mirrors `routeRegistryConformance.test.ts`)

Each captured preHandler is classified into exactly one of: `authentication`,
`role` (tagged `_isRequireRole`), `permission_list` (tagged
`_isRequirePermission`), `flat` (`requireCapability`, `.authz.kind === "flat"`),
`scoped` (`.authz.kind` in `scoped` / `candidate_context` / `exam_eligibility` /
`own_attempt`), or `other`. The negative-control test in the conformance suite
proves this classifier actually detects a `requireRole` gate, so the "0 role
handlers" result is non-vacuous.

### 5.3 Raw capture result

```text
Raw onRoute registrations:        131
Auto-generated HEAD aliases:       40  (one per GET; excluded from primary count)
Primary application routes:        91
```

---

## 6. Normalization rules

The normalization applied to the raw capture (task §6.3):

```text
- HTTP methods uppercased.
- Full runtime path retained, INCLUDING plugin prefixes:
    /api/...           for every module registered under {prefix:"/api"}
    /api/auth/...      for authRoutes (registered under {prefix:"/api/auth"})
  Source-local paths such as /login are NEVER listed; the runtime /api/auth/login
  is the canonical form. (Confirmed: registerApiRoutes.ts:38 applies /api/auth.)
- Trailing slashes: none present in the tree.
- Multi-method route declarations: none (each route registers exactly one method).
- Fastify auto-generated HEAD routes:
    RULE CHOSEN — exclude HEAD aliases from the primary application-route count,
    consistent with M10-F §C ("Auto-generated HEAD aliases are excluded; every
    explicitly registered HTTP method/path pair is counted once"). 40 HEAD
    aliases exist (one per GET). Recorded here; not counted in the 91.
- Parameter naming: left as the route declares (:id, :examId, :attemptId,
  :questionId, :enrollmentId, :assignmentId). No renaming.
```

Anomalies detected and reported (task §6.3):

```text
- duplicate method + runtime path: NONE (after dedup)
- runtime-only routes:              NONE among protected routes
- registry-only entries:            NONE
- source declarations not registered at runtime: NONE (every registry key
                                     resolves to exactly one runtime route)
- routes whose source-local and runtime paths differ: ALL auth routes
                                     (source /login → runtime /api/auth/login);
                                     this is the documented prefix contract,
                                     not drift.
```

The one structural anomaly worth naming (not drift; already documented in M10-F):

```text
- GET /api/scores/attempts/:attemptId is gated by requireScoreCapability, but
  that decorator (authz.ts:102) attaches NO .authz introspection metadata,
  unlike every other resource-aware gate. It therefore appears as
  "authenticate-only" to a metadata-only inspector. M10-F §C documents this
  explicitly: "80 preHandler gates carrying runtime authorization metadata and
  the dedicated score gate on GET /scores/attempts/:attemptId". The gate is
  proven at runtime by scores.ts:416
  (preHandler: [fastify.authenticate, fastify.requireScoreCapability()]) and by
  scoreCapability.test.ts (20 tests). Classification rule applied: this route
  is counted as capability/ownership-gated (score_capability), NOT
  authenticate-only.
```

---

## 7. Complete normalized runtime route table

Columns: `Method | Runtime path | Source module / registration owner |
Authorization category | Required capability | Registry status | Notes`.

Authorization categories (task §7):

```text
A — flat capability gate           (requireCapability)
B — scoped/resource-aware gate     (requireScopedCapability / requireScoreCapability /
                                    requireCandidateContext / requireExamEligibility /
                                    requireOwnAttempt)
C — authenticate-only
D — public
E — intentionally disabled public endpoint (POST /api/auth/register)
F — unknown / unclassified         (NONE — every primary route classifies)
```

Registry status values: `MATCH` (protected route represented by registry with
gate+capability agreement) · `INTENTIONALLY_EXCLUDED` (public /
authenticate-only — outside the registry by the documented contract).

### 7.1 Category A — flat capability gate (65 routes)

| Method | Runtime path | Source module | Capability | Registry | Notes |
| --- | --- | --- | --- | --- | --- |
| DELETE | `/api/candidate-fields/:id` | candidateField.ts | `candidate_field.delete` | MATCH | — |
| DELETE | `/api/courses/:id` | course.ts | `course.delete` | MATCH | — |
| DELETE | `/api/exams/:examId/enrollments/:enrollmentId` | exam.ts | `exam.enrollment.manage` | MATCH | — |
| DELETE | `/api/exams/:id` | exam.ts | `exam.delete` | MATCH | — |
| DELETE | `/api/questions/:id` | question.ts | `question.delete` | MATCH | — |
| DELETE | `/api/role-assignments/:assignmentId` | roleAssignments.ts | `user.role.assign` | MATCH | — |
| DELETE | `/api/users/:id` | user.ts | `user.delete` | MATCH | — |
| GET | `/api/admin/attempts/:attemptId/export` | attempts.ts | `attempt.export` | MATCH | — |
| GET | `/api/admin/attempts/:attemptId/export/csv` | attempts.ts | `attempt.export` | MATCH | — |
| GET | `/api/admin/attempts/:attemptId/timeline` | attempts.ts | `attempt.timeline.view` | MATCH | — |
| GET | `/api/admin/audit-logs` | audit.ts | `audit_log.view` | MATCH | — |
| GET | `/api/admin/exams/:examId/candidates/status` | exam.ts | `exam.enrollment.manage` | MATCH | — |
| GET | `/api/admin/grading-queue` | grading | `grading.queue.view` | MATCH | registry resolver `exam`; runtime gate is flat (M10-B/C note: resource-scope not implemented) |
| GET | `/api/admin/import-logs` | importLogs.ts | `audit_log.view` | MATCH | — |
| GET | `/api/admin/proctor/exams` | proctorMonitoring.ts | `exam_room.view` | MATCH | — |
| GET | `/api/admin/settings` | settings.ts | `settings.view` | MATCH | — |
| GET | `/api/admin/settings/branding` | settings.ts | `settings.view` | MATCH | — |
| GET | `/api/candidate-fields` | candidateField.ts | `candidate_field.view` | MATCH | — |
| GET | `/api/candidate-fields/template` | candidateField.ts | `candidate_field.view` | MATCH | — |
| GET | `/api/candidates` | candidate.ts | `candidate.view` | MATCH | — |
| GET | `/api/courses` | course.ts | `course.view` | MATCH | — |
| GET | `/api/courses/:id` | course.ts | `course.view` | MATCH | — |
| GET | `/api/exams` | exam.ts | `exam.view` | MATCH | — |
| GET | `/api/exams/:examId/enrollments` | exam.ts | `exam.enrollment.manage` | MATCH | — |
| GET | `/api/exams/:id` | exam.ts | `exam.view` | MATCH | — |
| GET | `/api/exams/:id/export/scores` | export.ts | `score.export` | MATCH | — |
| GET | `/api/exams/:id/scores` | scores.ts | `score.all.view` | MATCH | — |
| GET | `/api/questions` | question.ts | `question.view` | MATCH | — |
| GET | `/api/questions/:id` | question.ts | `question.view` | MATCH | — |
| GET | `/api/roles/assignable` | roleAssignments.ts | `user.role.assign` | MATCH | — |
| GET | `/api/system/dashboard` | system.ts | `system.health.view` | MATCH | — |
| GET | `/api/system/diagnostics` | system.ts | `system.diagnostics.view` | MATCH | — |
| GET | `/api/system/health` | system.ts | `system.health.view` | MATCH | NOT public (P4-R0 §7.1 correction) |
| GET | `/api/users` | user.ts | `user.view` | MATCH | — |
| GET | `/api/users/:id/role-assignments` | roleAssignments.ts | `user.view` | MATCH | — |
| PATCH | `/api/admin/settings/branding` | settings.ts | `settings.update` | MATCH | — |
| PATCH | `/api/candidate-fields/:id` | candidateField.ts | `candidate_field.update` | MATCH | — |
| PATCH | `/api/candidates/:id` | candidate.ts | `candidate.update` | MATCH | — |
| PATCH | `/api/courses/:id` | course.ts | `course.update` | MATCH | — |
| PATCH | `/api/exams/:id` | exam.ts | `exam.update` | MATCH | — |
| PATCH | `/api/questions/:id` | question.ts | `question.update` | MATCH | — |
| PATCH | `/api/role-assignments/:assignmentId` | roleAssignments.ts | `user.role.assign` | MATCH | — |
| PATCH | `/api/users/:id` | user.ts | `user.update` | MATCH | — |
| POST | `/api/admin/attempts/:attemptId/extend-time` | attempts.ts | `attempt.time.extend` | MATCH | — |
| POST | `/api/admin/attempts/:attemptId/force-submit` | attempts.ts | `attempt.force_submit` | MATCH | — |
| POST | `/api/admin/attempts/:attemptId/misconduct` | attempts.ts | `attempt.misconduct.mark` | MATCH | — |
| POST | `/api/candidate-fields` | candidateField.ts | `candidate_field.create` | MATCH | — |
| POST | `/api/candidates` | candidate.ts | `candidate.create` | MATCH | — |
| POST | `/api/candidates/import` | candidate.ts | `candidate.import` | MATCH | — |
| POST | `/api/courses` | course.ts | `course.create` | MATCH | — |
| POST | `/api/email/test` | email.ts | `system.diagnostics.view` | MATCH | — |
| POST | `/api/exams` | exam.ts | `exam.create` | MATCH | — |
| POST | `/api/exams/:examId/enrollments` | exam.ts | `exam.enrollment.manage` | MATCH | — |
| POST | `/api/exams/:id/archive` | exam.ts | `exam.archive` | MATCH | — |
| POST | `/api/exams/:id/cancel` | exam.ts | `exam.cancel` | MATCH | — |
| POST | `/api/exams/:id/close` | exam.ts | `exam.close` | MATCH | — |
| POST | `/api/exams/:id/extend` | exam.ts | `exam.extend` | MATCH | — |
| POST | `/api/exams/:id/publish` | exam.ts | `exam.publish` | MATCH | — |
| POST | `/api/exams/:id/publish-results` | exam.ts | `exam.result.publish` | MATCH | — |
| POST | `/api/exams/:id/unpublish` | exam.ts | `exam.unpublish` | MATCH | — |
| POST | `/api/questions` | question.ts | `question.create` | MATCH | — |
| POST | `/api/questions/import` | question.ts | `question.import` | MATCH | — |
| POST | `/api/users` | user.ts | `user.create` | MATCH | — |
| POST | `/api/users/:id/reset-password` | user.ts | `user.password.reset` | MATCH | — |
| POST | `/api/users/:id/role-assignments` | roleAssignments.ts | `user.role.assign` | MATCH | — |

### 7.2 Category B — scoped / resource-aware capability gate (16 routes)

| Method | Runtime path | Source module | Gate sub-kind | Capability | Registry | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/admin/attempts/:attemptId/grading-details` | grading | `scoped` | `grading.detail.view` | MATCH | — |
| GET | `/api/admin/attempts/:attemptId/proctor-events` | proctorMonitoring.ts | `scoped` | `attempt.timeline.view` | MATCH | — |
| GET | `/api/admin/exams/:examId/proctor/attempts` | proctorMonitoring.ts | `scoped` | `exam_room.view` | MATCH | — |
| GET | `/api/attempts/:id` | attempts.ts | `own_attempt` | `attempt.view_own` | MATCH | — |
| GET | `/api/candidate/attempts/:attemptId/take` | attempts.ts | `own_attempt` | `attempt.view_own` | MATCH | — |
| GET | `/api/candidate/exams` | candidate.ts | `candidate_context` | `exam.take` | MATCH | — |
| GET | `/api/candidate/exams/:examId` | candidate.ts | `exam_eligibility` | `exam.take` | MATCH | — |
| GET | `/api/scores/attempts/:attemptId` | scores.ts | `score_capability` | `score.own.view` | MATCH | dedicated score gate; no `.authz` metadata (M10-F documented exception); proven at `scores.ts:416` + `scoreCapability.test.ts` |
| POST | `/api/admin/attempts/:attemptId/grade-question` | grading | `scoped` | `grading.score.write` | MATCH | — |
| POST | `/api/admin/attempts/:attemptId/proctor-incident` | proctorMonitoring.ts | `scoped` | `attempt.misconduct.mark` | MATCH | — |
| POST | `/api/attempts/:attemptId/answers/:questionId` | attempts.ts | `own_attempt` | `attempt.answer.save` | MATCH | — |
| POST | `/api/attempts/:attemptId/heartbeat` | attempts.ts | `own_attempt` | `attempt.heartbeat.send` | MATCH | — |
| POST | `/api/attempts/:attemptId/restore` | attempts.ts | `own_attempt` | `attempt.restore` | MATCH | — |
| POST | `/api/attempts/:attemptId/submit` | attempts.ts | `own_attempt` | `attempt.submit` | MATCH | — |
| POST | `/api/attempts/:examId/queue` | attempts.ts | `exam_eligibility` | `attempt.start` | MATCH | — |
| POST | `/api/attempts/:examId/start` | attempts.ts | `exam_eligibility` | `attempt.start` | MATCH | — |

### 7.3 Category C — authenticate-only (4 routes)

| Method | Runtime path | Source module | Capability | Registry | Notes |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/auth/me` | auth.ts | — | INTENTIONALLY_EXCLUDED | self; returns role + capabilities |
| PATCH | `/api/auth/me/password` | auth.ts | — | INTENTIONALLY_EXCLUDED | self |
| PATCH | `/api/auth/me/profile` | auth.ts | — | INTENTIONALLY_EXCLUDED | self; returns capabilities |
| POST | `/api/client-events` | clientEvents.ts | — | INTENTIONALLY_EXCLUDED | telemetry |

### 7.4 Category D / E — public / intentionally disabled (6 routes)

| Method | Runtime path | Source module | Capability | Registry | Notes |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/settings/branding` | settings.ts | — | INTENTIONALLY_EXCLUDED | pre-login branding |
| GET | `/api/system/info` | system.ts | — | INTENTIONALLY_EXCLUDED | public info |
| GET | `/api/system/public-config` | system.ts | — | INTENTIONALLY_EXCLUDED | pre-login config |
| POST | `/api/auth/login` | auth.ts | — | INTENTIONALLY_EXCLUDED | credential check; inactive → 401 |
| POST | `/api/auth/logout` | auth.ts | — | INTENTIONALLY_EXCLUDED | clears cookie |
| POST | `/api/auth/register` | auth.ts | — | INTENTIONALLY_EXCLUDED | **E — intentionally disabled**: always 403 AUTH_REGISTER_DISABLED |

### 7.5 Category F — unknown / unclassified

```text
NONE. Every one of the 91 primary runtime routes classifies into A/B/C/D/E.
```

> **Out-of-tree note.** `GET /api/health` (the liveness probe registered in
> `server.ts:105`, not in `registerApiRoutes`) is **not** in the
> `registerApiRoutes` composition and therefore not in this inventory. It is a
> public liveness probe (`{ status: "ok" }`), not a business route, and is not
> in `ROUTE_PERMISSION_REGISTRY` by design. `GET /api/system/health`
> (capability-gated `system.health.view`) is a different route and IS in the
> inventory above.

---

## 8. Authorization-category counts

| Category | Description | Count | Expected-registry behavior | Actual-registry behavior |
| --- | --- | ---: | --- | --- |
| A | flat capability gate | 65 | in registry | 65 MATCH |
| B | scoped / resource-aware capability gate | 16 | in registry | 16 MATCH |
| **(gated subtotal)** | A + B | **81** | **81 in registry** | **81 MATCH** |
| C | authenticate-only | 4 | intentionally excluded | 4 INTENTIONALLY_EXCLUDED |
| D | public | 5 | intentionally excluded | 5 INTENTIONALLY_EXCLUDED |
| E | intentionally disabled public endpoint | 1 | intentionally excluded | 1 INTENTIONALLY_EXCLUDED |
| **(non-gated subtotal)** | C + D + E | **10** | **10 excluded** | **10 INTENTIONALLY_EXCLUDED** |
| F | unknown / unclassified | 0 | n/a | n/a |
| **Total primary routes** | | **91** | | **91 reconciled** |

Gate-family breakdown of the 16 Category-B routes (matches M10-F §C):

```text
scoped            (requireScopedCapability):   5
score_capability  (requireScoreCapability):    1
candidate_context (requireCandidateContext):   1
exam_eligibility  (requireExamEligibility):    3
own_attempt       (requireOwnAttempt):         6
                                              ──
                                              16
```

Reconciliation with the contract's `91 / 81 / 10`:

```text
91 primary = 81 capability/ownership-gated (A 65 + B 16) + 10 non-gated (C 4 + D 5 + E 1)
The 81 gated = 80 metadata-carrying preHandler gates + 1 dedicated score gate
               (the documented scoreCapability exception).
```

Blocking condition (task §7): *"Any protected route classified as unknown or
unclassified prevents PASS."* — **0 routes are unclassified. PASS not blocked.**

---

## 9. Runtime ↔ registry reconciliation

### 9.1 Artifacts inspected

```text
apps/api/src/authz/routeRegistry.ts          ROUTE_PERMISSION_REGISTRY (81 entries)
apps/api/src/authz/routeRegistryConformance.test.ts   (the conformance harness)
packages/authz/src/catalog.ts                Permission → dotted-value map
```

### 9.2 Method

The reconciliation cross-checks, for every one of the 91 primary runtime
routes, the runtime path (plugin prefix stripped to the per-route definition
path), the runtime gate kind, and the runtime permission against the
corresponding `ROUTE_PERMISSION_REGISTRY` entry (keyed `METHOD path`). The
registry permission symbol is resolved to its dotted value via the
`Permission` catalog. Allowed statuses are exactly the task §8 set.

### 9.3 Reconciliation table (aggregate)

| Status | Count | Meaning |
| --- | ---: | --- |
| `MATCH` | 81 | protected runtime route represented by registry; gate + capability agree |
| `INTENTIONALLY_EXCLUDED` | 10 | public / authenticate-only route; outside registry by documented contract |
| `RUNTIME_ONLY` | 0 | protected route present at runtime but absent from registry |
| `REGISTRY_ONLY` | 0 | registry entry with no runtime route |
| `GATE_MISMATCH` | 0 | registry ↔ runtime gate-kind disagreement |
| `CAPABILITY_MISMATCH` | 0 | registry ↔ runtime capability disagreement |
| `NORMALIZATION_MISMATCH` | 0 | unexplained path/key disagreement |

### 9.4 Per-route reconciliation

The full per-route registry status is the `Registry` column of the tables in
§7.1–§7.4. Every protected route is `MATCH`; every non-gated route is
`INTENTIONALLY_EXCLUDED` (the documented contract: public and
self/authenticate-only routes are outside `ROUTE_PERMISSION_REGISTRY`).

### 9.5 Gate 0.5 blocking conditions (task §8)

```text
Gate 0.5 cannot PASS with:
  RUNTIME_ONLY protected routes         — 0  (none)
  REGISTRY_ONLY active entries          — 0  (none)
  GATE_MISMATCH                         — 0  (none)
  CAPABILITY_MISMATCH                   — 0  (none)
  unexplained normalization mismatch    — 0  (none)
```

**No drift. PASS not blocked.** No correction was applied (this is a
verification-only Job).

---

## 10. `requireRole` / `requirePermission` sweep

### 10.1 Commands

```bash
rg -n "requireRole|_isRequireRole"        apps packages  (non-test, non-dist)
rg -n "requirePermission|_isRequirePermission" apps packages (non-test, non-dist)
rg -n "fastify\.requireRole\(|\.requireRole\(\["  apps/api/src (non-test)
rg -n "fastify\.requirePermission\(|\.requirePermission\("  apps/api/src (non-test)
```

### 10.2 Classification of every match

| Match site | Classification | Runtime authority? |
| --- | --- | --- |
| `apps/api/src/plugins/auth.ts:211,226` — the `requireRole` decorator definition + its `_isRequireRole` tag | **MIGRATION RESIDUE (decorator)** | **No** — 0 route consumers (source + runtime confirmed) |
| `apps/api/src/plugins/auth.ts:238,253` — the `requirePermission` decorator definition + its `_isRequirePermission` tag | **MIGRATION RESIDUE (decorator)** | **No** — 0 route consumers (source + runtime confirmed) |
| `apps/api/src/openapi/swagger.ts:36` — `app.decorate("requireRole", () => async () => {})` | **SCRIPT ONLY (OpenAPI spec generation stub)** | **No** — no-op stub so spec generation can register flipped routes; never runs in the runtime server |
| `apps/api/src/types/fastify-auth.d.ts:85,88` — type declarations for the decorators | **COMPATIBILITY PROJECTION (types)** | **No** — type surface only |
| `apps/api/src/routes/{user,roleAssignments}.ts`, `packages/contracts/src/user.ts`, `apps/web/src/.../UsersPage.tsx`, `capabilities.ts`, various authz/*.ts | **COMMENT / JSDoc** ("the migration from legacy `requireRole(["Admin"])` …") | **No** — prose |
| `packages/authz/src/systemActor.ts:13` | **COMMENT** | **No** — prose |

### 10.3 Runtime confirmation

The `onRoute` capture classified the preHandler chain of all 91 primary routes.
The result:

```text
roleHandlerCount          total across 91 routes:  0
permissionListHandlerCount total across 91 routes: 0
```

i.e. **no runtime route carries a `requireRole` or `requirePermission`
preHandler**. This is non-vacuous: the conformance suite's negative-control
test proves the classifier detects a synthetic `requireRole(["Admin"])` gate.

### 10.4 Blocking conditions (task §9)

```text
- any active requireRole route preHandler          — NONE (0)
- any active requirePermission route consumer      — NONE (0)
```

The existence of the dead `requireRole` / `requirePermission` decorators in
`auth.ts` is **not** a P4-V0 failure (zero runtime consumers). It remains
**P4-C1** cleanup work (P4-G-06). PASS not blocked.

---

## 11. `users.role` / JWT-role authority sweep

### 11.1 Commands

```bash
rg -n "ctx\.role|request\.ctx\.role|user\.role|jwt.*role|role ===|role !==|roles\.includes" \
  apps/api packages --glob '!**/*.test.*'
rg -n "getPermissionsForRole|legacyMap" apps packages --glob '!**/*.test.*'
rg -n "loadAssignmentAuthority|deriveAssignmentAuthority|ctx\.capabilities" apps/api packages
```

### 11.2 Classification of every role-string match

| Match site | Classification | Runtime authority? |
| --- | --- | --- |
| `apps/api/src/plugins/auth.ts:123,168,172,180-189` — `ctx.role = authority.authority.primaryRole` (compatibility projection); JWT-role drift telemetry (`request.log.debug`) | **COMPATIBILITY PROJECTION / TELEMETRY** | **No** — `ctx.capabilities` is authoritative; the JWT-role mismatch log explicitly "must NEVER widen access" |
| `apps/api/src/plugins/auth.ts:220` — `if (!roles.includes(ctx.role))` inside the **dead `requireRole` decorator body** | **MIGRATION RESIDUE (dead decorator)** | **No** — 0 route consumers (see §10) |
| `apps/api/src/routes/auth.ts:193,208,437,584` — `role: user.role`/`ctx.role` in `/login`, `/me`, `/me/profile` **response payloads** | **DOMAIN DATA / DISPLAY** | **No** — the API returns the primary role to the frontend; the frontend uses capabilities (not role) for gating |
| `apps/api/src/routes/user.ts:179` — `role: user.role` in the user-list **response** | **DOMAIN DATA / DISPLAY** | **No** — response payload |
| `apps/api/src/routes/roleAssignments.ts:158,211,252,324` — `action: "user.role_changed"` **audit-action strings** | **DOMAIN DATA (audit log)** | **No** — audit text |
| `apps/api/src/routes/scores.ts:77,163,473` — comments documenting the **removal** of the old role-string branch | **COMMENT (negative evidence)** | **No** — "No `ctx.role === …` branch" |
| `apps/api/src/authz/{scoreCapability,ownAttemptCapability}.ts` — comments documenting no role branch | **COMMENT (negative evidence)** | **No** |
| `apps/api/src/scripts/reset-admin-password.ts:51,67` — script reads active **assignment** rows (`assignmentRepo.listActiveForUser`, `a.role === "Admin"`) | **SCRIPT ONLY** | **No** — and notably uses assignment-backed authority, not `users.role` |
| `apps/api/src/routes/testHelpers.ts:408,460,498,517-519` — test-fixture JWT sign + role-name allowlist | **TEST ONLY** | **No** |
| `packages/auth/src/rbac.ts:38` — `getPermissionsForRole` definition | **MIGRATION RESIDUE (dead map)** | **No** — 0 production importers |
| frontend `apps/web/src/.../{UsersPage,capabilities,AuthContext}.tsx` — role picker, landing-path preference, display | **DOMAIN DATA / DISPLAY** | **No** — backend authoritative; frontend gating is UX-only |

### 11.3 `getPermissionsForRole` / `legacyMap` consumers

```text
production consumers of getPermissionsForRole (excluding packages/auth/src/rbac.ts itself): 0
production runtime consumers of legacyMap: 0
```

### 11.4 Blocking conditions (task §9)

```text
- any runtime route authorization decision based on users.role:  NONE (0)
- any runtime route authorization decision based on JWT role:    NONE (0)
- any active requireRole route preHandler:                       NONE (0)  (§10)
- any active requirePermission route consumer:                   NONE (0)  (§10)
- fallback from assignment authority to users.role:              NONE —
  loadAssignmentAuthority fail-closed contract verified (§12, §13)
```

**PASS not blocked.** The dead legacy `rbac.ts` map and `legacyMap.ts` remain
**P4-C1** cleanup work (P4-G-06); they have zero runtime authority.

---

## 12. Assignment-authority verification

### 12.1 The chain (verified against `apps/api/src/plugins/auth.ts` + `apps/api/src/authz/assignmentAuthority.ts`)

```text
cookie "auth-token"
   │  (verifyJWT)
   ▼
authenticate (auth.ts:60)
   ├─ load user row (findByOrganizationAndId)
   ├─ if !user.isActive  → 401 AUTH_REQUIRED              (disabled-user rejection)
   ├─ loadAssignmentAuthority(db, ctx, user.id)
   │     └─ userRoleAssignmentRepo.listActiveForUser(ctx, userId)   (filters by org)
   │     └─ deriveAssignmentAuthority(rows, orgId, userId)
   │           ├─ subject_mismatch      → {ok:false} → 503
   │           ├─ no_active_assignments → {ok:false, reason:"no_active_assignments"} → 401
   │           ├─ unknown_role          → {ok:false} → 503
   │           ├─ zero_primary_with_active → {ok:false} → 503
   │           ├─ multiple_primary      → {ok:false} → 503
   │           └─ union of permissionsForRole(role) over active roles → capabilities
   ├─ DB / loader-thrown error → 503 AUTHZ_UNAVAILABLE   (NEVER falls back to users.role)
   └─ request.ctx = { actorId, organizationId,
                      role(primary, compat), roles(active),
                      capabilities(authoritative), permissions([] legacy), sessionId }
        ↓
preHandler gate (requireCapability / requireScopedCapability / requireScoreCapability /
                 requireCandidateContext / requireExamEligibility / requireOwnAttempt)
   └─ reads ctx.capabilities  →  Allow / Deny
```

### 12.2 Fail-closed behavior — verified by existing tests

The fail-closed modes enumerated in task §10 are each covered by the existing
suites (no new tests added in this Job — task §10 forbids duplicating tests):

| Fail-closed mode | Covering test (selected) |
| --- | --- |
| no active assignments | `assignmentAuthorityRuntime.test.ts` (E10) → 401 |
| unknown role | `assignmentAuthority.test.ts` + runtime E-series → 503 |
| multiple active primary assignments | `assignmentAuthority.test.ts` → 503 |
| zero primary with active assignments | `assignmentAuthority.test.ts` → 503 |
| subject mismatch (org/user anchor) | `assignmentAuthority.test.ts` → 503 |
| database failure | `assignmentAuthorityRuntime.test.ts` (db_error) → 503 |
| inactive user (`isActive=false`) | `auth.test.ts` (login rejection → 401) |
| inactive assignment | `assignmentAuthorityRuntime.test.ts` (E7 revocation) |
| stale `users.role` projection | `assignmentAuthorityRuntime.test.ts` (E-series) — authority follows assignments, not the column |
| stale JWT role claim | `assignmentAuthorityRuntime.test.ts` (E-series) — drift telemetry only, never widens |
| multi-role capability union | `assignmentAuthorityRuntime.test.ts` (E17 scoped-gate + E19 ScoreAllView via secondary role) |
| DB corruption / loader throw | `assignmentAuthorityRuntime.test.ts` (fail-closed corruption) → 503 |

All of these suites pass — see §13.

---

## 13. Test commands and results

All database-backed tests ran with the repository's test configuration
(`APP_MODE=test`, `exam_test` database only, `TEST_DB_ISOLATION=worker-database`
per `AGENTS.md`). No destructive test touched the `exam` (dev) database.

### 13.1 Static gates

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm format:check` | 0 | PASS — "All matched files use Prettier code style!" (verified again after the temp harness was deleted) |
| `pnpm lint` (code-quality) | 0 | PASS — no violations in tracked source |
| `pnpm lint:arch` | 0 | PASS — "Architecture checks passed." |
| `pnpm typecheck` | 0 | PASS — 17/17 tasks successful |

> Note: while the temporary inventory harness was still on disk,
> `format:check`/`lint` flagged only that one untracked temp file (console
> output + prettier style). After deletion the tracked tree is clean. No
> production source was modified.

### 13.2 The direct Gate 0.5 artifact

| Command | Exit | Files | Tests | Skips | Result |
| --- | --- | ---: | ---: | ---: | --- |
| `APP_MODE=test TEST_DB_ISOLATION=worker-database pnpm --filter @exam/api exec vitest run src/authz/routeRegistryConformance.test.ts` | 0 | 1 | 75 passed | 0 | PASS |

Re-executed directly during this corrective pass (the negative-control "capture
detects a role gate on a synthetic route" case is among the 75). Count unchanged
from the original report.

### 13.3 Assignment-authority + capability-gate + boundary suites

Exact command executed:

```bash
APP_MODE=test TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 \
  pnpm --filter @exam/api exec vitest run \
    src/authz/assignmentAuthority.test.ts \
    src/authz/assignmentAuthorityRuntime.test.ts \
    src/authz/adminInvariant.test.ts \
    src/authz/scoreCapability.test.ts \
    src/authz/candidateContextCapability.test.ts \
    src/authz/examEligibilityCapability.test.ts \
    src/authz/ownAttemptCapability.test.ts \
    src/routes/permissionBoundary.test.ts \
    src/authz/adminSuperset.test.ts \
    src/authz/shadowParity.test.ts
```

| Exit | Files | Tests | Skips | Result |
| ---: | ---: | ---: | ---: | --- |
| 0 | 10 | 151 passed | 0 | PASS |

> **Count correction.** The original report listed "9 files / 92 passed". That
> was wrong on both axes: the named scope contains **10** files (the
> `assignmentAuthorityRuntime` entry was present in the name list but dropped
> from the count), and the real executed total is **151** tests, not 92. The
> corrected numbers above are the actual `vitest run` output.

### 13.4 Route-level authorization matrices

Exact command executed:

```bash
APP_MODE=test TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 \
  pnpm --filter @exam/api exec vitest run \
    src/routes/examAuthoringCapability.test.ts \
    src/routes/questionAuthoringCapability.test.ts \
    src/routes/candidateOwnership.test.ts \
    src/routes/candidateInvariant.test.ts \
    src/routes/scores.test.ts \
    src/routes/proctorMonitoring.crossOrg.test.ts \
    src/routes/proctorDiscovery.test.ts \
    src/routes/roleAssignments.test.ts \
    src/routes/user.test.ts \
    src/routes/candidate.test.ts \
    src/routes/m10dPermissionBoundary.test.ts \
    src/authz/permissionMatrix.exam.test.ts \
    src/authz/permissionMatrix.question.test.ts \
    src/authz/permissionMatrix.grading.test.ts \
    src/authz/permissionMatrix.proctor.test.ts
```

| Exit | Files | Tests | Skips | Result |
| ---: | ---: | ---: | ---: | --- |
| 0 | 15 | 272 passed | 0 | PASS |

> **Count correction.** The original report listed "14 files / 178 passed". That
> was wrong on both axes: the named scope contains **15** files (the expanded
> name list already totaled 15: the 4 `permissionMatrix.{exam,question,grading,
> proctor}` entries plus the 11 individually-named route files), and the real
> executed total is **272** tests, not 178. The corrected numbers above are the
> actual `vitest run` output.

### 13.5 Package + frontend projection suites

Exact commands executed:

```bash
pnpm --filter @exam/authz test
pnpm --filter @exam/web exec vitest run src/lib/capabilities.test.ts src/components/layout/layout.test.tsx
```

| Command | Exit | Files | Tests | Skips | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| `pnpm --filter @exam/authz test` | 0 | 9 | 63 passed | 0 | PASS |
| `pnpm --filter @exam/web exec vitest run src/lib/capabilities.test.ts src/components/layout/layout.test.tsx` | 0 | 2 | 104 passed | 0 | PASS |

### 13.6 Full API suite

Exact command executed:

```bash
APP_MODE=test TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 \
  pnpm --filter @exam/api test
```

| Exit | Files | Tests | Skips | Duration | Result |
| ---: | ---: | ---: | ---: | ---: | --- |
| 0 | 121 | 1499 passed | 5 skipped | 85.21s | PASS |

This same API test set (121 files / 1499 passed / 5 skipped) was also executed
as part of the directly-run `pnpm verify` coverage stage (§13.9), confirming
the result twice via independent invocations.

### 13.7 Build

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm build` | 0 | PASS — 9/9 tasks successful |

### 13.8 Skipped tests (5)

All 5 skips are in `apps/api/src/routes/redis.test.ts`, gated on
`REDIS_URL not set` / `Redis not reachable`. They are environment skips, **not**
authorization tests, and are not Gate 0.5 relevant. The same 5 skips appear in
the historical M10-F record (then "1501 passed / 5 skipped"; now 1499/5 as the
suite evolved).

### 13.9 `pnpm verify` — the final repository gate (directly executed)

> **Corrective note.** The original P4-V0 report stated here that `pnpm verify`
> was **not** executed and that its components were "run individually" instead.
> That was the verification-evidence gap this corrective pass closes. The
> command below was run in full, as a single invocation, during this pass. No
> component is claimed by inference.

**Exact command:**

```bash
pnpm verify
```

(`pnpm verify` expands to:
`pnpm format:check && pnpm lint && pnpm lint:copy && pnpm lint:arch &&
pnpm lint:db-config && pnpm lint:ui-gates && pnpm lint:eslint && pnpm typecheck
&& TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm coverage &&
pnpm build`.)

**Observed result:**

| Field | Value |
| --- | --- |
| Exact command | `pnpm verify` |
| Start (UTC) | `2026-07-24T01:13:26Z` |
| End (UTC) | `2026-07-24T01:16:07Z` |
| Wall duration | ~2 min 41 s |
| **Exit code** | **0** |
| `format:check` | PASS — "All matched files use Prettier code style!" |
| `lint` (code-quality) | PASS — "Code quality checks passed." |
| `lint:copy` | PASS — "No hardcoded business copy found." |
| `lint:arch` | PASS — "Architecture checks passed." |
| `lint:db-config` | PASS — "DB/test-config regression guards passed." |
| `lint:ui-gates` | PASS — Ant Design / raw-palette / color-literal / font-weight / RowActions / UI-architecture guards all clean |
| `lint:eslint` | PASS |
| `typecheck` (turbo) | PASS — **17 successful / 17 total** |
| `coverage` (turbo) | PASS — **16 successful / 16 total** |
| `build` (turbo) | PASS — **9 successful / 9 total** |
| Any failed package/task | **none** |
| Pipeline failure | **none** |

**Coverage-stage per-package results** (`pnpm coverage`, the test-bearing stage;
all packages green, no threshold failure):

| Package | Test Files | Tests | Skips | Duration |
| --- | ---: | ---: | ---: | ---: |
| `@exam/api` | 121 | 1499 passed | 5 | 109.43s |
| `@exam/web` | 94 | 1168 passed | 0 | 71.65s |
| `@exam/exam-engine` | 23 | 398 passed | 0 | 4.52s |
| `@exam/db` | 23 | 244 passed | 0 | 14.88s |
| `@exam/contracts` | 9 | 210 passed | 0 | 5.12s |
| `@exam/authz` | 9 | 63 passed | 0 | 3.75s |
| `@exam/auth` | 3 | 20 passed | 0 | 11.89s |
| `@exam/domain` | 3 | 12 passed | 0 | 2.18s |
| `@exam/import-export` | 1 | 17 passed | 0 | 2.29s |

The API coverage result (121 / 1499 | 5 skipped) is identical to the standalone
§13.6 invocation, confirming the suite twice via independent runs. The 5 skips
are the documented Redis-environment skips (§13.8).

**The complete repository gate `pnpm verify` was directly executed and passed
(exit 0).** No component is asserted by equivalence; the table above is the real
single-invocation result.

---

## 14. Failure classification

```text
AUTHZ_MODEL_FAILURE:           none
REGISTRY_DRIFT:                none
ROUTE_INVENTORY_MISMATCH:      none (131 raw = 91 primary + 40 HEAD; 91 reconciles
                                 exactly to 81 gated + 10 non-gated)
TEST_FAILURE:                  none
ENVIRONMENT_FAILURE:           none (DB started healthy; both exam + exam_test
                                 present; 5 redis-env skips are documented and
                                 authorization-irrelevant)
DOCUMENTATION_DRIFT:           none after the §15 updates
UNRELATED_BASELINE_FAILURE:    none
```

Baseline failure classification: **NONE observed**.

---

## 15. Documentation updates (PASS only)

Because the verdict is PASS, the following minimal updates are made in this
Job. They record Gate 0.5 = PASS with the verified commit, the normalized
runtime route count, the classification, the `0 requireRole` result, and a link
to this report. They do **not** mark P4 CLOSED, do **not** change P4-C1/C2/C3
statuses, and do **not** rewrite unrelated history.

- `docs/status/implementation-status.md` — Gate 0.5 Known-limitation entry:
  PENDING → PASS (verified commit, 91/81/10, 0 requireRole, link here).
- `docs/architecture/authorization.md` — Gate 0.5 caveat: PENDING → PASS
  (re-verified, link here).

The P4-R0 audit is **not** modified; it remains the historical
pre-correction snapshot. The M10-F archive document is **not** modified; it
remains the historical (now re-verified) contract.

---

## 16. Authorized next step

```text
PASS  →  P4-C1 — Authorization Residue Cleanup and Regression Lock
```

P4-C1's allowed scope (per P4-R0 §13): remove proven-dead migration residue
(`ResultPublish` dead key, the `requirePermission` decorator, the legacy
`packages/auth/src/rbac.ts` runtime map + its misleading `rbac.test.ts`
assertions); document intentionally reserved capabilities
(`GradingFinalize`/`GradingIdentityView` → M11; `System*` → System actor);
document the `users.role` compatibility-projection policy; and add the
whole-app "0 `requireRole` routes" structural regression assertion
(`routeRegistryConformance.test.ts`). P4-C1 must not delete `CandidateDelete` /
`SystemInfoView` / the reserved grading capabilities, must not change route
gates / frontend / schema / role presets, and depends on P4-V0 PASS (now met).

This Job authorizes **P4-V0 only**. It does **not** begin P4-C1, does **not**
declare P4 CLOSED, and does **not** state P4 CLOSED.

---

## Appendix A — PASS checklist (task §12)

```text
[x] Actual registered runtime route inventory produced           (131 raw / 91 primary)
[x] Full runtime paths include plugin prefixes                   (/api, /api/auth)
[x] Runtime route count and classification reconcile exactly     (91 = 81 gated + 10 non-gated)
[x] Every protected runtime route is represented by the registry (81/81 MATCH)
[x] No unexplained runtime-only protected route                  (0 RUNTIME_ONLY)
[x] No unexplained registry-only active route                    (0 REGISTRY_ONLY)
[x] No gate/capability mismatch                                  (0 GATE_MISMATCH, 0 CAPABILITY_MISMATCH)
[x] 0 active requireRole route preHandlers                       (source + runtime)
[x] 0 active requirePermission route consumers                   (source + runtime)
[x] 0 users.role / JWT-role runtime authorization decisions      (compat projection + telemetry only)
[x] Assignment-backed authority remains fail-closed              (§12; suites pass)
[x] Required M10-F / Gate 0.5 tests pass                         (routeRegistryConformance 75/75)
[x] Required authorization regression suites pass                (§13.3–§13.6)
[x] No unresolved baseline failure undermines the result         (§14)
```

All fourteen conditions are met.

---

## Appendix B — Production changes

```text
Production code modified: no
```

This Job created exactly one new file —
`docs/audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md` (this report) — and made
two minimal status-doc updates (`docs/status/implementation-status.md`,
`docs/architecture/authorization.md`). No route gate, preset, Permission,
registry entry, route, frontend, test, script, schema, or migration was
modified.

The temporary route-inventory harness that produced §5–§9 evidence lived at
`apps/api/p4v0.route-inventory.tmp.ts` (outside `src/`, never compiled), was
used only for evidence generation, and was **deleted before commit**. It is
not part of this change.

---

## Appendix C — Conflict / authority-order notes

Per task §5 authority order (current code/tests > current architecture/status
docs > accepted ADRs > current P4-R0 audit > archived migration documents):

- **No conflict** was found between tiers. The current executable code, the
  conformance test, the M10-F contract, the architecture/status docs, and the
  P4-R0 audit all agree on the Gate 0.5 definition and the 91/81/10 baseline.
- The historical `docs/archive/phase3/p4-mvp-rbac-route-matrix.md` describes a
  pre-cutover state (~57 routes on legacy `requireRole`) and is explicitly
  superseded by current code; it was consulted only to confirm what changed.
- The `131 raw vs 91 source-count` difference is fully explained by the 40
  Fastify-auto-generated HEAD aliases (§5.3, §6) and is not a conflict.
