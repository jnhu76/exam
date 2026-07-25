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

- **Phase 3, Module P5-N1 — Notification Inbox + Result-Published Email
  integration (REALITY AUDIT IN PROGRESS).** P3 result-publishing closeout is
  now **CLOSED** (PR #211 merged; independent closeout review satisfied by the
  P3-R0 audit + P3-R1 test-only closeout: M8 Teacher publish API proof, M9
  Teacher all-view result proof, M12 Teacher browser publication E2E, M13
  concurrent publication idempotency; no production behavior changes). The
  authoritative transaction seam that P5-N1 will extend is frozen at
  `apps/api/src/routes/exam.ts:1269-1279` (inside the `!alreadyPublished`
  block, after `recordAtomicHttpAudit`). P5-N1 reality audit (P5-N1-R0) owns
  the contract correction and the frozen V1 scope. See
  [`docs/roadmap/phase3-open-items.md`](phase3-open-items.md) §P5-N1,
  [`docs/adr/ADR-011-notification-and-email-delivery.md`](../adr/ADR-011-notification-and-email-delivery.md)
  (ADR status corrected to **Accepted** by this audit).

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
  → P3 (result publishing closeout) ✅ CLOSED (2026-07-25, PR #211)
  → P5-N1 (Notification Inbox + result-published Email integration) 🔄 REALITY AUDIT IN PROGRESS
  → P6 (MVP ready closeout) ⏸ BLOCKED on P5-N1
```

P5 is a two-Job module: P5-0 = Email delivery infrastructure; P5-N1 = first real
Inbox + Email business integration.

| Job  | True dependency                                | Status |
| ---- | ---------------------------------------------- | ------ |
| P4   | Authorization infrastructure implemented        | ✅ CLOSED |
| P5-0 | ADR-011 accepted; P4 closed in execution order (no semantic dependency on P3) | ✅ CLOSED |
| P3   | P4 closed                                       | ✅ CLOSED |
| P5-N1| P4 + P5-0 + P3 closed                           | 🔄 REALITY AUDIT IN PROGRESS |
| P6   | Preceding MVP blockers closed                   | ⏸ BLOCKED on P5-N1 |

After Phase 3 MVP closeout, the deferred design items (M11 resource-relationship
authorization, custom roles, Proctor runtime permission boundary, etc.) may be
revisited. None of these are authorized to start before their dependency module
closes.

## Out of scope until Phase 4

- pass-to-proceed API, service tokens / API keys, webhooks, external integration.
- Optional multiTenant, SuperAdmin, tenant hierarchy/switcher, organizationSlug
  login, cross-tenant audit.
- Cloud-only runtime dependencies (the platform must remain LAN/offline-capable).
