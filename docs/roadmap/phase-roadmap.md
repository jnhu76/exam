# Exam Platform Phase Roadmap

This roadmap is the documentation authority for phase scope. Phase 1 is a minimal deliverable exam system, not a full education platform, collaboration suite, or multi-tenant platform.

## Phase 1: Minimal Deliverable Exam System

### Status

**Phase 1 is COMPLETE.**

### Goal

Deliver a LAN/on-premise single-tenant exam system where one deployment represents one organization. Admin and Candidate can complete a reliable exam loop with recoverable answers, automatic grading, diagnostic evidence, and result export.

### In scope

- Internal default organization as the only organization.
- `organizations` table and `organizationId` as internal data boundary fields.
- Product roles: Admin and Candidate only.
- Admin bootstrap.
- Local admin reset-password script.
- Candidate creation and CSV import.
- CandidateField configuration.
- Course creation.
- Question CSV import.
- Exam creation with the `timed_window` path.
- Exam publish.
- Candidate enrollment / assignment.
- Candidate username/password login without organization slug.
- Candidate starts exam.
- Answer Save Protocol.
- Submit Attempt.
- Auto grading.
- Result visible to Admin and Candidate.
- Result CSV export.
- Minimal AuditLog.
- Structured logs.
- requestId for request tracing.
- Stable machine-readable error codes.
- E2E artifacts: `server.log`, screenshot, video, and Playwright trace.
- Docker Compose / health / basic deployment notes.
- PostgreSQL row lock / save-answer / submit / grading concurrency semantics.

### Out of scope

- Teacher role as a Phase 1 product path.
- Proctor role or proctor dashboard.
- Grader role.
- SuperAdmin.
- Multi-tenant runtime.
- Tenant switcher.
- organizationSlug login.
- Organization creation UI.
- Custom role UI.
- Permission registry UI.
- Email invitation.
- Email password reset.
- Pass-to-proceed API.
- Full exam operations dashboard.
- Queue admission.
- IP restriction.
- Electron lockdown.
- Full retake policy and score strategy workflows.

### Acceptance signals

- Admin + Candidate core flow documented.
- No organizationSlug login.
- No tenant switcher.
- No SuperAdmin product path.
- Candidate import works.
- Question import works.
- Result CSV export works.
- save-answer / submit / grading concurrency covered.
- E2E happy path / resume / submit-flush restored as blocking CI.
- Minimal audit/log/requestId covered.
- Docker Compose / health / basic deployment documented.

### Explicitly deferred items

- Teacher-like roles are deferred to Phase 3.
- Proctor operations and disrupted recovery UI are deferred to Phase 2.
- Permission registry and custom roles are deferred to Phase 3.
- Email invitation and password reset email are deferred to Phase 3.
- Pass-to-proceed and external integrations are deferred to Phase 4.
- Optional multiTenant and SuperAdmin are deferred to Phase 4.

## Phase 2: Exam Operation

### Goal

Add real exam operation capabilities around the core exam loop without turning the product into a permissions platform.

### Status

**Phase 2 gate items are implemented.** All core exam loop items have been verified via code audit (see `docs/status/implementation-status.md` and the archived `docs/archive/dev/AUDIT-PHASE2-REALITY.md`). The remaining timing modes (`timed_sync`, `deadline`, `untimed`) and queue admission are deferred to Phase 2+ / P7 hardening.

**i18n foundation complete (J1–J10).** All user-visible Chinese in production source goes through `t()` via `apps/web/src/i18n/locales/zh-CN.ts`. Full production source hardcoded copy gate enforced via `pnpm lint:copy`. See `docs/standards/i18n-copy-policy.md`.

### In scope — Implemented

- ✅ Richer exam lifecycle: open / closed / archived.
- ✅ Disrupted attempt recovery UI.
- ✅ Proctor intervention workflow (polling dashboard).
- ✅ Force submit.
- ✅ Extend time.
- ✅ Misconduct marking.
- ✅ Retake policy (enum + enrollment logic).
- ✅ Score strategy (highest / latest / first).
- ✅ Exam operation timeline.
- ✅ Attempt timeline.
- ✅ Import/export job logs.
- ✅ Larger result export (CSV scores + attempt JSON/CSV).
- ✅ Exam operation audit coverage.
- ✅ Diagnostics page (DB / Redis / scanner health).
- ✅ Manual grading queue and detail-page infrastructure.
- ✅ Result publishing modes (immediate / after_grading / manual).
- ✅ Client telemetry pipeline (logger → buffer → batch POST → sanitize → DB).
- ✅ Proctor monitoring (candidate status + event timeline).
- ✅ Permission boundary (candidate cannot access admin / monitoring APIs).

