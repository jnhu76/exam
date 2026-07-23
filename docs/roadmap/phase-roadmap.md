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

**Phase 2 gate items are implemented.** All core exam loop items have been verified via code audit (see `docs/status/implementation-status.md` and the archived `docs/archive/dev/AUDIT-PHASE2-REALITY.md`). The remaining items below (timed_sync / untimed timing modes, queue admission) are deferred to Phase 2+ hardening or Phase 3.

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
- ✅ Manual grading queue and detail page (admin route + repo infrastructure; the full subjective-answer runtime + candidate-answer-detail E2E is Phase 3 — see below).
- ✅ Result publishing modes (immediate / after_grading / manual).
- ✅ Client telemetry pipeline (logger → buffer → batch POST → sanitize → DB).
- ✅ Proctor monitoring (candidate status + event timeline).
- ✅ Permission boundary (candidate cannot access admin / monitoring APIs).

### In scope — Deferred

- timed_sync / untimed timing modes (only `timed_window` is implemented; other modes deferred to Phase 2+ hardening).
- Queue admission (code exists but not yet operationally wired; deferred to Phase 2+ hardening).

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
- ⏳ Non-`timed_window` timing modes have documented lifecycle behavior (deferred).
- ⏳ Queue admission is observable and recoverable (deferred).
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

### Phase 2 excluded (moved to Phase 3 by scope decision)

```text
- fill-blank runtime / grading / result E2E
- subjective answer runtime
- rich-text answering
- manual-grading candidate-answer detail E2E (admin route + repo infra remain in Phase 2)
- full grading workflow for subjective questions
```

### Explicitly deferred items

- Collaboration and scoped staff roles move to Phase 3.
- Platform integration moves to Phase 4.
- Optional multiTenant remains Phase 4.
- fill-blank answering runtime, subjective/rich-text answering, and the full manual-grading E2E (candidate-answer visibility, scoring rubric/comments) are Phase 3 by scope decision — see `apps/e2e/e2e/fill-blank-e2e.spec.ts` and `apps/e2e/e2e/manual-grading.spec.ts` (skipped, `Phase 3 pending`).

## Phase 3: Collaboration, Permissions, and Account Lifecycle

### Goal

Add multi-user collaboration, scoped authorization, and account lifecycle management inside a single deployment. This is not multiTenant.

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
- Fill-blank answer protocol and auto-grading (deferred from Phase 2 — see `apps/e2e/e2e/fill-blank-e2e.spec.ts`).
- Subjective / rich-text answer runtime + manual-grading candidate-answer detail and full grading workflow (deferred from Phase 2 — see `apps/e2e/e2e/manual-grading.spec.ts`).
- WYSIWYG submit final-answer barrier (Option D, ADR-008 — `/submit` carries a final-answer payload / version barrier so the UI answer at submit-click time is the grading authority).
- Remaining i18n page-level copy migration (CandidateFieldsPage, ExamConfigForm, QuestionForm, etc. — admin form/modal content deferred from J7).
- In-app notification Inbox for selected operational events (architecture: ADR-011).
- Asynchronous PostgreSQL-outbox Email delivery with a resident, observable worker (architecture: ADR-011).
- First operational notification integration for result publication (`result_published`).

### Architecture authority

Notification and Email delivery are governed by
[`docs/adr/ADR-011-notification-and-email-delivery.md`](../adr/ADR-011-notification-and-email-delivery.md):
two channels (first-class Inbox + asynchronous Email outbox), at-least-once
delivery, resident worker, atomic business mutation + Inbox + outbox
transaction for operational events, and a validated `PUBLIC_WEB_ORIGIN` /
site-relative `actionPath`. The Phase 3 product work that remains is broken
into the module execution order below (see
[`docs/roadmap/phase3-open-items.md`](phase3-open-items.md) for per-Job
scope):

```text
P4 (RBAC MVP role switch)
  → P5-0 (Email delivery runtime hardening)
  → P3 (result publishing closeout)
  → P5-N1 (Notification Inbox + result-published Email integration)
  → P6 (MVP ready closeout)
```

P5 is a two-Job module: P5-0 = Email delivery infrastructure; P5-N1 = first real
Inbox + Email business integration. P5-0 has no dependency on P3 and may be
completed before result-publishing closeout. P5-N1 depends on both P5-0 and P3.

This ordering reflects real dependencies, not narrative sequence:
P4 establishes the final Admin/Teacher/Candidate role model; P5-0 hardens the
Email delivery runtime (ADR-011 accepted, no dependency on P3); P3 closes
result publishing under the final role model; P5-N1 extends the now-stable
result-publication transaction with the first Inbox + Email integration.

| Job  | True dependency                                |
| ---- | ---------------------------------------------- |
| P4   | Authorization infrastructure implemented        |
| P5-0 | ADR-011 accepted; P4 closed in execution order (no semantic dependency on P3) |
| P3   | P4 closed                                       |
| P5-N1| P4 + P5-0 + P3 closed                           |
| P6   | Preceding MVP blockers closed                   |

Identity lifecycle (invitation, SMTP password reset, account
activation/deactivation) remains Phase 3 scope but is separate future work
and is not silently included in P5-N1.

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
- Candidate with a configured email address receives the corresponding
  asynchronous result email (SMTP never participates in the result-publication
  transaction).
- Email worker heartbeat and backlog are observable through diagnostics.

### Explicitly deferred items

- Platform integrations and API keys move to Phase 4.
- Optional multiTenant and SuperAdmin move to Phase 4.
- Beyond the `result_published` first integration, additional operational
  notification types (`exam_assigned`, schedule change/cancellation, grading
  assignment) are deferred to later NotificationService migrations (P5-N2+),
  governed by ADR-011.

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
