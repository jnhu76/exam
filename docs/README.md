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
| Current implementation state | [`docs/status/`](status/) |
| Phase scope and future work | [`docs/roadmap/`](roadmap/) and its GitHub Issue index |
| Historical evidence | [`docs/archive/`](archive/), Git, Issues, and PRs |

When two sources describe the same fact differently, treat the disagreement as
a defect. Characterize the as-built behavior, identify the stale or violated
authority, and reconcile the affected sources together. Do not silently choose
the easiest source. Archived material is evidence only and never current
guidance.

## Where things live

### Specification & phase scope

| Document | Purpose |
| --- | --- |
| [`SPEC.md`](SPEC.md) | Product specification — invariants, domain model, architecture (highest product authority) |
| [`roadmap/phase-roadmap.md`](roadmap/phase-roadmap.md) | Phase 1/2/3/4 scope and acceptance (phase authority) |
| [`roadmap/current.md`](roadmap/current.md) | Current work and what comes next |
| [`roadmap/post-mvp-issues.md`](roadmap/post-mvp-issues.md) | **GitHub Issues index — the authority for executable future work** (Phase 2+/3/UI/Phase 4) |
| [`roadmap/phase3-open-items.md`](roadmap/phase3-open-items.md) | Phase 3 product inventory — every open item links to its Issue |
| [`roadmap/P7-system-readiness-and-exam-modes.md`](roadmap/P7-system-readiness-and-exam-modes.md) | P7 planning record — **STATUS: CLOSED** (historical; final authority: [`audits/P7-FINAL-PROGRAM-CLOSEOUT.md`](audits/P7-FINAL-PROGRAM-CLOSEOUT.md)) |
| [`audits/P7-FINAL-PROGRAM-CLOSEOUT.md`](audits/P7-FINAL-PROGRAM-CLOSEOUT.md) | **P7 final program closeout — gate matrix, disposition matrix, deferred-work matrix, Gate P7-3 acceptance record** |
| [`audits/P7-R0-REDIS-CAPABILITY-STUDY.md`](audits/P7-R0-REDIS-CAPABILITY-STUDY.md) | P7-R0 Redis capability fact-base (capabilities, durability/RPO, workload classes, references) |

### Architecture (current implemented design)

| Document | Purpose |
| --- | --- |
| [`architecture/authorization.md`](architecture/authorization.md) | Capability-based authorization model (implemented) |
| [`architecture/exam-runtime.md`](architecture/exam-runtime.md) | Exam protocol foundation — Exam/Attempt/Answer/Submit/Grading/Result visibility |
| [`architecture/exam-system/candidate-recovery.md`](architecture/exam-system/candidate-recovery.md) | Candidate recovery sequences, interruption policy, and authority boundaries |
| [`architecture/exam-system/state-and-authority.md`](architecture/exam-system/state-and-authority.md) | Lifecycle, policy, timestamp, and evidence dimensions |
| [`architecture/email-config.md`](architecture/email-config.md) | Email outbox/SMTP config (operator reference) |

### Contracts (behavior code must preserve)

| Document | Purpose |
| --- | --- |
| [`contracts/api-contract.md`](contracts/api-contract.md) | Runtime-first API contract policy (OpenAPI is canonical) |
| [`contracts/api-reference.md`](contracts/api-reference.md) | Human-readable API guide |
| [`contracts/observability.md`](contracts/observability.md) | Logging, audit, trace conventions |
| [`contracts/redis-baseline.md`](contracts/redis-baseline.md) | Redis optional infrastructure baseline |
| [`contracts/import-export-format.md`](contracts/import-export-format.md) | CSV import/export data formats |
| [`contracts/mock-data.md`](contracts/mock-data.md) | Demo seed data contract |

### ADRs (architectural decisions)

| Document | Purpose |
| --- | --- |
| [`adr/README.md`](adr/README.md) | ADR index — status, supersession, numbering |
| [`adr/ADR-001-redis.md`](adr/ADR-001-redis.md) … [`ADR-018-operational-observability-window.md`](adr/ADR-018-operational-observability-window.md) | 18 formal ADRs (ADR-001 … ADR-018) |