### In scope — Deferred

- `timed_sync`, `deadline`, and `untimed` timing modes (only `timed_window` is implemented).
- Queue admission (`requireQueue` code exists but is not operationally wired).

### Out of scope

- Full custom role system by default.
- Permission registry UI.
- Teacher-like scoped roles unless separately approved.
- Email invitation.
- Email password reset.
- Multi-tenant runtime.
- SuperAdmin.
- Tenant switcher.
- organizationSlug login.
- Pass-to-proceed API.

### Acceptance signals

- ✅ Operational staff can recover disrupted attempts through a documented UI flow.
- ✅ Force submit, extend time, and misconduct marking are audited.
- ⏳ Non-`timed_window` timing modes have documented lifecycle behavior and executable profiles.
- ⏳ Queue admission is observable, recoverable, and restart-safe.
- ✅ Exam and attempt timelines support incident diagnosis.
- ✅ Larger exports have job logs and failure evidence.

### Phase 2 included (objective-question exam loop)

```text
- start / resume / save / submit
- deadline auto-submit
- restore / heartbeat
- objective auto-grading for supported types (single_choice, multi_select, true_false)
- result display for supported types
- audit coverage and E2E stability
```

### Phase 2 excluded at original scope boundary (moved to Phase 3)

```text
- fill-blank runtime / grading / result E2E
- subjective answer runtime
- rich-text answering
- manual-grading candidate-answer detail E2E
- full grading workflow for subjective questions
```

The original boundary is historical. Plain-text `text_response` authoring,
answering, frozen grading basis, Grading Queue discovery, manual grading, and
result flow were subsequently implemented and closed on 2026-07-31. Fill-blank
reality and rich-text/WYSIWYG remain open and must not be conflated with the
completed plain-text workflow.

### Explicitly deferred items

- Collaboration and scoped staff roles move to Phase 3.
- Platform integration moves to Phase 4.
- Optional multiTenant remains Phase 4.
- fill-blank completion, rich-text/WYSIWYG answering, and the generic ADR-008
  final-answer submit barrier (Option D — submit carries a final-answer payload
  / version barrier for all supported answer types, not only rich text) remain
  Phase 3/P7 work.

## Phase 3: Collaboration, Permissions, and Account Lifecycle

### Goal

Add multi-user collaboration, scoped authorization, and account lifecycle management inside a single deployment. This is not multiTenant.

### Status

**Phase 3 is PARTIALLY IMPLEMENTED.** The MVP role/notification/release-ready
sequence P4 → P5-0 → P3 → P5-N1 → P6 is closed. The plain-text
`text_response` product loop is also closed. Resource-scoped authorization,
identity lifecycle, additional notifications, rich-text/WYSIWYG answering, the
generic final-answer submit barrier, and other product work remain open.

### In scope

- Permission registry.
- Built-in role bundles.
- Scoped role assignment.
- Teacher-like roles built from permission + scope.
- Course / Exam / CandidateGroup scopes.
- Teacher isolation as scoped authorization, not multiTenant.
- Proctor / Grader / ContentManager role bundles.
- Staff invitation.
- SMTP email management.
- Email password reset.
- Invitation token lifecycle.
- User activation / deactivation.
- Permission audit.
- Audit log search / export UI.
- Fill-blank answer protocol, auto-grading, result flow, and E2E closeout.
- ✅ Plain-text `text_response` authoring, optional reference answer, candidate answering, snapshot freeze, grading-queue discovery, manual grading, and result flow.
- Rich-text/WYSIWYG authoring and answering protocol, including attachment/formula policy if adopted.
- Generic final-answer submit barrier (Option D, ADR-008 — `/submit` carries a final-answer payload or version/hash barrier so the UI answer at submit-click time is the grading authority). Answer-type-independent; applies to all supported answer types.
- Remaining i18n page-level copy migration.
- In-app notification Inbox for selected operational events (architecture: ADR-011).
- Asynchronous PostgreSQL-outbox Email delivery with a resident, observable worker (architecture: ADR-011).
- First operational notification integration for result publication (`result_published`).
- Additional operational notification types through explicit P5-N2+ migrations.

