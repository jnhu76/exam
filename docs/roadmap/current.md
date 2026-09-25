# Current Roadmap

> This file is a phase-level status summary, not the executable backlog.
> Stable phase boundaries live in [`phase-roadmap.md`](phase-roadmap.md).
> Current sequencing and disposition live in GitHub Issue
> [#584](https://github.com/jnhu76/exam/issues/584) — the successor execution
> authority after the [#552](https://github.com/jnhu76/exam/issues/552)
> production-hardening roadmap closed; each selected OPEN Issue carries its
> own scope, acceptance criteria, and non-goals.

## Status snapshot

| Phase / program | Status | Notes |
| --- | --- | --- |
| Phase 1 — Minimal Deliverable | ✅ CLOSED | Admin + Candidate reliable exam loop delivered. |
| Phase 2 — Exam Operation | ✅ CLOSED for the supported MVP subset | Additional high-assurance capabilities remain scheduled separately. |
| Phase 3 — Collaboration / Permissions | ✅ GENERIC RUNTIME COMPLETE | Generic Runtime completed under #516, and the #552 production-hardening roadmap has since closed. Current work is sequenced by #584 (post-#550 measured bottlenecks + production deployment closure); High-Assurance activation is deferred until #584 closes. |
| P7 — System Readiness and Exam Modes | ✅ CLOSED | Final evidence: [`../archive/audits/P7-FINAL-PROGRAM-CLOSEOUT.md`](../archive/audits/P7-FINAL-PROGRAM-CLOSEOUT.md). |
| Phase 4 — Platformization | ⬜ NOT STARTED | ToB/platform work remains demand-driven and outside the current execution lane. |

For implementation reality, use
[`../status/implementation-status.md`](../status/implementation-status.md) plus
current code/test evidence. If that status document disagrees with current
master, treat the disagreement as documentation drift and reconcile it.

## Current planning model

The repository is **Issues-first** for executable work:

1. the live tracker (#584) defines the current campaign ordering,
   deferred/decision-gated disposition, and anti-scope-creep guardrails;
2. the selected OPEN Issue is the task contract for scope, acceptance criteria,
   and non-goals;
3. before implementation, that Issue must be reconciled with current master;
   stale assumptions are updated rather than blindly implemented;
4. roadmap documents summarize stable phase boundaries and context; they do not
   maintain a second copy of live Issue state;
5. closed Issues, merged PRs, and audits are historical evidence, not current
   runtime truth.

The coarse Issue catalog is [`post-mvp-issues.md`](post-mvp-issues.md). Always
use GitHub itself for current open/closed state and the live tracker (#584) for
ordering.

## Current execution sequence

The current authorized phase sequence is:

```text
#516 Generic Runtime Completion — COMPLETE
        ↓
#552 Generic Production Hardening — COMPLETE (capacity re-proof via #550)
        ↓
#584 Post-#550 measured bottleneck + production deployment closure — CURRENT
        ↓
#315 device/session binding
        ↓
#316 secondary identity verification
        ↓
#317 continuous monitoring
        ↓
#293 final Controlled / Strict composition
```

#552 is the completed historical execution authority: it closed after the
#550 final capacity re-proof. Its successor #584 owns the measured residual
bottlenecks and production-deployment closure work promoted from #550. The
internal High-Assurance order remains `#315 → #316 → #317 → #293`, but it does
not become the main execution chain until #584 closes unless an explicit human
authority decision changes the phase order.

The authoritative detail, including current checkpoints and child ordering,
remains in the live tracker (#584) so this document does not become another
rapidly stale backlog.

## Permanent boundary

Mandatory cloud runtime dependencies remain out of scope. Platformization such
as service APIs, webhooks, optional multi-tenant operation, external log
shipping, and custom roles remains demand-driven and must follow its own
explicit decision/implementation Issues rather than being pulled into #584.
