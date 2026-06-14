# Exam Platform Phase Roadmap

This roadmap is the documentation authority for phase scope. Phase 1 is a minimal deliverable exam system, not a full education platform, collaboration suite, or multi-tenant platform.

## Phase 1: Minimal Deliverable Exam System

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

### In scope

- Richer exam lifecycle: open / closed / archived.
- Disrupted attempt recovery UI.
- Proctor intervention workflow.
- Force submit.
- Extend time.
- Misconduct marking.
- timed_sync / deadline / untimed timing modes.
- Queue admission.
- Retake policy.
- Score strategy.
- Exam operation timeline.
- Attempt timeline.
- Import/export job logs.
- Larger result export.
- Exam operation audit coverage.
- Diagnostics page.

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

- Operational staff can recover disrupted attempts through a documented UI flow.
- Force submit, extend time, and misconduct marking are audited.
- Non-`timed_window` timing modes have documented lifecycle behavior.
- Queue admission is observable and recoverable.
- Exam and attempt timelines support incident diagnosis.
- Larger exports have job logs and failure evidence.

### Explicitly deferred items

- Collaboration and scoped staff roles move to Phase 3.
- Platform integration moves to Phase 4.
- Optional multiTenant remains Phase 4.

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

### Explicitly deferred items

- Platform integrations and API keys move to Phase 4.
- Optional multiTenant and SuperAdmin move to Phase 4.

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
