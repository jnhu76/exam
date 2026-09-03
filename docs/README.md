# Documentation Index

> The single canonical entry point for this repository's documentation.
> Developers and AI agents: start here, not in `docs/archive/`.

The root `README.md` is **descriptive and navigational** — it introduces the
project and points to authoritative documents. It is not a runtime authority.
If `README.md` conflicts with current production behavior, `README.md` is stale.
Production code determines what the system actually does today; normative
documents (SPEC, ADRs, contracts) determine what it is required or intended to
do within their declared authority. A mismatch is a defect or documentation
drift and must be reconciled explicitly.

## Authority by fact type

The repository does not use one global ranking for unlike facts. Each fact type
has one authority:

| Fact type | Authority |
| --- | --- |
| A specific architectural decision | Accepted ADRs under [`docs/adr/`](adr/) |
| External behavior, data format, and frozen semantics | [`docs/contracts/`](contracts/), generated OpenAPI, and contract tests |
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
merged PRs, archived audits, and archived plans are historical evidence only.

When two sources describe the same fact differently, treat the disagreement as
a defect. Characterize the as-built behavior, identify the stale or violated
authority, and reconcile the affected sources together. Do not silently choose
the easiest source. Archived material is evidence only and never current
guidance.

## Current documentation

### Specification & phase scope

