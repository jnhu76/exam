# Authorization Architecture

> Current authority for the platform's capability-based authorization model.
> This describes what is **implemented** today (Phase 2 + Phase 3 infrastructure),
> not future scoped-role-bundle product work — see
> [`docs/roadmap/phase3-open-items.md`](../roadmap/phase3-open-items.md) for that.

## Authority

- Formal decision: [ADR-010 — Scoped RBAC Architecture](../adr/ADR-010-scoped-rbac-architecture.md)
- Phase scope: [`docs/roadmap/phase-roadmap.md`](../roadmap/phase-roadmap.md) (Phase 3)

## Model

Authorization is **capability-based**, not `requireRole`-based. Every protected
route declares a capability requirement; the runtime resolves whether the actor
holds that capability via assignment-backed authority.

```text
actor (session)
   │
   ▼
permission catalog  ── capability enum (Permission.*)
   │
   ▼
role presets        ── role → capability set (admin, candidate, proctor, grader, ...)
   │
   ▼
assignment-backed   ── loadAssignmentAuthority(ctx) → derived authority for this request
runtime authority      (multi-role union, last-admin invariant, fail-closed)
   │
   ▼
route guard         ── requireCapability / requireScopedCapability / requireOwnAttempt / ...
```

## Implemented primitives

All of the following are live in `packages/authz/` and `apps/api/src/authz/`:

| Primitive | Purpose |
| --- | --- |
| `requireCapability(perm)` | Flat capability gate (most admin/system routes) |
| `requireScopedCapability(perm)` | Scope-aware capability gate |
| `requireScoreCapability(perm)` | Score-result capability gate |
| `requireCandidateContext` | Candidate-context ownership gate |
| `requireExamEligibility` | Exam-eligibility gate (candidate may start) |
| `requireOwnAttempt` | Attempt-ownership gate (candidate owns the attempt) |
| `loadAssignmentAuthority(ctx)` | Loads assignment-backed runtime authority for the request |
| permission catalog | Enum of all capabilities (`Permission.*`) |
| role presets | Built-in role → capability mappings (admin, candidate, proctor, grader, ...) |

## Assignment-backed runtime authority

The authority kernel is **assignment-backed**, not `users.role`-based:

- `user_role_assignments` is the source of truth for which capabilities an actor holds.
- `loadAssignmentAuthority` derives the request authority by unioning all active
  role assignments for the actor in the current organization.
- **Last-admin invariant**: an advisory lock prevents removing the last admin,
  so a deployment can never lock itself out.
- **Multi-role union**: an actor may hold multiple roles; their capabilities union.
- **Fail-closed contract**: when authority cannot be resolved, the request is
  rejected (401 unauthenticated / 503 fail-closed), never allowed.

## Route coverage

Per the M10-A through M10-F migration series (all merged):

- **91 total protected routes**.
- **81 capability/ownership-gated**.
- **0 `requireRole` consumers** (legacy two-role gate fully removed).
- **0 `users.role` authority decisions** (role column is not consulted for authz).
- **0 JWT-role authority decisions** (JWT role is identity, not authority).

> **Gate 0.5 caveat.** The post-PR-197 re-verification (Gate 0.5, M10-F rerun)
> is **PENDING**. The route inventory above is the last-recorded state; its
> PASS closure verdict must NOT be cited as freshly re-verified evidence until
> Gate 0.5 is re-run. See
> [`docs/status/implementation-status.md`](../status/implementation-status.md).

## Candidate / admin permission boundary

Phase 1 product roles are **Admin** and **Candidate** only. The capability model
enforces this boundary:

- Admin capabilities: full system management within the internal default organization.
- Candidate capabilities: `own_attempt`, `own_score`, `exam_eligibility`,
  `candidate_context` — candidates can only access their own attempts/results.

This boundary is enforced on every production route; the frontend navigation
gating is UX-only, the backend is the security truth source.

## Non-goals (Phase 3 product work, not implemented)

These are tracked in [`docs/roadmap/phase3-open-items.md`](../roadmap/phase3-open-items.md):

- Scoped Teacher / Proctor / Grader role **bundles as product roles** (the
  presets exist in the catalog, but the assignment UI and product flows do not).
- Resource-relationship authorization (M11): Teacher→course, Proctor→exam,
  Grader→work assignment. No junction tables exist; no `scope_type` columns.
- Staff invitation, SMTP password reset, account lifecycle UI.
- Custom roles, multi-tenant, SuperAdmin (Phase 4).
