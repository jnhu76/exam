# Current Roadmap

> What is implemented now and what comes next. Phase scope authority remains
> [`docs/roadmap/phase-roadmap.md`](phase-roadmap.md). **Executable future work
> is tracked through GitHub Issues** — see
> [`post-mvp-issues.md`](post-mvp-issues.md) for the Issue index. P7 program
> history and closure: [`docs/audits/P7-FINAL-PROGRAM-CLOSEOUT.md`](../audits/P7-FINAL-PROGRAM-CLOSEOUT.md).

## Status snapshot

| Phase / program | Status | Notes |
| --- | --- | --- |
| Phase 1 — Minimal Deliverable | ✅ CLOSED | Admin + Candidate reliable exam loop. |
| Phase 2 — Exam Operation | ✅ CLOSED for the supported MVP gate subset | `timed_window` only; extensions (`timed_sync`/`deadline`/`untimed`, queue admission) → Issues #291/#292. |
| Phase 3 — Collaboration / Permissions | ✅ MVP subset delivered | Authorization infrastructure + plain-text `text_response` loop + P7 hardening closed; remaining product work → Issues (#286/#296–#300/#301/#302). |
| P7 — System Readiness and Exam Modes | ✅ **CLOSED** (2026-08-14) | See [`docs/audits/P7-FINAL-PROGRAM-CLOSEOUT.md`](../audits/P7-FINAL-PROGRAM-CLOSEOUT.md). |
| Phase 4 — Platformization | ⬜ NOT STARTED | Future; work → Issues #309–#313. |

See [`docs/status/implementation-status.md`](../status/implementation-status.md)
for the implemented/limited breakdown and
[`post-mvp-issues.md`](post-mvp-issues.md) for all scheduled future work.

## Recently closed

- **P7 — CLOSED (2026-08-14).** Final program closeout: Gate P7-3 PASS as the
  Product/Software Readiness Gate (deterministic restore drill executed
  2026-08-14; the product's own ops-policy projection evaluated the recorded
  automated drill evidence against the declared RTO 3600 s as **SATISFIED**,
  observed 18 000 ms; deployment-site retention/restore acceptance is an
  explicit runbook obligation), ADR-017 rev 4 + ADR-018 ACCEPTED, all
  deferred capabilities migrated to Issues (#291–#313 + #293 umbrella children
  #315–#317; #295 decision-gated), #286 reopened as the Teacher@Course
  tracker. Evidence:
  [`docs/audits/P7-FINAL-PROGRAM-CLOSEOUT.md`](../audits/P7-FINAL-PROGRAM-CLOSEOUT.md).
- **P7-CLOSE — RTO + retention mechanism (2026-08-13, PR #290).** Typed RTO
  authority + retention evidence ledger + host-side pgBackRest script;
  acceptance resolved in the P7 final closeout.
- **P7-F — final readiness closeout (2026-08-13, PR #288).** Verdict at the
  time: P7-F COMPLETE, P7 OPEN on Gate P7-3; superseded by the final closeout.
- **P7-M — configurable exam modes (2026-08-13, PRs #277/#279).** Profiles +
  wizard; Controlled/Strict deferred to umbrella #293 (children #315–#317) +
  #292/#291; #295 decision-gated.
- **P7-E — operational control plane (2026-08-12, PR #282).** Maintainer
  boundary, evidence ledger, operations views, policy intent.
- **P7-C — portable backup/DR (2026-08-10, PRs #270/#274).** Cold/logical/
  physical(PITR) + deterministic drills.
- **P7-RBAC role-reality remediation (2026-08-13, PR #284).** F-01..F-11
  dispositioned; F-04 → #286.
- **Phase 3 MVP sequence (2026-07-24..26).** P4 → P5-0 → P3 → P5-N1 → P6
  closed; plain-text `text_response` loop closed 2026-07-31 (PRs #237/#238).
- **Recovery foundation (2026-07-31..08-08).** REC-I6-R0/I1 (J2/J3), J4-R0/J4-I1
  (ADR-015 Proctor scope), J5 Admin Recovery Center — all CLOSED. J6
  (Proctor Recovery Center) → Issue #303.

## Current planning focus

P7 is closed. The planning model is now **Issues-first**:

- Phase 2+ / Phase 3 / UI / Phase 4 future work lives in GitHub Issues
  (indexed in [`post-mvp-issues.md`](post-mvp-issues.md)).
- The roadmap documents summarize phase scope and current truth; they do not
  carry an executable TODO database.
- Decision-gated work (further Redis responsibilities) requires a recorded
  ADR-001 decision before any implementation; see
  [`docs/audits/P7-R0-REDIS-CAPABILITY-STUDY.md`](../audits/P7-R0-REDIS-CAPABILITY-STUDY.md).

## Gate status

- Gate 0.5: **PASS** (route/capability conformance baseline, re-verified).
- P6 MVP closeout: **CLOSED** for the supported deployment subset.
- P7 gates P7-0 … P7-6: **all PASS** (P7-3 as the Product / Software
  Readiness Gate; Deployment Readiness is a separate runbook obligation) — see
  the final closeout.

## Out of scope until Phase 4

- pass-to-proceed API, service tokens / API keys, webhooks, external
  integrations (#309/#310), optional multiTenant / SuperAdmin / tenant
  hierarchy / organizationSlug login / cross-tenant audit (#311), external log
  shipping (#312), custom roles (#313).
- Mandatory cloud runtime dependencies (never).