| Document | Purpose |
| --- | --- |
| [`SPEC.md`](SPEC.md) | Product specification — invariants and domain model |
| [`roadmap/phase-roadmap.md`](roadmap/phase-roadmap.md) | Stable phase boundaries and acceptance scope |
| [`roadmap/current.md`](roadmap/current.md) | Phase-level status summary; intentionally does not duplicate the live Issue queue |
| [`roadmap/post-mvp-issues.md`](roadmap/post-mvp-issues.md) | Coarse Issue index; live state and ordering remain on GitHub |
| GitHub Issue [#333](https://github.com/jnhu76/exam/issues/333) | Current generic-completion → stabilization → High-Assurance / ToB sequencing authority |

### Architecture (current implemented design)

| Document | Purpose |
| --- | --- |
| [`architecture/authorization.md`](architecture/authorization.md) | Capability-based authorization model |
| [`architecture/exam-runtime.md`](architecture/exam-runtime.md) | Exam / Attempt / Answer / Submit / Grading / Result visibility protocol |
| [`architecture/exam-system/README.md`](architecture/exam-system/README.md) | Exam-system architecture map and known limitations |
| [`architecture/exam-system/candidate-recovery.md`](architecture/exam-system/candidate-recovery.md) | Candidate recovery sequences and authority boundaries |
| [`architecture/exam-system/state-and-authority.md`](architecture/exam-system/state-and-authority.md) | Lifecycle, policy, timestamp, and evidence dimensions |
| [`architecture/frontend.md`](architecture/frontend.md) | As-built frontend architecture |

### Contracts (behavior code must preserve)

| Document | Purpose |
| --- | --- |
| [`contracts/api-contract.md`](contracts/api-contract.md) | Runtime-first API contract policy |
| [`contracts/api-reference.md`](contracts/api-reference.md) | Human-readable API guide |
| [`contracts/observability.md`](contracts/observability.md) | Logging, audit, trace conventions |
| [`contracts/redis-baseline.md`](contracts/redis-baseline.md) | Redis optional-infrastructure baseline |
| [`contracts/import-export-format.md`](contracts/import-export-format.md) | CSV import/export data formats |
| [`contracts/mock-data.md`](contracts/mock-data.md) | Demo seed data contract |
| [`contracts/admin-recovery-center.md`](contracts/admin-recovery-center.md) | Admin Recovery Center API/read-model authority (J5-R0) |
| [`contracts/timed-sync-semantics.md`](contracts/timed-sync-semantics.md) | `timed_sync` frozen clock semantics (#291 Phase B, B0 authority) |
| [`contracts/exam-policy-authority.md`](contracts/exam-policy-authority.md) | Exam policy schema + conflict-validator authority (P7-M1) |
| [`contracts/exam-profile-templates.md`](contracts/exam-profile-templates.md) | Exam policy profile templates + authoring-time resolution authority (P7-M2) |

### ADRs (architectural decisions)

| Document | Purpose |
| --- | --- |
| [`adr/README.md`](adr/README.md) | ADR index — status, supersession, numbering |
| [`adr/ADR-001-redis.md`](adr/ADR-001-redis.md) … [`ADR-018-operational-observability-window.md`](adr/ADR-018-operational-observability-window.md) | Formal architecture decisions |

Key recovery authority:

- [`adr/ADR-012-candidate-recovery-contract.md`](adr/ADR-012-candidate-recovery-contract.md)
  freezes candidate recovery and answer authority.
- [`adr/ADR-013-interruption-time-compensation-policy.md`](adr/ADR-013-interruption-time-compensation-policy.md)
  freezes interruption evidence, compensation policy, and deadline ordering.
- [`adr/ADR-014-exam-incident-authority.md`](adr/ADR-014-exam-incident-authority.md)
  freezes exam-incident identity, lifecycle, permissions, and action links.

### Standards (constraints on future work)

| Document | Purpose |
| --- | --- |
| [`standards/code-quality.md`](standards/code-quality.md) | Quality rules, gates, dependency graph, AI coding rules |
| [`standards/testing.md`](standards/testing.md) | Testing & CI contract, environment variables, DB lifecycle |
| [`standards/i18n-copy-policy.md`](standards/i18n-copy-policy.md) | i18n hardcoded-copy gate |
| [`standards/test-flakes.md`](standards/test-flakes.md) | Test flake registry |
| [`standards/ui-system.md`](standards/ui-system.md) | Design tokens, recipes, component authority, accessibility, visual lint |

### Status (what is implemented now)

| Document | Purpose |
| --- | --- |
| [`status/implementation-status.md`](status/implementation-status.md) | Implemented / partial / limited summary; reconcile changing details with current master |

### Formal executable models

| Path | Purpose |
| --- | --- |
| [`../formal/README.md`](../formal/README.md) | TLA+ executable specifications and model-checking inputs |

### Deployment

| Document | Purpose |
| --- | --- |
| [`deployment/README.md`](deployment/README.md) | Deployment landing page — topology, image acquisition, configuration |
| [`deployment/mvp-deployment-runbook.md`](deployment/mvp-deployment-runbook.md) | Complete operator runbook |
| [`deployment/backup-and-recovery.md`](deployment/backup-and-recovery.md) | Backup procedures and restore evidence |
| [`deployment/upgrade-and-uninstall.md`](deployment/upgrade-and-uninstall.md) | Upgrade lifecycle and uninstall guide |
| [`deployment/gates.md`](deployment/gates.md) | Deployment gate definitions |

### Operations

| Document | Purpose |
| --- | --- |
| [`operations/README.md`](operations/README.md) | Operations landing page — backup, upgrade, diagnostics, email |
| [`operations/email-config.md`](operations/email-config.md) | Email outbox/SMTP operator reference |

### Development

| Document | Purpose |
| --- | --- |
| [`../INSTALL.md`](../INSTALL.md) | First installation — zero to running |
| [`development/README.md`](development/README.md) | Development landing page — local setup, testing, E2E |
| [`development/ports.md`](development/ports.md) | Port map and ownership rules |
| [`standards/code-quality.md`](standards/code-quality.md) | Code quality rules, gates, AI coding rules |
| [`standards/testing.md`](standards/testing.md) | Testing and CI contract |

See also the root [`DESIGN.md`](../DESIGN.md) and [`AGENTS.md`](../AGENTS.md).

## Historical evidence (not current guidance)

[`docs/archive/`](archive/) contains historical plans, audits, reviews,
implementation reports, closeouts, and superseded backlogs. Current documents
may cite archived files as evidence, but archived material is never the current
authority for implementation.

Representative records:

| Document | Historical role |
| --- | --- |
| [`archive/roadmap/phase3-open-items.md`](archive/roadmap/phase3-open-items.md) | Superseded Phase 3 execution inventory |
| [`archive/roadmap/P7-system-readiness-and-exam-modes.md`](archive/roadmap/P7-system-readiness-and-exam-modes.md) | Closed P7 planning record |
| [`archive/roadmap/ui-open-items.md`](archive/roadmap/ui-open-items.md) | Superseded UI migration inventory |
| [`archive/audits/P7-FINAL-PROGRAM-CLOSEOUT.md`](archive/audits/P7-FINAL-PROGRAM-CLOSEOUT.md) | P7 final closeout evidence |
| [`archive/audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md`](archive/audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md) | Recovery runtime reality evidence at its audit baseline |

For archive semantics and directory taxonomy, see
[`archive/README.md`](archive/README.md).

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
