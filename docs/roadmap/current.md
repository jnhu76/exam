# Current Roadmap

> Phase-level status **projection**, not a universal executable backlog.
> Stable phase boundaries: [`phase-roadmap.md`](phase-roadmap.md).
> Execution authority is the specifically selected **OPEN GitHub Issue**;
> no global successor was automatically promoted when [#584](https://github.com/jnhu76/exam/issues/584) closed.

## Status snapshot

| Phase / program | Status | Notes |
| --- | --- | --- |
| Phase 1 — Minimal Deliverable | ✅ CLOSED | Admin + Candidate reliable exam loop delivered. |
| Phase 2 — Exam Operation | ✅ CLOSED for supported MVP subset | Additional high-assurance capabilities are separate. |
| Phase 3 — Collaboration / Permissions | ✅ GENERIC RUNTIME COMPLETE | #516 and #552 completed; #584 post-#550 decision campaign also closed with explicitly unproven residuals. |
| P7 — System Readiness and Exam Modes | ✅ CLOSED | [Historical closeout](../archive/audits/P7-FINAL-PROGRAM-CLOSEOUT.md). |
| Controlled / Strict High-Assurance | ⬜ NOT STARTED | #293 is a future composition umbrella; #315/#316/#317 are missing. No automatic activation. |
| Phase 4 — Platformization | ⬜ NOT STARTED | Demand-driven, separately decision-gated. |

For as-built reality, consult [`implementation-status.md`](../status/implementation-status.md)
and current code/test evidence. Reconcile disagreements rather than choosing a
convenient authority.

## Selecting executable work

1. Select a specifically authorized **OPEN** Issue. That Issue owns task
   scope, checkpoints, ordering, acceptance criteria and non-goals.
2. Reconcile it with current master and the relevant normative authority before
   editing; fix stale assumptions in the Issue.
3. A parent umbrella governs only its declared domain. Neither a closed
   roadmap nor an unrelated open umbrella is a universal current tracker.
4. This page and [`post-mvp-issues.md`](post-mvp-issues.md) are
   **projections/navigation**. GitHub owns actual open/closed status.
5. If no open task has been selected for a phase, the phase has no active
   execution owner; do not infer one from Issue ordering.

## Historical closeout and future gate

```text
#516 Generic Runtime                  COMPLETE
   ↓
#552 Generic Production Hardening     COMPLETE
   ↓
#584 Post-#550 decision campaign     CLOSED — BOUNDED DISPOSITIONS
   ├─ #585 HTTP nginx ingress        SUPPORTED; TLS NOT ACTIVE
   ├─ #586 DB pool decision          KEEP_POOL_10; #668 deferred
   └─ #587 login CPU decision        CLOSED_WITH_DEFERRED_EVIDENCE

Separate future High-Assurance lane (NOT automatically authorized):
#315 device/session binding
   ↓
#316 secondary identity verification
   ↓
#317 continuous monitoring
   ↓
#293 final Controlled / Strict composition
```

[#584](https://github.com/jnhu76/exam/issues/584) is **closed historical
decision evidence**, not current execution authority. Its final record
distinguishes supported HTTP ingress and the KEEP_POOL_10 decision from
unproven production-hardware, multi-instance, >S200, and windowed-login
capacity. [#587](https://github.com/jnhu76/exam/issues/587) does **not**
certify a sustainable login arrival rate or mixed-workload QoS. If a concrete
deployment needs that assurance, open a dedicated measured-evidence task.
Account/admission session continuity is separately designed in
[#645](https://github.com/jnhu76/exam/issues/645).

[#293](https://github.com/jnhu76/exam/issues/293) remains OPEN as the
High-Assurance readiness umbrella, **NOT STARTED**. Execution ordering and
profile commitments still require an explicit human decision plus evidence
for #315–#317 (or a reviewed reduction of promised features).
Independent programs such as [#678](https://github.com/jnhu76/exam/issues/678)
own their own scope; none silently succeeds #584 globally.

## Permanent boundary

PostgreSQL remains the sole durable exam authority; Redis is bounded
rate-limit coordination, not a second durable authority. No mandatory cloud,
MQ, cache or multi-instance adoption follows from this roadmap closeout.
Service APIs, webhooks, multi-tenancy, external log shipping and custom roles
remain demand-driven under their own Issues.