### Architecture authority

Notification and Email delivery are governed by
[`docs/adr/ADR-011-notification-and-email-delivery.md`](../adr/ADR-011-notification-and-email-delivery.md):
two channels (first-class Inbox + asynchronous Email outbox), at-least-once
delivery, resident worker, atomic business mutation + Inbox + outbox
transaction for operational events, and a validated `PUBLIC_WEB_ORIGIN` /
site-relative `actionPath`.

The completed MVP sequence (P4 → P5-0 → P3 → P5-N1 → P6) and its closeout
evidence are recorded in [`docs/roadmap/current.md`](current.md) and
[`docs/status/implementation-status.md`](../status/implementation-status.md).
Identity lifecycle remains separate future work.

| Job | True dependency | Status |
| --- | --- | --- |
| P4 | Authorization infrastructure implemented | ✅ CLOSED |
| P5-0 | ADR-011 accepted; P4 closed in execution order | ✅ CLOSED |
| P3 | P4 closed | ✅ CLOSED |
| P5-N1 | P4 + P5-0 + P3 closed | ✅ CLOSED |
| P6 | Preceding MVP blockers closed | ✅ CLOSED |
| P7 | P6 closed; current-tree reality audit | 🟣 PLANNING |

### Out of scope

- Optional multiTenant.
- SuperAdmin.
- Tenant hierarchy.
- Tenant switcher.
- organizationSlug login.
- Cross-tenant audit.
- Tenant quota and tenant-level backup / restore.

### Acceptance signals

- Admin can assign scoped staff roles without exposing cross-tenant behavior.
- Teacher-like access is enforced by permission + scope.
- Staff invitation and email password reset are auditable.
- Permission audit explains who granted which capability and why.
- Audit log query/export supports operational review.
- Candidate receives and reads a result-publication Inbox notification.
- Candidate with a configured email address receives the corresponding asynchronous result email; SMTP never participates in the result-publication transaction.
- Email worker heartbeat and backlog are observable through diagnostics.
- ✅ A plain-text subjective question can be authored, published, answered, manually graded, and viewed through the supported product loop without leaking rubric/reference data to the candidate.
- A future rich-text/WYSIWYG authoring protocol has explicit authority and sanitization rules before activation; the generic final-answer submit barrier (ADR-008 Option D) is tracked separately from rich-text work.

### Explicitly deferred items

- Platform integrations and API keys move to Phase 4.
- Optional multiTenant and SuperAdmin move to Phase 4.
- Beyond the `result_published` first integration, additional operational notification types are deferred to P5-N2+.
- M11 resource-relationship authorization remains a separate Phase 3 workstream.
- P7 does not redefine M11.

## Phase 3R / P7: System Readiness and Configurable Exam Modes

> P7 is a Phase 3 hardening program, not a new tenant/platform phase. It closes
> single-deployment system completeness before Phase 4 platformization.

### Goal

Turn the implemented feature set into a coherent, recoverable, configurable,
operator-visible system that supports exam policies from minimal collection to
strict/high-assurance operation.

Detailed planning authority:
[`docs/roadmap/P7-system-readiness-and-exam-modes.md`](P7-system-readiness-and-exam-modes.md).
Redis capability study:
[`docs/audits/P7-R0-REDIS-CAPABILITY-STUDY.md`](../audits/P7-R0-REDIS-CAPABILITY-STUDY.md).

### Status

**PLANNING.** No P7 implementation capability may be marked complete merely
because an environment variable, Redis connection, CLI note, or API stub exists.
The runtime and real Admin/operator surfaces must consume the capability.

### In scope

#### State and authority

- current-tree state-machine and transition-owner audit;
- direct status-write and unreachable-state reconciliation;
- cross-domain transaction and side-effect map;
- idempotency and crash-point analysis;
- startup reconciliation for recoverable partial work.

#### Redis adoption

- P7-D1 measures current single-instance limits, checks ADR-001 triggers, and
  updates or supersedes ADR-001 before any Redis business responsibility;
- recognize cache, session, rate-limit, queue, stream, Pub/Sub, presence,
  scheduling, dedupe, lock/lease, and durable persistence capabilities;
