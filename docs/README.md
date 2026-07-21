# Documentation Index

> The single canonical entry point for this repository's documentation.
> Developers and AI agents: start here, not in `docs/archive/`.

## Authority precedence

When documents conflict, higher precedence wins:

1. **Accepted ADRs** — [`docs/adr/`](adr/) (binding architectural decisions)
2. **Contracts** — [`docs/contracts/`](contracts/) (behavior code must preserve)
3. **Specification** — [`docs/SPEC.md`](SPEC.md) (invariants + domain model)
4. **Current architecture** — [`docs/architecture/`](architecture/)
5. **Standards** — [`docs/standards/`](standards/) (constraints on future work)
6. **Current status** — [`docs/status/`](status/) (what is implemented now)
7. **Roadmap** — [`docs/roadmap/`](roadmap/) (future work only)
8. **Archive** — [`docs/archive/`](archive/) (historical; never current guidance)

> `docs/SPEC.md` and `docs/roadmap/phase-roadmap.md` are the product/phase
> authority and win over implementation details. If an archived document
> conflicts with an active one, the active document wins.

## Where things live

### Specification & phase scope

| Document | Purpose |
| --- | --- |
| [`SPEC.md`](SPEC.md) | Product specification — invariants, domain model, architecture (highest product authority) |
| [`roadmap/phase-roadmap.md`](roadmap/phase-roadmap.md) | Phase 1/2/3/4 scope and acceptance (phase authority) |
| [`roadmap/current.md`](roadmap/current.md) | Current work and what comes next |
| [`roadmap/phase3-open-items.md`](roadmap/phase3-open-items.md) | Open Phase 3 product work (capability, state, dependencies, acceptance boundary) |

### Architecture (current implemented design)

| Document | Purpose |
| --- | --- |
| [`architecture/authorization.md`](architecture/authorization.md) | Capability-based authorization model (implemented) |
| [`architecture/exam-runtime.md`](architecture/exam-runtime.md) | Exam protocol foundation — Exam/Attempt/Answer/Submit/Grading/Result visibility |
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
| [`adr/ADR-001-redis.md`](adr/ADR-001-redis.md) … [`ADR-010-scoped-rbac-architecture.md`](adr/ADR-010-scoped-rbac-architecture.md) | 10 formal ADRs |

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
| [`frontend/P3-UI-AUDIT-0-frontend-visual-language-audit.md`](frontend/P3-UI-AUDIT-0-frontend-visual-language-audit.md) | Accepted as-built visual-language audit |
| [`frontend/P3-UI-Foundation-plan.md`](frontend/P3-UI-Foundation-plan.md) | UI foundation authority (chain, recipes, sequence, lint rules) |
| [`frontend/P3-UI-component-authority.md`](frontend/P3-UI-component-authority.md) | Per-component role ownership |
| [`frontend/component-governance.md`](frontend/component-governance.md) | Stack freeze + dependency rules |
| [`frontend/design-preview.html`](frontend/design-preview.html) | Quiet Graphite visual specimen (companion to root `DESIGN.md`) |

See also the root [`DESIGN.md`](../DESIGN.md) (project-owned visual authority) and
[`AGENTS.md`](../AGENTS.md) §"Frontend Visual Authority".

### Historical material (not current guidance)

[`docs/archive/`](archive/) holds plans, audits, reviews, implementation reports,
and phase-history material. It is reference-only. Subdirectories:
`archive/plans/`, `archive/reviews/`, `archive/audits/`,
`archive/implementation-reports/`, `archive/frontend/`, `archive/phase3/`,
`archive/followups/`, `archive/prompts/`, plus the pre-existing
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

Database discipline: see [`AGENTS.md`](../AGENTS.md) §"Local Database Discipline".
