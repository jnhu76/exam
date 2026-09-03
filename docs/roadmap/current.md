# Current Roadmap

> This file is a phase-level status summary, not the executable backlog.
> Stable phase boundaries live in [`phase-roadmap.md`](phase-roadmap.md).
> Current sequencing and disposition live in GitHub Issue
> [#333](https://github.com/jnhu76/exam/issues/333); each selected OPEN Issue
> carries its own scope, acceptance criteria, and non-goals.

## Status snapshot

| Phase / program | Status | Notes |
| --- | --- | --- |
| Phase 1 — Minimal Deliverable | ✅ CLOSED | Admin + Candidate reliable exam loop delivered. |
| Phase 2 — Exam Operation | ✅ CLOSED for the supported MVP subset | Additional timing/admission/high-assurance capabilities remain scheduled separately. |
| Phase 3 — Collaboration / Permissions | 🟨 GENERIC PRODUCT COMPLETION | Core authorization infrastructure and built-in scoped-role slices are implemented; remaining generic-product work is sequenced in #333. |
| P7 — System Readiness and Exam Modes | ✅ CLOSED | Final evidence: [`../archive/audits/P7-FINAL-PROGRAM-CLOSEOUT.md`](../archive/audits/P7-FINAL-PROGRAM-CLOSEOUT.md). |
| Phase 4 — Platformization | ⬜ NOT STARTED | Begins only after the generic edition is completed and stabilized. |

For implementation reality, use
[`../status/implementation-status.md`](../status/implementation-status.md) plus
current code/test evidence. If that status document disagrees with current
master, treat the disagreement as documentation drift and reconcile it.

## Current planning model

The repository is **Issues-first** for executable work:

1. #333 defines the current campaign ordering, deferred/decision-gated
   disposition, and anti-scope-creep guardrails.
2. The selected OPEN Issue is the task contract for scope, acceptance criteria,
   and non-goals.
3. Before implementation, that Issue must be reconciled with current master;
   stale assumptions are updated rather than blindly implemented.
4. Roadmap documents summarize stable phase boundaries and context; they do not
   maintain a second copy of live Issue state.
5. Closed Issues, merged PRs, and audits are historical evidence, not current
   runtime truth.

The coarse Issue catalog is [`post-mvp-issues.md`](post-mvp-issues.md). Always
use GitHub itself for current open/closed state and #333 for ordering.

## Generic-edition sequence

The current program shape is:

```text
current generic Exam
        ↓
S0 — evidence-first simplification / convergence
        ↓
S1 — complete the generic product feature loop
        ↓
S2 — generic edition stabilization / freeze
        ↓
S3 — ToB customization architecture
        ↓
S4 — modularization / plugin seams driven by real customization needs
```

The authoritative detail, including current checkpoints and issue ordering,
remains in #333 so this document does not become another rapidly stale backlog.

## Permanent boundary

Mandatory cloud runtime dependencies remain out of scope. Platformization such
as service APIs, webhooks, optional multi-tenant operation, external log
shipping, and custom roles must follow the post-freeze sequencing and decision
gates recorded in #333 and their active Issues.