# Current Roadmap

> What is being worked on now and what comes next. For phase scope authority,
> see [`docs/roadmap/phase-roadmap.md`](phase-roadmap.md). For open Phase 3
> items, see [`docs/roadmap/phase3-open-items.md`](phase3-open-items.md).

## Status snapshot

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 1 — Minimal Deliverable | ✅ COMPLETE | Admin + Candidate reliable exam loop. |
| Phase 2 — Exam Operation | ✅ GATE ITEMS IMPLEMENTED | `timed_sync`/`untimed`/queue admission deferred. |
| Phase 3 — Collaboration/Permissions | 🟡 PARTIALLY IMPLEMENTED | Authorization **infrastructure** live; Phase 3 **product** work open. |
| Phase 4 — Platformization | ⬜ NOT STARTED | pass-to-proceed, service tokens, optional multiTenant. |

See [`docs/status/implementation-status.md`](../status/implementation-status.md)
for the full implemented/partial/limited breakdown.

## What is being worked on now

- **Phase 3, Module P2 — Exam authoring closeout (ACTIVE).** The authoring UI
  flow audit found gaps (notably `text_response` authoring UI). This is the
  current execution cursor. See
  [`docs/roadmap/phase3-open-items.md`](phase3-open-items.md) §P2-1.

## What is blocked

- **Gate 0.5 (M10-F post-PR-197 rerun) is PENDING.** It blocks future
  RBAC-sensitive changes only. It does not block documentation or non-RBAC
  work. The last-recorded route inventory stands but is not freshly
  re-verified.

## What comes next (Phase 3 module order)

```text
P2 (authoring, ACTIVE)
  → P3 (result publishing closeout)
  → P4 (RBAC MVP role switch: Admin/Teacher/Candidate)
  → P5 (email minimal trigger)
  → P6 (MVP ready closeout)
```

After Phase 3 MVP closeout, the deferred design items (M11 resource-relationship
authorization, custom roles, Proctor runtime permission boundary, etc.) may be
revisited. None of these are authorized to start before their dependency module
closes.

## Out of scope until Phase 4

- pass-to-proceed API, service tokens / API keys, webhooks, external integration.
- Optional multiTenant, SuperAdmin, tenant hierarchy/switcher, organizationSlug
  login, cross-tenant audit.
- Cloud-only runtime dependencies (the platform must remain LAN/offline-capable).
