# Documentation Index

> The single canonical entry point for this repository's documentation.
> Developers and AI agents: start here, not in `docs/archive/`.

## Authority by fact type

The repository does not use one global ranking for unlike facts. Each fact type
has one authority:

| Fact type | Authority |
| --- | --- |
| A specific architectural decision | Accepted ADRs under [`docs/adr/`](adr/) |
| External behavior and data format | [`docs/contracts/`](contracts/), generated OpenAPI, and contract tests |
| Product invariants and domain model | [`docs/SPEC.md`](SPEC.md) |
| Current implemented architecture | [`docs/architecture/`](architecture/) and production code |
| Engineering and verification policy | [`docs/standards/`](standards/) and executable repository gates |
| Current implementation state | [`docs/status/`](status/) plus as-built code/test evidence |
| Phase boundaries | [`docs/roadmap/phase-roadmap.md`](roadmap/phase-roadmap.md) |
| Current backlog sequencing / disposition | Active roadmap tracker; currently GitHub Issue [#333](https://github.com/jnhu76/exam/issues/333) |
| Current task scope / acceptance / non-goals | The OPEN GitHub Issue selected by the current roadmap |
| Historical evidence | [`docs/archive/`](archive/), Git, closed Issues, and merged PRs |

An OPEN Issue is an execution contract, not a substitute for runtime or product
truth. Before implementation, reconcile it with current master. Closed Issues,
merged PRs, audits, and archived plans are historical evidence only.

When two sources describe the same fact differently, treat the disagreement as
a defect. Characterize the as-built behavior, identify the stale or violated
authority, and reconcile the affected sources together. Do not silently choose
the easiest source. Archived material is evidence only and never current
guidance.

## Where things live

### Specification & phase scope

| Document | Purpose |
| --- | --- |
| [`SPEC.md`](SPEC.md) | Product specification — invariants and domain model |
| [`roadmap/phase-roadmap.md`](roadmap/phase-roadmap.md) | Stable phase boundaries and acceptance scope |
| [`roadmap/current.md`](roadmap/current.md) | Phase-level status summary; intentionally does not duplicate the live Issue queue |
| [`roadmap/post-mvp-issues.md`](roadmap/post-mvp-issues.md) | Coarse Issue index; live state and ordering remain on GitHub |
| GitHub Issue [#333](https://github.com/jnhu76/exam/issues/333) | Current generic-completion → stabilization → High-Assurance / ToB sequencing authority |
| [`roadmap/phase3-open-items.md`](roadmap/phase3-open-items.md) | Phase 3 inventory/reference; live Issue state wins when status changes |
| [`roadmap/P7-system-readiness-and-exam-modes.md`](roadmap/P7-system-readiness-and-exam-modes.md) | P7 planning record — **STATUS: CLOSED** |
| [`audits/P7-FINAL-PROGRAM-CLOSEOUT.md`](audits/P7-FINAL-PROGRAM-CLOSEOUT.md) | P7 final program closeout evidence |
| [`audits/P7-R0-REDIS-CAPABILITY-STUDY.md`](audits/P7-R0-REDIS-CAPABILITY-STUDY.md) | Redis capability fact-base |

### Architecture (current implemented design)

| Document | Purpose |
| --- | --- |
| [`architecture/authorization.md`](architecture/authorization.md) | Capability-based authorization model |
| [`architecture/exam-runtime.md`](architecture/exam-runtime.md) | Exam / Attempt / Answer / Submit / Grading / Result visibility protocol |
| [`architecture/exam-system/candidate-recovery.md`](architecture/exam-system/candidate-recovery.md) | Candidate recovery sequences and authority boundaries |
| [`architecture/exam-system/state-and-authority.md`](architecture/exam-system/state-and-authority.md) | Lifecycle, policy, timestamp, and evidence dimensions |
| [`architecture/email-config.md`](architecture/email-config.md) | Email outbox/SMTP operator reference |

### Contracts (behavior code must preserve)

| Document | Purpose |
| --- | --- |
| [`contracts/api-contract.md`](contracts/api-contract.md) | Runtime-first API contract policy |
| [`contracts/api-reference.md`](contracts/api-reference.md) | Human-readable API guide |
| [`contracts/observability.md`](contracts/observability.md) | Logging, audit, trace conventions |
| [`contracts/redis-baseline.md`](contracts/redis-baseline.md) | Redis optional-infrastructure baseline |
| [`contracts/import-export-format.md`](contracts/import-export-format.md) | CSV import/export data formats |
| [`contracts/mock-data.md`](contracts/mock-data.md) | Demo seed data contract |

### ADRs (architectural decisions)

| Document | Purpose |
| --- | --- |
| [`adr/README.md`](adr/README.md) | ADR index — status, supersession, numbering |
| [`adr/ADR-001-redis.md`](adr/ADR-001-redis.md) … [`ADR-018-operational-observability-window.md`](adr/ADR-018-operational-observability-window.md) | Formal architecture decisions |

Recovery authority:

- [`adr/ADR-012-candidate-recovery-contract.md`](adr/ADR-012-candidate-recovery-contract.md)
  freezes candidate recovery and answer authority.
- [`adr/ADR-013-interruption-time-compensation-policy.md`](adr/ADR-013-interruption-time-compensation-policy.md)
  freezes interruption evidence, compensation policy, and deadline ordering.
- [`adr/ADR-014-exam-incident-authority.md`](adr/ADR-014-exam-incident-authority.md)
  freezes exam-incident identity, lifecycle, permissions, and action links.
- [`audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md`](audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md)
  records source-proven runtime reality at its audit baseline.

### Standards (constraints on future work)

| Document | Purpose |
| --- | --- |
| [`standards/code-quality.md`](standards/code-quality.md) | Quality rules, gates, dependency graph, AI coding rules |
| [`standards/testing.md`](standards/testing.md) | Testing & CI contract, environment variables, DB lifecycle |
| [`standards/i18n-copy-policy.md`](standards/i18n-copy-policy.md) | i18n hardcoded-copy gate |
| [`standards/test-flakes.md`](standards/test-flakes.md) | Test flake registry |

### Status (what is implemented now)

| Document | Purpose |
| --- | --- |
| [`status/implementation-status.md`](status/implementation-status.md) | Implemented / partial / limited summary; reconcile with current master before relying on a changing detail |

### Frontend visual authority

| Document | Purpose |
| --- | --- |
| [`architecture/frontend.md`](architecture/frontend.md) | As-built frontend architecture |
| [`standards/ui-system.md`](standards/ui-system.md) | Design tokens, recipes, component authority, Tailwind boundary, accessibility, lint |
| [`roadmap/ui-open-items.md`](roadmap/ui-open-items.md) | Unfinished visual-authority migration work |

See also the root [`DESIGN.md`](../DESIGN.md) and
[`AGENTS.md`](../AGENTS.md) §“前端任务路由”.

### Formal executable models

| Path | Purpose |
| --- | --- |
| [`../formal/README.md`](../formal/README.md) | TLA+ executable specifications and model-checking inputs |

### Historical material (not current guidance)

[`docs/archive/`](archive/) holds plans, audits, reviews, implementation reports,
and phase-history material. It is reference-only. Git history, closed Issues,
and merged PRs serve the same historical-evidence role.

## Quick reference

```bash
pnpm dev
pnpm test
pnpm verify
pnpm lint:md
bash scripts/e2e/run-wsl.sh
```

Database lifecycle and environment discipline are authoritative in
[`standards/testing.md`](standards/testing.md) §2, especially §2.8. The root
[`AGENTS.md`](../AGENTS.md) retains only the destructive-operation safety guard.