- explicit `off | optional | required` operating modes for approved responsibilities;
- safe connection lifecycle, diagnostics, recovery events, and bounded failure;
- if a trigger is met, first real shared use through global rate limiting;
  if not, record measurement evidence and re-evaluation conditions in ADR-001;
- admission queue and presence adoption after state semantics are frozen and
  the ADR-001 decision is accepted;
- workload-specific persistence, eviction, backup, and topology policy.

#### Backup and disaster recovery

- declared RPO/RTO profiles;
- PostgreSQL backup and higher-profile PITR design;
- attachments/settings/version metadata backup;
- encryption, retention, checksums, and verification;
- clean-host restore CLI/runbook;
- recurring restore drills and Admin-visible evidence.

#### Crash and outage recovery

- API/host/PostgreSQL/Redis/worker/scanner failure matrix;
- retry-safe submit, grading, notification, and job behavior;
- abandoned/stalled work recovery;
- reconciliation through canonical commands rather than ad-hoc status writes.

#### Configuration control plane

- classify deployment secrets vs runtime operational settings vs Exam policies;
- database-backed typed/versioned/audited settings where safe;
- effective-value/source display, preview, rollback, import/export, restart marker;
- publish and Attempt policy snapshots that isolate active exams from later edits.

#### Exam policy profiles

- orthogonal timing, admission, session/device, navigation, save/submit,
  interruption, randomization, result, monitoring, and audit policies;
- minimal, standard, controlled, and strict named templates;
- conflict validation before publish;
- one engine executes the resolved frozen policy, not profile-name branches.

#### UI and operator experience

- system status center;
- settings center;
- backup/recovery center;
- exam-profile creation wizard and resolved-policy preview;
- responsive/accessibility and existing visual-authority migration closeout.

### Acceptance signals

- roadmap/status/state documents agree with current runtime.
- every irreversible transition has one command owner and repeat-safe behavior.
- the P7-D1 decision is recorded in ADR-001 (adopt a concern, or decline with
  measurement evidence and re-evaluation conditions).
- every approved Redis responsibility has a real business caller, tested
  failure semantics, and multi-instance proof; if none is approved, Gate P7-2
  is satisfied by the recorded decision.
- Redis queue/cache/coordination workloads declare persistence and eviction policy.
- a clean-host restore drill meets the declared deployment profile.
- startup reconciliation repairs or reports supported incomplete states.
- Admin can inspect and safely change supported non-secret settings with audit and rollback.
- minimal/standard/controlled/strict profiles resolve to one validated policy schema.
- published exams and active attempts are isolated from later profile/settings edits.
- status/settings/backup/recovery/profile flows are usable through real UI.

### Explicit boundaries

- Redis is technically capable of durable and authoritative storage; P7 retains
  PostgreSQL authority for attempts, answers, grading, audit, and business
  settings unless a later accepted ADR moves a responsibility.
- Redis locks may coordinate discovery/ownership but cannot be the only guard
  for irreversible exam transitions without fencing and an accepted authority design.
- deployment endpoints and master secrets remain deployment/secret configuration;
  the Admin panel must not expose them as plaintext.
- P7 does not activate multiTenant, SuperAdmin, or cloud-only dependencies.
- P7 does not collapse all behavior into a single `mode` enum.

## Phase 4: Platformization and Integration

### Goal

Add platformization and external integration capabilities. Optional multiTenant is one part of this phase, not the whole phase.

### In scope

- Pass-to-proceed API.
- Service token / API key.
- Webhook.
- External integration.
- Optional multiTenant.
- SuperAdmin.
- Tenant hierarchy.
- Tenant switcher.
- organizationSlug login.
- Cross-tenant audit.
- Tenant settings.
- Tenant quota.
- Tenant-level backup / restore.
- Optional external log shipping.
- Syslog / OTLP-compatible export.
- Optional SIEM integration.

### Out of scope

- Treating multiTenant as mandatory for all deployments.
- Weakening Phase 1 single-tenant reliability or data-boundary rules.
- Cloud-only runtime dependencies.

### Acceptance signals

- External systems can query pass/fail status through a documented API.
- Service tokens and API keys have lifecycle, audit, and revocation rules.
- Webhooks are signed and retryable.
- If multiTenant is enabled, tenant isolation, SuperAdmin paths, tenant switcher, organizationSlug login, and cross-tenant audit are explicitly tested and documented.

### Explicitly deferred items

- Any cloud-hosted dependency remains optional and must not break LAN/offline deployment.