Recovery authority:

- [`adr/ADR-012-candidate-recovery-contract.md`](adr/ADR-012-candidate-recovery-contract.md)
  freezes candidate recovery and answer authority.
- [`adr/ADR-013-interruption-time-compensation-policy.md`](adr/ADR-013-interruption-time-compensation-policy.md)
  freezes interruption evidence, compensation policy, deadline ordering, and
  the future PostgreSQL episode/ledger model.
- [`adr/ADR-014-exam-incident-authority.md`](adr/ADR-014-exam-incident-authority.md)
  freezes the exam incident authority (identity, lifecycle, permissions,
  action links); ACCEPTED 2026-08-01, runtime implemented (J3, PR #242) and
  the Admin recovery center (J5) is closed.
- [`audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md`](audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md)
  records the source-proven runtime reality at the REC-I4-R0 baseline.

### Standards (constraints on future work)

| Document | Purpose |
| --- | --- |
| [`standards/code-quality.md`](standards/code-quality.md) | Quality rules, gates, dependency graph, AI coding rules |
| [`standards/testing.md`](standards/testing.md) | Testing & CI contract (boundaries, env vars, lanes) |
| [`standards/i18n-copy-policy.md`](standards/i18n-copy-policy.md) | i18n hardcoded-copy gate |
| [`standards/test-flakes.md`](standards/test-flakes.md) | Test flake registry |

### Status (what is implemented now)

| Document | Purpose |
| --- | --- |
| [`status/implementation-status.md`](status/implementation-status.md) | Implemented / partial / limited, per phase |

### Frontend visual authority

| Document | Purpose |
| --- | --- |
| [`architecture/frontend.md`](architecture/frontend.md) | As-built frontend architecture (shell, routing, layouts, API client, state, package boundaries, tech stack, responsive structure) |
| [`standards/ui-system.md`](standards/ui-system.md) | As-built UI system constraints (design tokens, fonts, typography recipes, surface/elevation, component authority, Tailwind boundary, status color, icons, tables, accessibility, active `exam-ui/*` lint) |
| [`roadmap/ui-open-items.md`](roadmap/ui-open-items.md) | Unfinished visual-authority migration work |

See also the root [`DESIGN.md`](../DESIGN.md) (project-owned visual authority) and
[`AGENTS.md`](../AGENTS.md) §“前端任务路由”.

### Formal executable models

| Path | Purpose |
| --- | --- |
| [`../formal/README.md`](../formal/README.md) | TLA+ executable specifications and model-checking inputs (outside `docs/` — see `formal/README.md` for the storage rationale). The recovery protocol is model-checked under `formal/tla/recovery/`. |

### Historical material (not current guidance)

[`docs/archive/`](archive/) holds plans, audits, reviews, implementation reports,
and phase-history material. It is reference-only. Subdirectories:
`archive/plans/`, `archive/reviews/`, `archive/audits/`,
`archive/implementation-reports/`, `archive/frontend/`, `archive/phase3/`,
`archive/roadmap/`, `archive/followups/`, `archive/prompts/`, plus the pre-existing
`archive/phase1-archive/`, `archive/phase2-archive/`, `archive/phase3-archive/`,
`archive/ui/`, `archive/dev/`.

## Quick reference

```bash
pnpm dev          # start dev servers (uses the `exam` database)
pnpm test         # run tests (uses the `exam_test` database)
pnpm verify       # format + lint + copy + arch + typecheck + tests + build
pnpm lint:md      # markdown lint
bash scripts/e2e/run-wsl.sh   # local E2E (uses the `exam_e2e` database)
```

Database lifecycle and environment discipline are authoritative in
[`standards/testing.md`](standards/testing.md) §2, especially §2.8. The root
[`AGENTS.md`](../AGENTS.md) retains only the destructive-operation safety guard.
