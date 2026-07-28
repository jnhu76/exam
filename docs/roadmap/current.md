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

- **Recovery hardening — REC-I4-I1 persistence foundation is implemented.**
  ADR-013 and the REC-I4-R0 reality audit freeze `strict` as the default
  interruption-time policy, separate lifecycle restore from compensation,
  and define bounded-grace caps and ordering. REC-I4-I1 adds the Domain,
  contract, PostgreSQL episode/event/adjustment ledgers, conservative strict
  backfill, and tenant-scoped repositories. The current runtime still has
  transitional full-disconnection compensation; I1 does not connect the
  scanner or restore flow. The next authorized recovery Job is
  **REC-I4-I2 — Engine Policy Seam**. REC-I4 does not introduce Redis.

- **Phase 3, Module P6 — MVP ready closeout is CLOSED.**
  All Phase 3 MVP prerequisites are closed: P4 (RBAC MVP role switch), P5-0
  (Email delivery runtime hardening, PR #210), P3 (result publishing closeout,
  PR #211), and P5-N1 (Notification Inbox + result-published Email integration,
  **PR #213 merged 2026-07-25**). P5-N1 delivered the first operational
  two-channel notification: candidate Inbox plus optional Email for
  `result_published`, integrated atomically into the result-publication
  transaction.

  P6 (branch `feat/p6-mvp-ready-closeout`) has completed an independent
  closeout review confirming that the implemented MVP subset is release-ready
  in its documented LAN/on-premise, single-organization mode. PR #215 merged
  the reviewed corrections; the post-merge documentation closeout is in
  progress. See
  [`docs/audits/P6-MVP-READY-REALITY-AUDIT.md`](../audits/P6-MVP-READY-REALITY-AUDIT.md)
  for the final audit and
  [`docs/deployment/mvp-deployment-runbook.md`](../deployment/mvp-deployment-runbook.md)
  for the deployment/recovery runbook. P6 does **not** mark all Phase 3 work
  complete — it concerns only the implemented MVP subset.

  > Phase 3 remains **PARTIALLY IMPLEMENTED**. M11, custom roles,
  > Proctor/Grader product activation, staff invitation, password reset /
  > account recovery, additional notification types, and Phase 4 all remain
  > deferred.

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
  → P6 (MVP ready closeout) ✅ CLOSED (2026-07-26, PR #215)
```

P5 is a two-Job module: P5-0 = Email delivery infrastructure; P5-N1 = first real
Inbox + Email business integration.

| Job  | True dependency                                | Status |
| ---- | ---------------------------------------------- | ------ |
| P4   | Authorization infrastructure implemented        | ✅ CLOSED |
| P5-0 | ADR-011 accepted; P4 closed in execution order (no semantic dependency on P3) | ✅ CLOSED |
| P3   | P4 closed                                       | ✅ CLOSED |
| P5-N1| P4 + P5-0 + P3 closed                           | ✅ CLOSED (2026-07-25, PR #213) |
| P6   | Preceding MVP blockers closed                   | ✅ CLOSED (2026-07-26, PR #215) |

After Phase 3 MVP closeout, the deferred design items (M11 resource-relationship
authorization, custom roles, Proctor runtime permission boundary, etc.) may be
revisited. None of these are authorized to start before their dependency module
closes.

## Out of scope until Phase 4

- pass-to-proceed API, service tokens / API keys, webhooks, external integration.
- Optional multiTenant, SuperAdmin, tenant hierarchy/switcher, organizationSlug
  login, cross-tenant audit.
- Cloud-only runtime dependencies (the platform must remain LAN/offline-capable).
