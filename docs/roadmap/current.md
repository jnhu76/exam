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

- **Phase 3, Module P3 — Result publishing closeout (NEXT).** This audits and
  closes the result-publication boundary under the final Admin/Teacher/Candidate
  role model and freezes the authoritative transaction seam that P5-N1 will
  extend. P4 (RBAC MVP role switch) and P5-0 (Email delivery runtime) are now
  closed; P3 is the current execution cursor. See
  [`docs/roadmap/phase3-open-items.md`](phase3-open-items.md) §P3.
  Notification and Email delivery architecture authority:
  [`docs/adr/ADR-011-notification-and-email-delivery.md`](../adr/ADR-011-notification-and-email-delivery.md).

> Note: the former P2-1 Exam Authoring UI Flow has been removed from the
> active Phase 3 plan by scope decision.

## What is blocked

- **Gate 0.5 (M10-F post-PR-197 rerun) is PENDING.** It blocks future
  RBAC-sensitive changes only. It does not block documentation or non-RBAC
  work. The last-recorded route inventory stands but is not freshly
  re-verified.

## What comes next (Phase 3 module order)

The order reflects real dependencies, not narrative sequence — define
permissions first (P4), then harden the Email base (P5-0), then close out
result publishing (P3), then attach the first notification onto the now-stable
result-publication transaction (P5-N1):

```text
P4 (RBAC MVP role switch) ✅ CLOSED
  → P5-0 (Email delivery runtime hardening) ✅ CLOSED (2026-07-25, PR #210)
  → P3 (result publishing closeout) 🔄 NEXT
  → P5-N1 (Notification Inbox + result-published Email integration) ⏸ BLOCKED on P3
  → P6 (MVP ready closeout)
```

P5 is a two-Job module: P5-0 = Email delivery infrastructure; P5-N1 = first real
Inbox + Email business integration.

| Job  | True dependency                                | Status |
| ---- | ---------------------------------------------- | ------ |
| P4   | Authorization infrastructure implemented        | ✅ CLOSED |
| P5-0 | ADR-011 accepted; P4 closed in execution order (no semantic dependency on P3) | ✅ CLOSED |
| P3   | P4 closed                                       | 🔄 NEXT |
| P5-N1| P4 + P5-0 + P3 closed                           | ⏸ BLOCKED on P3 |
| P6   | Preceding MVP blockers closed                   | ⏸ |

After Phase 3 MVP closeout, the deferred design items (M11 resource-relationship
authorization, custom roles, Proctor runtime permission boundary, etc.) may be
revisited. None of these are authorized to start before their dependency module
closes.

## Out of scope until Phase 4

- pass-to-proceed API, service tokens / API keys, webhooks, external integration.
- Optional multiTenant, SuperAdmin, tenant hierarchy/switcher, organizationSlug
  login, cross-tenant audit.
- Cloud-only runtime dependencies (the platform must remain LAN/offline-capable).
