# REC-I6-I1 Incident Runtime Closeout

> Status: ACTIVE closeout audit
> Scope: documentation-only status reconciliation. No runtime, migration, API,
> OpenAPI, permission, test, dependency, Redis, Proctor-authority, Recovery
> Center, Incident business-semantic, ADR-014, or
> `P7-roadmap-planning-bundle.zip` changes.
>
> Updated: 2026-08-02

## Verdict

**CLOSED.** The Admin Incident runtime that J3 (`REC-I6-I1-INCIDENT-PERSISTENCE-COMMANDS`)
authorized is implemented and merged on `master`. This audit closes the J3
roadmap/status surface and hands the next authority contract to J4-R0.

## Merge evidence

- Implementation PR: [#242 — feat(rec-i6-i1): incident persistence](https://github.com/jnhu76/exam/pull/242)
- PR state: `MERGED` (verified via `gh pr view 242`)
- Head SHA: `7b3cc544717c5f190ff3454e14d82131e8599d6e`
- Merge commit: `5b653c1388ea49c896a5bca26c1acaf4551c6fd8`
- Merged at: 2026-08-01
- Merge commit is present on `master` (verified in
  `git log --oneline --decorate`).

## Authority

- [ADR-014 — Exam Incident Authority](../adr/ADR-014-exam-incident-authority.md):
  **ACCEPTED** (2026-08-01). The Incident runtime follows ADR-014.
- No ADR-014 semantics were changed during implementation. The frozen contract
  (aggregate, lifecycle, command inventory, permission matrix, transaction
  boundaries, idempotency, scope quadruple, link model) shipped as-specified.
- Architecture projection:
  [`docs/architecture/exam-system/incident-authority.md`](../architecture/exam-system/incident-authority.md).

## Implemented scope

The Admin Incident runtime delivered by PR #242:

- five additive Incident persistence tables (migration `0023`), zero changes
  to existing authoritative tables;
- append-only Incident event history with `event_sequence` ordering authority
  and the `before_version`/`after_version` verifiable chain;
- nine canonical write commands (`createExamIncident`,
  `startIncidentInvestigation`, `addIncidentNote`, `changeIncidentSeverity`,
  `resolveExamIncident`, `dismissExamIncident`, `linkIncidentAction`,
  `linkIncidentAttempt`, `linkIncidentInterruption`);
- Admin-only Incident permissions (`incident.view` / `incident.create` /
  `incident.investigate` / `incident.resolve`) granted to the Admin preset;
  Proctor preset left unchanged;
- Admin Incident API routes under `/admin/exams/:examId/incidents` and
  `/admin/incidents/:incidentId/...`;
- audit actions for every command;
- optimistic concurrency (`expectedVersion` + `INCIDENT_VERSION_CONFLICT`);
- `operationId` idempotency arbitrated by
  `UNIQUE (organization_id, operation_id)` on `exam_incident_events`;
- operator-action and interruption-evidence links with their own uniqueness
  arbiters and the scope-quadruple validation;
- optional Incident linkage in the Admin time-grant path —
  `grantAttemptTime()` accepts an optional `incidentId`; the grant + link write
  is one atomic transaction under the grant's existing `operationId`;
- guarded rollback tooling for the Incident migration (ADR-014 §14).

## Verified invariants

These are the invariants ADR-014 froze and PR #242 implemented:

- Incident and Attempt lifecycles remain orthogonal — an incident never drives
  Attempt status, grading, score, deadline, or punishment;
- resolving or dismissing an incident triggers no exam effect;
- Incident lifecycle does not grant time, force submit, punish, or change score
  — those are separately authoritative actions linked as correlation, not
  absorbed;
- event history is append-only;
- terminal status is monotonic (`resolved` / `dismissed` cannot reopen);
- `incident.type` is immutable after creation;
- the scope quadruple (org, exam, attempt, candidate) is derived server-side,
  never taken from the request body;
- duplicate operation replay is safe (same `operationId` + same canonical
  payload → `idempotent_replayed`);
- duplicate links are rejected deterministically
  (`INCIDENT_ACTION_ALREADY_LINKED` and the evidence-link uniques);
- grant + Incident link is atomic (one transaction under the grant's
  `operationId`);
- Proctor has no Incident authority (preset unchanged by J3);
- system incidents remain disabled (reserved, not granted);
- `misconduct_mark` Incident action link remains deferred (no stable append-only
  action receipt; rejected with 400 by J3).

## Explicitly not implemented

Closing J3 does **not** close the recovery/operations program. The following
remain NOT IMPLEMENTED and are the next jobs' scope:

- J4 — Proctor-to-Exam assignment authority (resource scope);
- J4 — Proctor Incident permissions (target grant, blocked on M11 scope);
- J5 — Admin Recovery Center UI;
- J6 — Proctor Recovery Center UI;
- system-generated incidents (reserved only);
- Redis coordination (P7-D1, decision-gated);
- background / startup reconciliation for incident partial states;
- `misconduct_mark` Incident action link;
- attachment / evidence binary storage.

## Verification evidence

PR #242 verification (summarized; not the full log):

- static verification: `pnpm verify` passed (typecheck + ESLint + format +
  copy/architecture/ui-gate/repo-contract lints + OpenAPI conformance);
- production build: `pnpm build` passed;
- coverage: package / API / web coverage met the gates;
- E2E: both E2E shards passed (the three named blocking specs —
  candidate-happy-path, resume-attempt, submit-flush);
- deterministic PostgreSQL concurrency tests for the Incident write path
  (operation-id replay, version race, terminal rejection, link-unique
  rejection) passed;
- migration and rollback tests passed (forward `0023` and the guarded rollback
  tooling under ADR-014 §14).

The PR-242 flake root cause and closeout is recorded in
[`docs/standards/test-flakes.md`](../standards/test-flakes.md)
(advisory-lock database scope + time-based concurrency sync, 2026-08-01).

## Roadmap handoff

J3 is **CLOSED**.

The next authority job is the J4 design contract:

```text
M11-R0-PROCTOR-EXAM-SCOPE-CONTRACT
```

This is a design / authority contract only. No runtime implementation is
authorized before R0 acceptance. After an accepted R0 contract, the runtime
implementation job is:

```text
M11-I1-PROCTOR-EXAM-ASSIGNMENTS
```

(persistence, commands, the assignment-backed resolver, API, and resource-scope
enforcement).

J4-R0 is **NOT** implemented by this closeout. The Recovery Center UI (J5/J6)
is **NOT** implemented by this closeout. Proctor Incident authority is **NOT**
implemented by this closeout.
