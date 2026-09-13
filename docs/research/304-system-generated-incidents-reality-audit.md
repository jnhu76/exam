# #304 System-Generated Incidents — Reality Audit (EXAM-304-SYSTEM-INCIDENTS-REALITY-AUDIT-1, Lane A)

- **Base**: current master `1a9ab85e6299f250c461eb30f7dd98e6876078f0` (worktree `/home/hoo/Source/exam-wt-304`, detached HEAD).
- **Mode**: 调查/审计 (read-only code audit). No production file modified during evidence collection; this audit report is the only tracked artifact (committed on branch `docs/304-system-incidents-reality-audit`, PR #532).
- **Review status**: human review round 1 = REQUEST_CHANGES on the freeze proposal — crash/restart completion gap (now §8.5/§8.6, F4A), ADR-014 §8 gate coherence (now ADR_RECONCILIATION_REQUIRED, §14), audit action model (F8 rewritten), dedupe arbiter left as OR (F4 frozen to one authority). Absorbed. Review round 2 absorbed a "human-first corner" rule (ANY existing link completes the episode). Human final review (round 3, 2026-09-13) = REJECTED that rule — ANY human link is NOT System completion authority (§8.6, Corrective-3) — and issued the F5 product ruling (= B, per-episode, §10). Absorbed; freeze NOT posted to #304 until re-review passes.
- **Method**: Phase 1 code-first (all claims cite file:line from this worktree), Phase 2 normative docs, then a pre-implementation authority freeze proposal.
- **Probe logs**: `/tmp/maint1/probe-incidentCommands.log`, `/tmp/maint1/probe-scanners.log`, `/tmp/maint1/probe-authz.log` (tmp is volatile; digests recorded in §9).
- **GitHub context (given, not re-fetched)**: #304 OPEN, ordered-chain item 6 of roadmap #516.

---

## 1. A1 — What is the System actor today? (SYSTEM_ACTOR_REALITY)

**SYSTEM_ACTOR_REALITY: `System` is a REAL, fully-implemented in-process actor identity (SYSTEM-M1 landed) — but it is only wired to the two background scanners. It is NOT wired to any incident command. The "synthetic System role concept" claimed by #304 is code reality, not just vocabulary.**

Evidence:

- `packages/domain/src/enums.ts:25` — `System: "System"` in the product `Role` const; module doc (lines 6–11): "System is a **synthetic, non-login, non-assignable** actor identity used only by background scanners … it never originates from a `users.role` row and never appears in user-management UI."
- `packages/authz/src/systemActor.ts:23-26` — `SYSTEM_ACTOR_IDS = { DeadlineScanner: "system:deadline-scanner", Heartbeat: "system:heartbeat" }`; a **closed union** (lines 28–34) with runtime rejection of any other id (lines 54–58, "a stray string can never produce an untracked audit actor").
- `packages/authz/src/systemActor.ts:50-69` — `createSystemRequestContext(organizationId, actorId)` builds a real `RequestContext` with `role: Role.System`, `permissions: []` (legacy slot intentionally empty; real grants are the dotted `system.*` preset perms), `sessionId = actorId`.
- `packages/authz/src/presets.ts:287-291` — `SYSTEM_PERMISSIONS = [SystemAutoSubmit, SystemHeartbeatScan, SystemLifecycleReconcile]` (exactly 3, asserted by `packages/authz/src/systemActor.test.ts:22` "SYSTEM_PERMISSIONS is exactly the 3 system-only perms").
- `packages/authz/src/presets.ts:392-403` — System preset: `isSystem: true`, `assignable: false` ("bound to synthetic actor identities at code level"), `loginAllowed: false`, `defaultScope: Scope.System`, all perms sensitive.
- `packages/authz/src/catalog.ts:204,236` — `RoleKey.System = "system"` with label `"System"` (authz closed union, separate surface from the domain `Role`).
- Sole production call sites of `createSystemRequestContext`: `apps/api/src/plugins/deadlineScanner.ts:115-117,282,289` and `apps/api/src/plugins/heartbeat.ts:108-110,176,182` (verified by repo-wide grep; tests excluded).
- Scanners write **no** `audit_logs` rows today: grep for `recordAtomic|recordBestEffort|audit` in both plugin files returns only comments (`deadlineScanner.ts:157`, `heartbeat.ts:157` — "runtime transition does not depend on the compliance audit table"). The legacy audit actions `attempt.autoSubmit` / `attempt.disrupted` exist in the closed action union (`packages/authz/src/auditActions.ts:51-52`) but are lifecycle `deprecated` + durability `domain_history` (`apps/api/src/audit/auditPolicy.ts:326-337`): the interruption-event ledger / attempt state IS the audit record; `assertActiveAuditAction` (auditWriter path, `auditPolicy.ts:1070-1072` "Audit action … is … not active") forbids emitting them.

**SYSTEM_ACTOR_LATENT: no.** The System actor is executable, tested (`packages/authz/src/systemActor.test.ts`, 7 tests, all passing in probe P3), and in the live request path of both scanners. What IS latent is the *incident-authority* connection: no seam routes a System context into `createExamIncident` (§4, §5).

### CURRENT_STABLE_SIGNALS / CURRENT_SCANNERS summary

- Scanner loops (the only two `setInterval` loops in `apps/api/src/plugins`): `heartbeat.ts:230` (scan interval, default 30s, `DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000` line 19–20) and `deadlineScanner.ts:338` (default 30s, line 29). Email delivery worker polls separately (`apps/api/src/workers/emailDeliveryWorker.ts:343,356`).
- Persisted system-generated facts today: (a) interruption episode + `detected` event with `detectionSource: "heartbeat_timeout"` (`markDisrupted`, §5.1); (b) deadline auto-submit with `submissionReason: 'deadline'` frozen into submitted answers (`deadlineScanner.ts:199-203`, `source: "deadline_scanner"`); (c) email outbox terminal `dead` status + `lastError` (`packages/db/src/repository/emailOutboxRepo.ts:405-423`).

---

## 2. A2 — SIGNAL / DETECTOR / COMMAND / INCIDENT / JUDGMENT: what exists as real seams

| Concept | Real code seam today? | Where | Notes |
| --- | --- | --- | --- |
| SIGNAL | YES | `attempt_interruptions` + `attempt_interruption_events` rows (`packages/db/src/schema/pg.ts:658-680, 790-829`); `exam_attempts.lastActivityAt`; `email_outbox.status='dead'` (`emailOutboxRepo.ts:405-423`) | The `detected` event is a **durable, unique-per-episode** fact: partial unique `attempt_interruption_events_detected_unique` on `interruptionId WHERE eventType='detected'` (schema 823-825) and one outcome per episode (826-828). |
| DETECTOR | PARTIAL — fused with the producer | `scanForDisruptedAttempts` (`heartbeat.ts:63-98`) threshold evaluation + canonical `isAttemptDeadlineExpired` seam (`deadlineScanner.ts:186-197`) + under-lock recheck inside `markDisrupted` (`attemptCommands.ts:652-661`) | Detection is not a standalone seam: in `markDisrupted` the staleness evaluation, episode creation, `detected` event, and attempt status mutation are ONE atomic unit (attemptCommands.ts:633-702). There is **no** detector→incident seam. |
| COMMAND | YES (human-authored only) | `createExamIncident` + 8 more commands, `packages/exam-engine/src/incidentCommands.ts` | Actor-parametric (`ctx.actorId`), but every route entrance requires a human session + incident permission (§4). |
| INCIDENT | YES | `exam_incidents` aggregate (`schema/pg.ts:1707-1783`), append-only events (1789-1830), action/attempt/interruption link tables (1836-1973) | Terminal-monotonic status (`incidentCommands.ts:155` `TERMINAL_STATUSES = ["resolved","dismissed"]`). |
| JUDGMENT | YES | `resolveExamIncident` / `dismissExamIncident` (`incidentCommands.ts:1264-1365`), gated `Permission.IncidentResolve`, Admin-only (`routeRegistry.ts:1451-1469`; resolve is flagged sensitive in the Admin preset, `presets.ts:311`) | Terminal judgment is human-only by construction. |

**Conflation finding**: the only place the codebase "detects" is inside the disruption/deadline flows, and detection is fused with their state mutation. #304's core new seam is exactly the missing DECISION edge: *detector outcome → System command → incident*. Nothing in the code today conflates incident creation with detection — which is good: the incident aggregate and the episode ledger are deliberately orthogonal (ADR-014 §1; §5 below).

---

## 3. A3 — SYSTEM_IDENTITY_CARD

| Dimension | Reality (evidence) |
| --- | --- |
| Role representation | Enum value, not a row: domain `Role.System = "System"` (`domain/enums.ts:25`); authz `RoleKey.System = "system"` (`authz/catalog.ts:204`); preset entry `presets.ts:392-403`. Doc comment: "never originates from a `users.role` row" (`enums.ts:7-8`). |
| Actor identity | Synthetic string ids, closed set: `system:deadline-scanner`, `system:heartbeat` (`systemActor.ts:23-26`). No `users` row; no reserved uuid. `actorId` is a plain string everywhere (`RequestContext.actorId: string`, `domain/types.ts:688-695`). |
| Authorization semantics | Cannot log in (`ASSIGNABLE_LOGIN_ROLES` excludes System, `apps/api/src/routes/auth.ts:74-80`; login rejects non-login roles at `auth.ts:337-345`). Not assignable (`presets.ts:398`). Cannot pass HTTP capability gates: only authenticated human requests get `RuntimeRequestContext` with `capabilities`; "synthetic / CLI / resolver / system-actor contexts stay as plain RequestContext and never participate in capability gating" (`apps/api/src/types/requestContext.ts:17-19`). Scanner code never calls `requirePermission` (`systemActor.ts:12-15` note). The 3 `system.*` perms are unusable by any HTTP path. |
| Audit representation | If a System ctx ever wrote audit: `actorId = "system:..."` verbatim (`auditWriter.ts:90,122`), `audit_logs.actor_id` is `text NOT NULL` with **no FK** (`schema/pg.ts:1017`) → storable. Today scanners write no audit rows (§1); their durable record is the interruption event ledger with `actorId: null` (`attemptCommands.ts:688`) — note `attempt_interruption_events.actor_id` **has** a `users` FK (`schema/pg.ts:818`), so a `"system:*"` string could NOT be written there even if desired; null is the only legal value. |
| Nullable/non-null actor across incident + audit tables | `exam_incidents.reported_by text NOT NULL` no FK (`schema/pg.ts:1725`) → a System creator needs a non-null string id (`system:*` fits). `exam_incidents.resolved_by` nullable (1724). `exam_incident_events.actor_id text` nullable, no FK (1801). `exam_incident_actions.actor_id` nullable, no FK (1845). `exam_incident_attempts.linked_by text NOT NULL` no FK (1897); `exam_incident_interruption_links.linked_by text NOT NULL` no FK (1944). `audit_logs.actor_id text NOT NULL` no FK (1017). → **The incident tables can store a synthetic System id everywhere they need one; no schema change is required for actor representation.** |

**Verdict: SYSTEM_ACTOR_LATENT = no** (actor is real), with the scoped caveat that *System-as-incident-authority* is latent (ADR-014 gate, §10/§12).

---

## 4. A4 — Complete inventory of incident mutations

All routes registered in `apps/api/src/routes/incidents.admin.ts` (`registerAdminIncidentRoutes`, line 471) + route registry entries `apps/api/src/authz/routeRegistry.ts:1381-1503`. Every route: `fastify.authenticate` + scoped capability preHandler; actor identity comes ONLY from `request.ctx` (§7 anti-spoofing).

| # | Command (engine) | Route | ACTOR / PERMISSION | COMMAND OWNER | AUDIT | RECEIPT / IDEMPOTENCY |
|---|---|---|---|---|---|---|
| 1 | `createExamIncident` | POST `/admin/exams/:examId/incidents` (route 473-582) | Human; `IncidentCreate` via exam resolver; `proctorAccess: "assignment_scoped"` (registry 1384-1392) | route → `withIncidentOperationRecovery` tx → engine (`incidents.admin.ts:522-573`) | `incident.created` atomic, identifiers+type+version only (`incidentCommands.ts:587-593`; policy `auditPolicy.ts:792-800` active/atomic/privileged_mutation) | client `operationId` uuid (route schema 66); pre-read replay (`incidentCommands.ts:495-502, 330-355`); arbiter = unique `exam_incident_events_org_operation_unique (organization_id, operation_id)` (`schema/pg.ts:1808-1811`); 23505 + RR-race recovery wrapper (`incidentOperationRecovery.ts:54-55, 211-275`) |
| 2 | `startIncidentInvestigation` | POST `/admin/incidents/:incidentId/investigate` (659) | Human; `IncidentInvestigate`, incident resolver (registry 1418-1426) | `versionBumpCommand` core (`incidentCommands.ts:1047-1166`): lock `FOR UPDATE` → in-lock op recheck (1099-1114) → `expectedVersion` check (1117-1122) → terminal check (1124-1129) | `incident.investigated` (auditPolicy 807) | operationId + expectedVersion + canonical payload |
| 3 | `addIncidentNote` | POST `…/notes` (733) | `IncidentInvestigate` (registry 1429) | append-only, no version bump (`incidentCommands.ts:610-663`) | `incident.note_added` | operationId |
| 4 | `changeIncidentSeverity` | POST `…/severity` (797) | `IncidentInvestigate` (registry 1440) | version bump, allowed `open/investigating` (`incidentCommands.ts:1211-1262`) | `incident.severity_changed` w/ before/after severity | operationId + expectedVersion |
| 5 | `resolveExamIncident` | POST `…/resolve` (873) | `IncidentResolve` — Admin-only (`proctorAccess` terminal judgment, route doc 468-469; registry 1451-1457) | version bump → `status=resolved`, `resolvedBy=ctx.actorId` (`incidentCommands.ts:1264-1314`) | `incident.resolved` | operationId + expectedVersion |
| 6 | `dismissExamIncident` | POST `…/dismiss` (946) | `IncidentResolve` — Admin-only (registry 1462-1468) | version bump → `status=dismissed`, `resolvedBy=ctx.actorId` (`incidentCommands.ts:1316-1365`) | `incident.dismissed` | operationId + expectedVersion |
| 7 | `linkIncidentAction` | POST `…/actions` (1019) | `IncidentInvestigate` (registry 1473) | append-only; scope quadruple (396-431); `misconduct_mark` rejected (695-697); force_submit requires audit-existence fact (756-764) | `incident.action_linked` | operationId + unique `exam_incident_actions_org_action_unique (org, actionType, actionId)` (`schema 1852-1856`), 23505 → `IncidentActionAlreadyLinkedError` (`incidentCommands.ts:803-810`) |
| 8 | `linkIncidentAttempt` | POST `…/attempts` (1131) | `IncidentInvestigate` (registry 1484) | append-only; anchor exclusivity (847-851) | `incident.attempt_linked` | operationId + unique `(incidentId, attemptId)` (schema 1901-1904) |
| 9 | `linkIncidentInterruption` | POST `…/interruptions` (1216) | `IncidentInvestigate` (registry 1495) | append-only; episode→attempt server-derived (956-967) | `incident.interruption_linked` | operationId + unique `(incidentId, interruptionId)` (schema 1948-1950) |
| 10 | (read) queue/detail/aggregates | GET `/admin/recovery/incidents[/:id]`, `/admin/recovery/attempts/:attemptId`, `/admin/recovery/exams/:examId`, `/admin/incidents/:incidentId/detail`, `/admin/proctor/incidents` (1313-1857) | Admin: `IncidentRecoveryView`, `proctorAccess: "admin_only"` (registry 1506-1533); Proctor: `incident.view` + active assignment | recoveryRepo read models | sensitive-read audit where applicable | — |

Legacy non-creator: POST `/admin/attempts/:attemptId/proctor-incident` is audit-only and explicitly does NOT create ADR-014 incidents — "the sole incident-creation path is `createExamIncident()` via POST /admin/exams/:examId/incidents" (`apps/api/src/routes/proctorMonitoring.ts:208-216`).

**INCIDENT_CREATE_OWNER**: `createExamIncident` (engine, `incidentCommands.ts:448-603`), reachable ONLY through the human-permission route above. The command sets `reportedBy: ctx.actorId` (line 568) and `actorId: ctx.actorId` on the created event (line 579) — it is actor-parametric but the ONLY wired callers are human-session routes.

**Key question answered**: yes — the current create command is *effectively human-authored*: there is no code path that invokes it with a System context, and the route entrance demands `IncidentCreate` which no System path can present (§3). If System-generated incidents are built, System **must get a distinct command seam** (a System-only invocation path deriving the actor from `createSystemRequestContext`, not from any request), and no route may accept `actor=System` from input (§7). Human-command spoofing (fakeAdmin/fakeProctor) is forbidden and today impossible from HTTP (§7).

**IDEMPOTENCY_OWNER**: the `(organization_id, operation_id)` unique index on `exam_incident_events` (`incidentOperationRecovery.ts:50-55`, `schema/pg.ts:1808-1811`) is the sole arbiter for every incident write command; `payloadsEqual` canonical-payload comparison (`incidentCommands.ts:311-326`) distinguishes replay from conflict.

---

## 5. A5 — Stable detector candidates

### 5.1 Heartbeat staleness → interruption episode (CANDIDATE-D1)

- SOURCE OWNER: `apps/api/src/plugins/heartbeat.ts` (scan loop 222-266; per-org `attemptRepo.listInProgress(ctx)` line 184; threshold evaluation `scanForDisruptedAttempts` 63-98: `elapsed >= heartbeatTimeoutMs`).
- CURRENT SEMANTIC: an `in_progress` attempt with no heartbeat for ≥ timeout (default 60s, `DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000` line 20; config `heartbeat.heartbeatTimeoutSeconds` line 226) is marked `disrupted`.
- PERSISTED FACT: YES — `markDisrupted` (`packages/exam-engine/src/attemptCommands.ts:633-702`) creates the episode parent (`episodeRepo.create`, line 673), inserts a `detected` event with `detectionSource: "heartbeat_timeout"`, `observedLastActivityAt`, `timeoutSeconds`, `policy` (676-689), and sets the attempt active pointer `currentInterruptionId` (691-696). Under-lock rechecks prevent stale-scan and lost-race duplicates (641-661; outcomes `fresh_under_lock` / `state_changed_before_lock` / `missing`, 611-615).
- ALREADY HAS SIDE EFFECT: YES (attempt status change + episode). The incident would be a NEW consumer of the already-durable `marked` outcome, not a second detector.
- FALSE-POSITIVE RISK: the disruption itself is the product decision already taken (SPEC.md:139 "心跳超时自动标记(60s 无心跳) — 后端已接线"); an incident duplicating a *deliberate* disruption is low-risk, but per-candidate noise depends on the 60s threshold (SPEC.md:39 flags 心跳调参 as not yet production-evaluated).
- RECOVERY SEMANTIC: episode ends with exactly one `restored` or `terminalized` outcome event (schema 826-828); deadline scanner terminalizes disrupted attempts with `deadline_terminalization` (`deadlineScanner.ts:222-247`).
- CLASSIFICATION: **GOOD_FIRST_DETECTOR** — strongest candidate. The episode `detected` event is exactly the "bounded stable fact" #304 asks for, and the interruption link table (`exam_incident_interruption_links`) already has the evidence-correlation vocabulary.

### 5.2 Deadline expiry auto-submit (CANDIDATE-D2)

- SOURCE OWNER: `apps/api/src/plugins/deadlineScanner.ts` (discovery `listDeadlineCandidates` 296; authoritative `autoSubmitAndGrade` 147-273; canonical seam `isAttemptDeadlineExpired` 186-197; submit with `source: "deadline_scanner"`, `submissionReason: "deadline"` 249-253).
- PERSISTED FACT: the submitted attempt itself (`submission_reason='deadline'` frozen into `submitted_answers`, comment 199-202).
- SIDE EFFECT: the outcome IS a terminal domain transition; a "deadline reached" incident would be pure duplication of an already-frozen domain fact.
- FP RISK: none (canonical under-lock decision); but incident value ~zero — operators see graded attempts.
- CLASSIFICATION: **ALREADY_OWNED_BY_ANOTHER_FLOW**. Not a v1 detector.

### 5.3 systemMonitor health status (CANDIDATE-M)

- `packages/exam-engine/src/systemMonitor.ts:18-23` — `computeStatus` is a PURE function over `{cpu, memory, dbResponseMs}` (critical >95, degraded >80, else ok). No persistence, no window, no episode notion. Sole consumer: `apps/api/src/routes/system.ts` diagnostics (verified by grep). #304's claim "systemMonitor computes health status but is not an incident producer" is **code-true**.
- CLASSIFICATION: **UNSTABLE_SIGNAL** (instantaneous percentages; no durable fact; would storm). Not a v1 detector.

### 5.4 Email delivery dead letters (CANDIDATE-E)

- `packages/db/src/repository/emailOutboxRepo.ts:405-423` — terminal `dead` status with sanitized `lastError` after `maxAttempts`; counts exposed (453-472). Audit actions `email.send_failed` / `email.send_retried` exist (`auditActions.ts:138-139`).
- CLASSIFICATION: **NEEDS_PRODUCT_DECISION** — a durable failure fact exists, but exam-integrity impact, per-recipient vs per-batch episode semantics, and noise bounds are undefined. Not v1.

### 5.5 Others investigated and rejected

- Proctor incident reports: human observations; already the human create path (`proctorMonitoring.ts:208-216`). Not a system detector.
- Admission queue staleness: **no sweep exists** — only heartbeat + deadlineScanner loops run (grep `setInterval apps/api/src -g '!*.test.ts'` → `heartbeat.ts:230`, `deadlineScanner.ts:338`, plus email worker poll `emailDeliveryWorker.ts:343,356`). No admission timeout semantics today. NO_SIGNAL.
- Recovery queue / force-submit: human flows (force-submit is a receipt-backed operator command). Not detectors.
- `migration_backfill` detection source exists (`domain/types.ts:370-372`) — one-shot migration semantics, explicitly not a runtime detector.

**SELECTED V1 DETECTORS (proposal): exactly one — CANDIDATE-D1 (heartbeat-disruption episode)**. The `markDisrupted → "marked"` outcome triggers the first creation attempt; the `exam_incident_events` op-unique arbiter — not the one-shot return value, not link-row presence — is the completion authority, with the episode ledger as the per-cycle discovery source (§6, §8.6). Zero additional detectors in v1.

---

## 6. A6 — Detector execution owner (DETECTOR_EXECUTION_OWNER)

**DETECTOR_EXECUTION_OWNER: the existing heartbeat scanner cycle.** No new scheduler is needed and none should be created:

- The loop already exists, is lifecycle-managed (`setInterval` + `onClose` + `activeScan` single-flight guard, `heartbeat.ts:228-266`), iterates orgs with per-org System contexts (176-182), and the point where the stable fact is durably committed is precisely `markDisrupted` returning `{ outcome: "marked", attempt }` (`attemptCommands.ts:701`).
- **The incident creation must NOT be tied to the one-shot `marked` return value as its completion authority.** A crash between the episode commit and the incident command would leave a durably committed episode that no scanner pass ever revisits — after the crash, `listInProgress()` no longer returns the disrupted attempt, so the `marked` outcome is never observed again: a permanent missed incident (§8.5). At-most-once dedupe (F4) does not provide eventual completion.
- Implementation shape (no new worker, no event bus, no outbox framework): the heartbeat cycle gains ONE bounded reconciliation leg — after the disruption scan, re-derive from the durable ledger the heartbeat-detected episodes whose canonical System create operation has NOT yet durably committed (completion probe = the op-unique arbiter itself: no `exam_incident_events` row for `(organization_id, deterministicOperationId(E))`, §8.6; link-row presence is NOT part of the predicate — a human evidence link never completes the System command, Corrective-3 in §8.6), and invoke the idempotent System create command for each (`createSystemIncidentFromHeartbeatEpisode(E1)` → canonical incident + interruption link). Bounded = per-cycle, DB-discovered, arbiter-idempotent (§8.6 crash traces C1–C4).
- Proof that no other seam is preferable: deadlineScanner already owns expiry (D2 rejected); systemMonitor has no cycle at all (it is a per-request computation); email worker owns outbox draining. A "bounded scheduler" abstraction is forbidden by the campaign discipline (#516: no generic detector framework).
- Single-instance note: scanner metrics are documented "single-instance counters reset on server restart" (`deadlineScanner.ts:59-70`, `heartbeat.ts:44-51`) — the supported topology is one API process (status doc Gate 0.5 note, `docs/status/implementation-status.md:367-369`). Multi-instance convergence therefore rests on DB constraints, not the loop (§8/§9).

---

## 7. A14 (taken early) — Anti-spoofing: can a caller claim actor=System? (SYSTEM_SPOOFING)

**SYSTEM_SPOOFING_POSSIBLE: no.**

- `request.ctx` is constructed in exactly one place: `fastify.authenticate` (`apps/api/src/plugins/auth.ts:175-186`), from a verified JWT cookie (64-85) → DB user row (87-115) → authEpoch revocation check (117-126) → ACTIVE `user_role_assignments` authority (128-173). `actorId: user.id` comes from the database, never from request input.
- No incident route schema contains an actor field (create body schema `incidents.admin.ts:65-75`: operationId/type/description/attemptId/candidateId/severity/occurredAt only); `reportedBy` is derived server-side (`incidentCommands.ts:568`).
- System contexts are constructed only inside the two scanner plugins through the closed `SYSTEM_ACTOR_IDS` set with a runtime throw on unknown ids (`systemActor.ts:32-34, 54-58`); no route imports the factory (grep: only `deadlineScanner.ts`, `heartbeat.ts` + tests).
- System cannot authenticate at all: `loginAllowed: false` (`presets.ts:399`) enforced by `ASSIGNABLE_LOGIN_ROLES` (6 human roles, `auth.ts:74-80`) at login (337-345); even a forged role claim cannot widen access because capabilities come from assignments, not claims (`auth.ts:128-134, 188-200`).
- `system.incident.create` does not exist in the permission catalog today — grep over `packages/authz/src` finds it only in a test name asserting its absence: `presets.test.ts:111` "System holds ZERO incident permissions (system.incident.create is reserved, NOT in catalog)".

**Therefore: the internal command path for System incidents must be internal-only (construct ctx via `createSystemRequestContext` with a NEW closed actor id, e.g. `system:incident-detector`, added to `SYSTEM_ACTOR_IDS`), and any future HTTP surface must never accept actor identity from input.**

---

## 8. A7/A8/A9/A10 — "Same incident": identity, durable dedupe, concurrency, restart

### 8.1 Existing identity seams (inventory)

1. Event identity / command receipt: `exam_incident_events_org_operation_unique (organization_id, operation_id)` (`schema/pg.ts:1808-1811`) — per-command idempotency arbiter.
2. Episode identity: `attempt_interruptions.id` ("Stable parent identity for one interruption episode", schema 657-680); exactly one `detected` and one outcome event per episode (partial uniques 823-828).
3. Attempt transition identity: `exam_attempts.status` + `currentInterruptionId` active pointer (`markDisrupted` step 7, `attemptCommands.ts:691-696`); status machine only `in_progress → disrupted` from `in_progress` (recheck 648-650), so one disruption per episode, and repeat scans skip non-`in_progress` rows (`heartbeat.ts:74`).
4. Link identity: `(incidentId, interruptionId)` unique (1948-1950) — per-incident evidence uniqueness only.
5. Operator action receipts: `attempt_command_receipts` / time-adjustment operation uniques (schema 712-718) — outside incident scope.

### 8.2 The gap (DEDUP_DURABLE_OWNER / DURABLE_DEDUP_GAP)

**DURABLE_DEDUP_GAP: yes.** `exam_incidents` has NO source-fingerprint column and no uniqueness beyond `(organization_id, id)` (`schema/pg.ts:1731-1734`). Nothing in the DB expresses "at most one ACTIVE System incident per semantic condition/episode". The `(incidentId, interruptionId)` unique constrains links within one incident, not across incidents — two incidents could each link the same episode.

Frozen arbiter (single authority — no OR): a deterministic `operationId` for the System create command, derived from the episode id (uuid v5 namespace), riding the EXISTING `exam_incident_events_org_operation_unique (organization_id, operation_id)` as the dedupe arbiter — zero schema change. The partial-unique-index variant is NOT adopted: operation/retry identity and episode→incident uniqueness coincide here because the operationId is a pure function of the episode id, so a second schema-level source-fingerprint mechanism would add authority duplication, not a new guarantee. Semantic freeze: **episode id = the source fingerprint; one episode ⇒ at most one SYSTEM incident, enforced durably by the operation-unique arbiter, never in process memory.** The arbiter intentionally does NOT constrain human-created incidents: `exam_incident_interruption_links` keeps only `(incident_id, interruption_id)` uniqueness (`schema/pg.ts:1948-1950`), so several incidents — all human, or human + System — may legally reference one episode; #304 introduces no org-level episode-unique constraint on the link table (that would rewrite existing human incident semantics, which is not #304's problem).

### 8.3 Three traces with the proposed semantics (heartbeat detector)

- **T1** (condition true across many scans): first scan marks the attempt `disrupted` and creates episode E1 (subsequent scans skip — status no longer `in_progress`, `heartbeat.ts:74`; under-lock rechecks `attemptCommands.ts:647-661`). One episode ⇒ exactly ONE System incident (dedupe by E1). ✔ exactly one incident.
- **T2** (incident created → human resolves/dismisses while condition still true): the condition "same episode" cannot recur — the attempt is `disrupted`, not `in_progress`; no new episode can spawn for the same staleness while E1 is active. The resolved/dismissed incident stays terminal (terminal-monotonic, `incidentCommands.ts:1124-1129`; reopen forbidden, ADR-014 §17). ✔ suppressed for episode E1.
- **T3** (condition clears → later true again): recovery (`resumeAttempt` / `restoreInterruptedAttempt`) terminalizes E1 with a `restored` outcome and returns the attempt to `in_progress`; a later staleness creates a NEW episode E2 (new fingerprint) ⇒ a NEW incident is allowed. This matches ADR-014 §17: "reopening resolved/dismissed incidents (a new problem is a new incident)."

### 8.4 Concurrent detector trace (CONCURRENT_DETECTOR_CONVERGENCE)

Two racers (two org-loop iterations, or hypothetically two app instances) both observe staleness for attempt A:

1. Both enter `markDisrupted`; the attempt row `FOR UPDATE` (642) serializes them. The loser observes `status !== "in_progress"` (648-650) or fresh `lastActivityAt` (652-661) and returns a no-op outcome. ⇒ exactly ONE `marked` outcome and ONE episode exist, guaranteed by the existing lock protocol (probe-verified by `heartbeat.test.ts` "does not count a no-op race (onDisrupted returns false) in markedCount").
2. The single `marked` consumer then runs the System create command. If (pathologically) two consumers raced with the SAME deterministic operationId: the operation-unique 23505 fires and the `withIncidentOperationRecovery` wrapper converges to `idempotent_replayed` (`incidentOperationRecovery.ts:234-250` — insert-or-replay convergence, recovery at most once, never recursion).
3. If two consumers used DIFFERENT operationIds for the same episode, the current schema would allow two incidents — this is exactly the DURABLE_DEDUP_GAP. The freeze (F4) closes it by mandating the operationId be a pure function of the episode id: every legitimate consumer of one episode carries the SAME operationId into the op-unique arbiter, so "different operationIds for one episode" is itself a contract violation, not a race the schema must tolerate.

**CONCURRENT_DETECTOR_CONVERGENCE: attempt-row FOR UPDATE ⇒ one episode; deterministic operationId + existing op-unique ⇒ one SYSTEM incident. No advisory locks, no process-memory coordination.**

### 8.5 Restart semantics (A10) — split into safety and liveness

**Safety (no duplicate/storm): SAFE.** Both scanners are stateless per cycle: full DB re-discovery each tick (`organizationRepo.list` → `listInProgress` / `listDeadlineCandidates`, `heartbeat.ts:174-184`, `deadlineScanner.ts:280-296`); process-memory objects are metrics/single-flight guards only (`heartbeatMetrics`, `deadlineScannerMetrics`). After an API restart the heartbeat scan re-evaluates `in_progress` attempts only; the already-disrupted attempt is invisible to the detector, so no duplicate episode or attempt mutation can occur — with or without dedupe.

**Liveness (no permanently missed incident): NOT guaranteed by dedupe or the `marked` return value.** Trace: episode E1 commits (attempt now `disrupted`) → process crashes before the System incident command runs → on restart `listInProgress()` no longer returns the disrupted attempt → E1 is never consumed again. DURABLE_DEDUP_GAP's fix (F4) guarantees at-most-ONE incident per episode; it does not guarantee that the one incident is EVER created:

```text
DEDUP ≠ DELIVERY
SAFETY ≠ LIVENESS
```

This gap is closed by F4A (§8.6), not by dedupe. If completion authority were process memory or the one-shot `marked` return → BLOCKED.

### 8.6 Durable completion (F4A) and crash traces

**F4A — DURABLE SYSTEM COMPLETION (freeze, Corrective-3):** a committed heartbeat-detected episode remains reconcilable until its canonical SYSTEM create operation has durably committed — i.e. the episode-derived deterministic operationId exists in the `exam_incident_events` op-unique arbiter. Scanner process memory and the one-shot `marked` return value are NOT completion authority; a human-created incident or human interruption link is NOT completion authority either:

```text
FIELD/LINK EXISTS ≠ SYSTEM COMMAND COMPLETED
```

Implementation shape (the only freeze-sanctioned one): the heartbeat cycle's bounded reconciliation leg (§6) re-derives candidate work from the durable ledger — heartbeat-detected episodes (`detection_source="heartbeat_timeout"`) with NO `exam_incident_events` row under `(organization_id, deterministicOperationId(E))` — and invokes the System create command idempotently per episode; the command commits incident + interruption link in ONE transaction, so op-committed ⟺ the System link exists. That atomicity is a build requirement for the NEW System command, not an as-built fact: the existing human `createExamIncident` writes no interruption link (linking is a separate command with its own operationId and transaction, `incidentCommands.ts:923`), so reusing the create-then-link two-command pattern would break the biconditional that C2/C3 rest on. The F4 episode-derived operationId makes every retry converge to the same single System incident. Candidate-enumeration bounding (including the activation-time backfill question for pre-existing episodes) is an implementation evidence obligation, not a freeze item.

**Cross-authority corner (final review round 3, Corrective-3 — supersedes the round-2 "human-first corner" freeze):** inside the crash window a human may link the episode to a human-created incident (`POST /admin/incidents/:incidentId/interruptions`, `incidents.admin.ts:1216-1226`). The link table's only constraint is `UNIQUE (incident_id, interruption_id)` (`schema/pg.ts:1948-1950`), so the SAME episode is legally referenceable by multiple incidents, and `linkIncidentInterruption` can only prevent duplicate links from the SAME incident — nothing in the DB expresses "one episode has any link at all". The superseded freeze claimed the reconciliation leg skips an episode with ANY link ("human link completes the episode"); that invariant does not exist, and it conflated two authorities: a human evidence correlation is not the System detector's completion fact. Corrective-3 removes human links from the completion predicate entirely — the reconciliation leg ignores link rows and probes only the System operation arbiter; a human-created incident/link neither satisfies, cancels, nor replaces the System create command. Human-path semantics are UNCHANGED by #304.

Crash/race traces this must satisfy (implementation evidence obligations, not design options):

- **C1** episode commits → crash before incident command → restart → reconciliation leg finds the unconsumed episode (op not committed) → exactly one SYSTEM incident.
- **C2** incident command commits → caller loses the result (crash before acknowledgement) → retry → `idempotent_replayed` returns the SAME System incident (op-unique arbiter).
- **C3** two reconcilers race on one episode → both derive the same episode-derived operationId → 23505 + `withIncidentOperationRecovery` insert-or-replay → exactly one System incident/link.
- **C4** a human-created incident H referencing E commits while System reconciliation is in flight (true `Human ∥ System` interleaving, either ordering) → H stands; the System create still commits exactly one SYSTEM incident with its own link — both links satisfy `(incident_id, interruption_id)` — convergence = exactly one SYSTEM incident, NOT one incident globally; no cross-authority race exists because the two authorities share no completion predicate.

---

## 9. A16 — Executable reality probes (R1–R7)

Environment constraint encountered: Docker Desktop WSL integration is OFF in this distro (`docker: command not found`; `/mnt/wsl/docker-desktop` absent; nothing listening on 5532/6479/5432/6379 via `ss -tlnp`). The prescribed `docker compose -f docker-compose.dev.yml up -d db redis` could not run, so **no PostgreSQL was available**; DB-backed suites could not execute. Per mission discipline these are SKIPPED, not faked. A temporary DB-free vitest config (`apps/api/vitest.probe.config.ts`, standalone, `globalSetup: []`) was created to witness the two pure-unit scanner suites and **deleted after the run** (worktree verified clean).

| Probe | Status | Outcome / evidence |
|---|---|---|
| R1 human incident creation (API route tests) | **SKIPPED** | `apps/api/src/routes/incidents.admin.test.ts` + `incidents.admin.concurrency.test.ts` + `recovery.admin.test.ts` are DB-backed; API vitest `globalSetup` hard-fails: "Test database is unreachable after 5 attempts" (`/tmp/maint1/probe-scanners.log:12`); PG unreachable (Docker off). |
| R2 scanner/sweep signal generation | **DONE** (unit level) | `heartbeat.test.ts` 7 tests + `deadlineScanner.test.ts` 5 tests PASS (`/tmp/maint1/probe-scanners.log`: "Test Files 2 passed … Tests 12 passed"). Key cases: "marks attempts as disrupted when heartbeat timeout exceeded", "skips non in_progress attempts", "does NOT increment submittedCount when onCandidate returns false (under-lock no-op)", "records failedCount … (retry next scan)". Engine-level: full `@exam/exam-engine` suite 743/743 PASS (`/tmp/maint1/probe-incidentCommands.log`) incl. `restoreInterruption`, `deadlineReconciliation`, `systemMonitor` (8 tests). |
| R3 audit actor representation | **PARTIAL DONE / DB probe SKIPPED** | Code-level (authoritative): `audit_logs.actor_id text NOT NULL` no FK (`schema/pg.ts:1017`); `exam_incident_events.actor_id` nullable no FK (1801); `attempt_time_adjustments.actor_id`/`attempt_interruption_events.actor_id` HAVE `users` FK (708, 818) — hence `markDisrupted` writes `actorId: null` (`attemptCommands.ts:688`). Authz suites PASS 83/83 (`/tmp/maint1/probe-authz.log`) incl. `systemActor.test.ts` (7 tests: closed id set, runtime rejection of unknown ids, role=System). Real row inspection SKIPPED (no PG). |
| R4 duplicate command behavior | **DONE** | `incidentCommands.test.ts` (55 tests PASS): "replays same operationId + same payload as idempotent_replayed" (test line 275), "throws IdempotencyConflictError on same operationId + different payload" (line 316), canonical-payload identity suite (describe line 982). |
| R5 terminal resolution | **DONE** | Same suite: "throws InvalidStateTransitionError on terminal status" (line 443); resolve/dismiss suites (describes 517, 548) PASS. Terminal-monotonic confirmed at engine level. |
| R6 restart/readback persistence | **SKIPPED (runtime) / code-verified** | No DB. Code-level: scanners are stateless per cycle (§8.5); engine `deadlineReconciliation` + `restoreInterruption` suites PASS in the engine run, covering reconcile-on-reopen logic. |
| R7 concurrent duplicate attempt | **SKIPPED (runtime) / code-verified** | No DB. Code-level: op-unique + `withIncidentOperationRecovery` (§8.4); `incidents.admin.concurrency.test.ts` exists but is DB-backed. |

---

## 10. A11 — Human terminal judgment boundary

Terminal statuses `resolved`/`dismissed` are absorbing: any transition on a terminal incident is rejected (`incidentCommands.ts:155, 1124-1129`), and ADR-014 §17 forbids reopening ("a new problem is a new incident", `docs/adr/ADR-014-exam-incident-authority.md:1110`).

**HUMAN_RESOLUTION_SEMANTICS: choice (B) — suppress per episode; re-arm on a new episode.** Rationale from CURRENT semantics, not invention:
- The natural episode fingerprint (interruption episode id) already hard-suppresses recurrence within an episode: a `disrupted` attempt cannot be re-disrupted (status recheck `attemptCommands.ts:648-650`), so after dismissal the same episode cannot re-trigger anything.
- A condition that clears (episode `restored`/`terminalized`, unique outcome per episode schema 826-828) and later recurs necessarily creates a NEW episode (`markDisrupted` creates a new parent each time, line 673) — "a new problem is a new incident" (ADR-014 §17). Suppressing across episodes would contradict the ADR's own reopen rule.
- **Product ruling (final review, 2026-09-13): F5 = (B), PER_EPISODE — FROZEN, no open decision remains.** Dismissal terminalizes the episode's case only; a new episode after re-arm MAY produce a new System incident. The stricter "dismiss = suppress this attempt forever" variant is REJECTED: it would invent a new durable policy state (attempt-level permanent suppression) with no existing policy authority behind it, and it contradicts ADR-014 §17's own "new problem = new incident" rule. `dismiss` means "this case needs no further handling", never "future similar facts on this attempt are forbidden". If attempt-level suppression ever becomes a real requirement it must return as an explicit suppression feature with its own authority, not as `dismiss` semantics.

---

## 11. A12 — SYSTEM_INCIDENT_EVIDENCE_CARD (narrow)

Everything a v1 evidence card genuinely needs is ALREADY persisted on the episode `detected` event (`schema/pg.ts:790-829`, populated at `attemptCommands.ts:676-689`):

| Field | Already-persisted source |
| ---|---|
| detector identity | `detection_source = "heartbeat_timeout"` (`InterruptionDetectionSource`, `domain/types.ts:370-372`) |
| source resource | `interruptionId` (episode) + `attemptId` |
| trigger fact | `observedLastActivityAt` + `timeoutSeconds` + `occurredAt` (scanner tick) |
| episode/fingerprint | `interruptionId` |
| policy context | `policy` (snapshot-frozen, 815) |

⇒ The System incident's evidence = a REFERENCE to the episode (an interruption link row) + `occurredAt`/description derived from the detected event. **No new evidence blob, no generic evidence platform, no new JSON column.** The link table (`exam_incident_interruption_links`) already carries `linkedBy` NOT NULL no-FK (1944) so `system:*` fits.

---

## 12. A13 — Audit visibility: will a null/synthetic actor break Admin/Proctor surfaces?

**No breakage. Evidence:**

- Admin Recovery aggregate audit references: `packages/db/src/repository/recoveryRepo.ts:987-1022` LEFT JOINs `users` on `auditLogs.actorId = users.id` (+ org predicate); the code **explicitly normalizes** missing names: "null actorName is a legitimate audit-contract outcome … the actorId is still projected verbatim" (comment 1016-1019). Wire schema: `actorId: z.string().nullable()`, `actorName: z.string().nullable()` (`packages/contracts/src/recovery.ts:341-349`).
- UI renders the raw id as fallback: `apps/web/src/pages/admin/RecoveryIncidentDetailPage.tsx` (`{r.actorName ?? r.actorId ?? "—"}`), `RecoveryAttemptDetailPage.tsx` (`{entry.actorName ?? entry.actorId}`), `AuditLogPage.tsx` (`{item.actorName ?? item.actorId}` — with tests asserting the fallback path).
- `incident.reportedBy` is a plain non-null string on the wire (`recovery.ts:75`), rendered verbatim without any user join/name resolution (`RecoveryIncidentDetailPage.tsx:363-366`); DB column has no FK (`schema/pg.ts:1725`). A `system:incident-detector` value renders as that string.
- Incident event/`actorId` fields are nullable strings in contracts (`recovery.ts:141,150,160,227,314`).
- One REAL FK constraint to respect: `attempt_time_adjustments.actor_id` and `attempt_interruption_events.actor_id` reference `users.id` (schema 708, 818) — System ids can never be written there; the existing convention is `actorId: null` (`attemptCommands.ts:688`). Any new System audit trail must live in `audit_logs` / incident tables (no FK), not in these two ledgers.
- i18n labels exist for 上报人/解决人 (`apps/web/src/i18n/locales/zh-CN.ts`) but are plain labels over raw values — no human-name assumption.

---

## 13. A15 — False-positive controls per candidate (summary)

| Candidate | Required fact | Existing threshold/window | Transient/replay/stale-scan risk | Verdict |
|---|---|---|---|---|
| D1 heartbeat | episode `detected` event | 60s timeout (config), under-lock freshness recheck (`attemptCommands.ts:652-661`), one detected event per episode (schema 823-825) | replay impossible (episode idempotent); stale scans re-checked under lock; idleness ≠ malfunction is a product-visibility tradeoff already accepted for `disrupted` | controlled |
| D2 deadline | canonical expiry | `isAttemptDeadlineExpired` under Attempt+Exam FOR UPDATE; discovery is an over-approximation that never submits by itself (`deadlineScanner.ts:32-46, 186-197`) | none; one-shot per attempt | controlled but valueless as incident |
| M systemMonitor | none persisted | instantaneous % only | high (no window, no persistence) | unstable |
| E email dead | `dead` outbox row | maxAttempts + backoff (`emailOutboxRepo.ts:405-423`) | terminal (not transient); batch noise unbounded per campaign | needs product decision |

No generic threshold DSL / rule config / cooldown engine is needed for v1 — all controls already exist in the owned flows.

---

## 14. Phase 2 — CODE REALITY vs NORMATIVE INTENT

Normative sources read: #304 body summary (given), #516 item 6 discipline (given: bounded stable detector → distinct System command → canonical incident aggregate → audit/evidence → human terminal judgment; forbidden: rules engine/ML/event bus/automatic punishment/human-command spoofing), `docs/adr/ADR-014-exam-incident-authority.md` (ACCEPTED, `docs/adr/README.md:176`), `docs/adr/ADR-013-interruption-time-compensation-policy.md`, `docs/adr/ADR-010-scoped-rbac-architecture.md` (§System Actor line 302, §System Actor Policy line 748, SYSTEM-M1 line 1182), `docs/SPEC.md`, `docs/architecture/exam-runtime.md`, `docs/architecture/authorization.md`, `docs/roadmap/post-mvp-issues.md`, `docs/status/implementation-status.md`.

| Area | Code reality | Normative intent | Classification |
|---|---|---|---|
| System actor identity | SYSTEM-M1 landed: role System + closed `system:*` ids + non-login + non-assignable (§1, §3) | ADR-010 §System Actor Policy (748-761): real System role, `actorId="system:…"`, never Admin; SYSTEM-M1 goal (1182-1183) | **ALIGNED** |
| System incident permission | `system.incident.create` NOT in catalog; test asserts the reservation (`presets.test.ts:111`) | ADR-014 §8: RESERVED by name/shape only; gate UNSATISFIED until 5 conditions hold (592-606) | **ALIGNED** (reservation honored) — but opening the gate requires the ADR corrective below (ADR_RECONCILIATION_REQUIRED) |
| System incident command | None; sole create path is human-routed `createExamIncident` (§4) | ADR-014 §8 condition 3: "a canonical System-only incident command exists"; §17 non-goal today | **AUTHORITY_GAP** (by design; this is #304's work item) |
| `source=system_incident` adjustments | Vocabulary in enum + CHECK branch, zero writers (`domain/types.ts:378`, `schema/pg.ts:730,769`) | ADR-013:644 "remains disabled until REC-I6 defines a System-only incident grant permission and incident authority"; ADR-014:18-19, 133-134 | **LATENT** (code+docs consistent; activation gated) |
| Incident aggregate, creation matrix, idempotency, terminal monotonic | As built (§4) | ADR-014 §2/§7/§9 frozen | **ALIGNED** |
| Incident audit actions | 9 actions active/atomic/privileged_mutation (§4) | ADR-014 §11 | **ALIGNED** |
| systemMonitor not an incident producer | pure function, diagnostics-only consumer (§5.3) | #304 body + SPEC.md:39 ("系统级 incident 的自动生成" 尚未产品化) | **ALIGNED** (docs NOT stale) |
| Heartbeat/disruption as detector input | durable episode + detected fact (§5.1) | #516 "bounded stable detector"; ADR-013 freezes episode semantics; ADR-014 §7: interruption ledger remains time-compensation authority, incidents are cases | **ALIGNED** (episode→incident correlation is exactly the intended evidence shape) |
| Same-episode / re-arm semantics | episode identity exists; no episode→incident dedupe constraint (§8.2) | ADR-014 §17 reopen rule implies new-episode=new-incident; nothing normative states dedupe authority | **UNDERSPECIFIED** → freeze F4/F5 |
| Audit actor for non-human | audit_logs/incident tables accept `system:*`; two ledgers are users-FK-bound with null convention (§3, §12) | ADR-010 decision 6: audit `actorId="system:..."` | **ALIGNED** (with the FK caveat as a boundary) |
| Status/roadmap documents | — | `implementation-status.md:363` "System-generated incidents — not implemented (Issue #304)"; `post-mvp-issues.md:40` | **ALIGNED** (docs truthful) |
| Human terminal judgment | Admin-only resolve/dismiss, terminal-monotonic (§4, §10) | #516 "human terminal judgment"; ADR-014 §8 matrix (System: resolve ❌) | **ALIGNED** |

**ADR_RECONCILIATION_REQUIRED (review round 1).** ADR-014 §8 binds ONE activation gate to both `system.incident.create` (conditions 1–3) and `source=system_incident` time adjustments (conditions 4–5, immediately followed by "Until then `source=system_incident` time adjustments remain disabled"); ADR-013:644 defers the same source to REC-I6. The freeze below opens incident CREATION (F1) while requiring time-grants to STAY disabled (F6) — under the current ADR text that is self-contradictory (the same gate would be OPEN and NOT OPEN at once). Resolution direction endorsed by review: **#304 = System may CREATE incidents; System never automatically GRANTS TIME.** This requires a narrow ADR corrective splitting the single §8 gate into a creation-activation gate (conditions 1–3 + audit/evidence conditions) and a time-grant-activation gate (conditions 4–5, REC-I6 authority) — a human authority step that MUST land before implementation starts. It changes no incident-architecture decision; it separates two activations that were incorrectly coupled.

**VERDICT: CODE_REALITY_AUDIT = PASS; DB_RUNTIME_PROBES = PARTIAL / DEFERRED_TO_IMPLEMENTATION_EVIDENCE** (R2/R4/R5 executed; R1, R6, R7 and R3 row-inspection deferred — Docker unavailable, §9; the deferred probes become implementation evidence obligations, not open questions about current reality). #304's own body is code-accurate on every claim checked (incident aggregate, human commands, audit/evidence, Admin resolution surfaces, synthetic System concept, systemMonitor non-producer). Pre-implementation authority items: detector set selection, durable dedupe arbiter, System-specific crash-completion authority (F4A, Corrective-3), re-arm semantics (decided: per-episode, F5=B), and the ADR-014 §8 gate split — all addressed by the freeze below.

---

## 15. PRE-IMPLEMENTATION AUTHORITY FREEZE (revision 3 — absorbs review round 1 and the final-audit Corrective-3; supersedes earlier revisions — NOT yet posted to #304)

- **F1 — System actor identity**: System incidents are authored by a NEW closed synthetic id added to `SYSTEM_ACTOR_IDS` (e.g. `system:incident-detector`), constructed ONLY via `createSystemRequestContext` (`packages/authz/src/systemActor.ts`); System holds ZERO human incident permissions (`incident.*` stays human-only per ADR-014 §8 matrix). **CONDITION — ADR_RECONCILIATION_REQUIRED (§14): implementation MUST NOT start until a narrow accepted ADR corrective splits the ADR-014 §8 gate into a creation-activation gate and a time-grant-activation gate; the creation gate's conditions are then the acceptance checklist for `system.incident.create`.**
- **F2 — Detector set (v1)**: exactly ONE detector — heartbeat-disruption (CANDIDATE-D1). The `markDisrupted → "marked"` outcome triggers the first creation attempt; completion authority is F4A, not the return value. No deadline, systemMonitor, email, or admission detectors in v1 (D2/M/E classifications in §5).
- **F3 — Canonical source fact per detector**: the `attempt_interruption_events` `detected` row (`detection_source="heartbeat_timeout"`, unique per episode) is the ONE source fact; the incident references it via `exam_incident_interruption_links`; evidence fields are only those in §11's card. No new evidence store.
- **F4 — Durable dedupe authority (single arbiter, no OR)**: episode id = source fingerprint; the System create command's `operationId` is a PURE FUNCTION of the episode id (uuid v5 namespace), and the EXISTING `exam_incident_events_org_operation_unique (organization_id, operation_id)` is the sole dedupe arbiter — one episode ⇒ at most one System incident, enforced durably, never Set/Map/process memory. No additional schema-level fingerprint mechanism (no second authority).
- **F4A — Durable SYSTEM completion (Corrective-3)**: for every committed heartbeat-detected episode E, the canonical System create command — `deterministicOperationId(E)` → System-only create → incident + interruption link committed atomically — must durably commit exactly once; completion means THAT operation exists in the op-unique arbiter (`exam_incident_events_org_operation_unique`). The reconciliation leg's discovery predicate is "no `(organization_id, deterministicOperationId(E))` row in `exam_incident_events`" — link rows are NOT consulted. A human-created incident or human interruption link does NOT satisfy, cancel, or replace the System command (`FIELD/LINK EXISTS ≠ SYSTEM COMMAND COMPLETED`); the converged guarantee is exactly one SYSTEM incident per episode, NOT one incident globally. This requires NO org-level episode-unique index, no locking of the human link path, no claim table, no advisory lock, and no generic source arbiter — the rejected "any human link = completion" freeze would have needed exactly those mechanisms to become true. Human-link semantics are unchanged by #304. Implementation evidence must cover C1 (crash before incident → restart → one System incident), C2 (lost result → replay returns the SAME System incident), C3 (concurrent reconcilers → one System incident/link), C4 (human incident references the episode concurrently with reconciliation → both stand, exactly one SYSTEM incident, no cross-authority race).
- **F5 — Re-arm semantics (PRODUCT RULING LANDED — frozen)**: choice (B), suppression is PER_EPISODE; human resolve/dismiss terminalizes the case (never reopened); a NEW episode (condition cleared then recurred) MAY produce a new System incident. The attempt-level permanent-suppression variant is explicitly REJECTED — if that need ever arises it is a new suppression feature with its own authority, never `dismiss` semantics. #304's gate carries no PRODUCT_DECISION_REQUIRED item.
- **F6 — No automatic punishment (coherent with F1 under the split gate)**: the System command may create ONLY an evidence-bearing incident (type/severity mapping frozen at implementation, e.g. `network_interruption`/`info|minor`); it MUST NOT time-grant, force-submit, grade, misconduct-mark, or produce `source=system_incident` adjustments. Under the split ADR gate this freeze satisfies ONLY the creation gate; the time-grant gate stays CLOSED (its conditions + REC-I6 authority) — the round-1 F1/F6 contradiction is resolved by the ADR corrective, not by reinterpretation.
- **F7 — Human terminal authority**: resolve/dismiss remain `IncidentResolve` Admin-only, terminal-monotonic; System incidents land in the same Recovery queue/detail surfaces and are judged by humans exactly like human-created ones.
- **F8 — Audit distinguishes System-generated WITHOUT a second action**: reuse the canonical `incident.created` audit action — one creation semantic = one action; System-generated creation is distinguished by `actorId = "system:incident-detector"` (audit row + incident event), `exam_incidents.reported_by = "system:incident-detector"`, and the narrow detector/source evidence (§11). Do NOT introduce `incident.system_created` (an actor difference is not a domain-action difference; a second action would force union queries for "all incident creations"). Never write System ids into the users-FK-bound ledgers (`attempt_time_adjustments.actor_id`, `attempt_interruption_events.actor_id`; null convention there).
- **F9 — No client-selected System actor**: the System command path is internal-only (heartbeat-plugin-owned); no HTTP input can set actor/role/reportedBy; `request.ctx` remains constructible only by `authenticate`; fakeAdmin/fakeProctor/fakeSystem spoofing is forbidden and must stay impossible.
- **F10 — No generic detector framework**: no rules engine, event bus, ML, cooldown/threshold DSL, outbox/scheduler abstraction, or new worker; the detector and its reconciliation leg live in the existing heartbeat plugin seam (`DETECTOR_EXECUTION_OWNER`, §6); adding a second detector later is a new explicit decision, not a config change.

---

## 16. Probe log digests (paths + outcomes)

- `/tmp/maint1/probe-incidentCommands.log` — `pnpm --filter @exam/exam-engine test`: **39 files / 743 tests PASS** (incl. incidentCommands 55, systemMonitor 8, restoreInterruption, deadlineReconciliation).
- `/tmp/maint1/probe-scanners.log` — final run `vitest run` (temp DB-free probe config) over `src/plugins/heartbeat.test.ts` + `src/plugins/deadlineScanner.test.ts`: **2 files / 12 tests PASS**. (Earlier attempts in the same log show the DB-unreachable globalSetup failure that justified R1/R3/R6/R7 skips.)
- `/tmp/maint1/probe-authz.log` — `pnpm --filter @exam/authz test`: **11 files / 83 tests PASS** (incl. systemActor.test.ts, presets boundaries, auditActions).
- No docker project was started (docker unavailable); **nothing to tear down**; temp file `apps/api/vitest.probe.config.ts` deleted; `git status --short` clean at report time.
