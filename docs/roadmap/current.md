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

- **Phase 3, Module P6 — MVP ready closeout is IN PROGRESS (reality audit).**
  All Phase 3 MVP prerequisites are closed: P4 (RBAC MVP role switch), P5-0
  (Email delivery runtime hardening, PR #210), P3 (result publishing closeout,
  PR #211), and P5-N1 (Notification Inbox + result-published Email integration,
  **PR #213 merged 2026-07-25**). P5-N1 delivered the first operational
  two-channel notification: candidate Inbox plus optional Email for
  `result_published`, integrated atomically into the result-publication
  transaction.

  P6 (branch `feat/p6-mvp-ready-closeout`) is now auditing the implemented MVP
  subset for genuine release readiness against the documented
  LAN/on-premise, single-organization mode. See
  [`docs/audits/P6-MVP-READY-REALITY-AUDIT.md`](../audits/P6-MVP-READY-REALITY-AUDIT.md)
  for the audit and
  [`docs/deployment/mvp-deployment-runbook.md`](../deployment/mvp-deployment-runbook.md)
  for the deployment/recovery runbook. P6 does **not** mark all Phase 3 work
  complete — it concerns only the implemented MVP subset.

> Note: the former P2-1 Exam Authoring UI Flow has been removed from the
> active Phase 3 plan by scope decision.

## Gate status

- **Gate 0.5 (M10-F post-PR-197 rerun) is PASS** (verified 2026-07-24 on commit
  `f2a7a80`, re-verified during P4-R1 closeout on `b4dc1d6`). The runtime route
  tree reconciles exactly; full evidence in
  [`docs/status/implementation-status.md`](../status/implementation-status.md)
  and
  [`docs/audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md`](../audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md).
  Nothing in the current Phase 3 module sequence is blocked on Gate 0.5.

## What comes next (Phase 3 module order)

The order reflects real dependencies, not narrative sequence — define
permissions first (P4), then harden the Email base (P5-0), then close out
result publishing (P3), then attach the first notification onto the now-stable
result-publication transaction (P5-N1):

```text
P4 (RBAC MVP role switch) ✅ CLOSED
  → P5-0 (Email delivery runtime hardening) ✅ CLOSED (2026-07-25, PR #210)
  → P3 (result publishing closeout) ✅ CLOSED (2026-07-25, PR #211)
  → P5-N1 (Notification Inbox + result-published Email integration) ✅ CLOSED (2026-07-25, PR #213)
  → P6 (MVP ready closeout) 🔄 IN PROGRESS — REALITY AUDIT (branch feat/p6-mvp-ready-closeout)
```

P5 is a two-Job module: P5-0 = Email delivery infrastructure; P5-N1 = first real
Inbox + Email business integration.

| Job  | True dependency                                | Status |
| ---- | ---------------------------------------------- | ------ |
| P4   | Authorization infrastructure implemented        | ✅ CLOSED |
| P5-0 | ADR-011 accepted; P4 closed in execution order (no semantic dependency on P3) | ✅ CLOSED |
| P3   | P4 closed                                       | ✅ CLOSED |
| P5-N1| P4 + P5-0 + P3 closed                           | ✅ CLOSED (2026-07-25, PR #213) |
| P6   | Preceding MVP blockers closed                   | 🔄 IN PROGRESS — REALITY AUDIT |

After Phase 3 MVP closeout, the deferred design items (M11 resource-relationship
authorization, custom roles, Proctor runtime permission boundary, etc.) may be
revisited. None of these are authorized to start before their dependency module
closes.

## Out of scope until Phase 4

- pass-to-proceed API, service tokens / API keys, webhooks, external integration.
- Optional multiTenant, SuperAdmin, tenant hierarchy/switcher, organizationSlug
  login, cross-tenant audit.
- Cloud-only runtime dependencies (the platform must remain LAN/offline-capable).
