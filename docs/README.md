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
| Cross-boundary Exam semantics (fact ownership, freeze/transfer points, candidate boundary, supported-capability rule) | [`architecture/exam-semantic-boundaries.md`](architecture/exam-semantic-boundaries.md) — EXSEM-001..020, adopted by [ADR-021](adr/ADR-021-exam-semantic-authority-adoption.md) |
| Rich content / document semantics (V1 grammar, canonicalization, limits, read/write/render integration) | [`architecture/rich-content-semantic-contract.md`](architecture/rich-content-semantic-contract.md) — adopted by [ADR-019](adr/ADR-019-content-document-model.md) |
| A specific architectural decision | Accepted ADRs under [`docs/adr/`](adr/) |
| External behavior, data format, and frozen semantics | [`docs/contracts/`](contracts/), generated OpenAPI, and contract tests |
| Product invariants and domain model | [`docs/SPEC.md`](SPEC.md) |
| Current implemented architecture | [`docs/architecture/`](architecture/) and production code |
| Engineering and verification policy | [`docs/standards/`](standards/) and executable repository gates |
| Current implementation state | [`docs/status/`](status/) plus as-built code/test evidence |
| Phase boundaries | [`docs/roadmap/phase-roadmap.md`](roadmap/phase-roadmap.md) |
| Current backlog sequencing / disposition | Specifically authorized **OPEN** GitHub Issue selected for that work. [#739](https://github.com/jnhu76/exam/issues/739) and [#812](https://github.com/jnhu76/exam/issues/812) are **closed** (completed 2026-10-25; PRs #814/#815/#816/#818 merged), so neither designates the current queue, and there is no universal successor to #584. This index does not maintain a live OPEN-Issue tracker: the authorized Issue itself is the contract. |
| Current task scope / acceptance / non-goals | That same OPEN Issue plus any explicitly adopted parent ordering |
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
| GitHub Issue [#584](https://github.com/jnhu76/exam/issues/584) | **Closed historical roadmap**: bounded post-#550 decisions, with NOT_PROVEN residuals; not current execution authority. Future High-Assurance is separately gated by [#293](https://github.com/jnhu76/exam/issues/293). |

### Architecture (current implemented design)

| Document | Purpose |
| --- | --- |
| [`architecture/exam-semantic-boundaries.md`](architecture/exam-semantic-boundaries.md) | **Cross-boundary Exam semantic authority** — EXSEM-001..020 frozen invariants: fact ownership, authority freeze/transfer points, legitimately live facts, candidate-observable boundary, effective-state rule, supported-capability definition (adopted by [ADR-021](adr/ADR-021-exam-semantic-authority-adoption.md)) |
| [`architecture/authorization.md`](architecture/authorization.md) | Capability-based authorization model |
| [`architecture/workspace-module-resolution.md`](architecture/workspace-module-resolution.md) | **Workspace module resolution authority (#794)** — the `@exam/*` exports contract (`@exam/test-source` → src in tests, `default`/`types` → dist in production), the shared Vitest resolution plugin, the permanent source-freshness oracles, and the banned physical-`/src/` import forms |
| [`architecture/deploy-payload.md`](architecture/deploy-payload.md) | **Deploy payload artifact contract (#798)** — the `files` allowlists defining what the production API image may carry (dist + `@exam/db` migrations), the three-boundary split (build context / deploy payload / runtime image), and the executable payload oracle wired into CI |
| [`architecture/exam-runtime.md`](architecture/exam-runtime.md) | Exam / Attempt / Answer / Submit / Grading / Result visibility protocol |
| [`architecture/rich-content-semantic-contract.md`](architecture/rich-content-semantic-contract.md) | **Rich V1 semantic and integration authority** — closed grammar, canonicalization, limits, read/write/render/export/capability seams (adopted by [ADR-019](adr/ADR-019-content-document-model.md)) |
| [`architecture/exam-system/README.md`](architecture/exam-system/README.md) | Exam-system architecture map and known limitations |
| [`architecture/exam-system/candidate-recovery.md`](architecture/exam-system/candidate-recovery.md) | Candidate recovery sequences and authority boundaries |
| [`architecture/exam-system/state-and-authority.md`](architecture/exam-system/state-and-authority.md) | Lifecycle, policy, timestamp, and evidence dimensions |
| [`architecture/exam-system/domain-model.md`](architecture/exam-system/domain-model.md) | Domain objects: classification, ownership, relationships |
| [`architecture/exam-system/protocol-catalog.md`](architecture/exam-system/protocol-catalog.md) | Protocol catalog: actor, preconditions, writes, transaction boundary, idempotency, audit |
| [`architecture/exam-system/data-authority.md`](architecture/exam-system/data-authority.md) | Data authority, immutability, and transaction boundaries |
| [`architecture/exam-system/security-model.md`](architecture/exam-system/security-model.md) | Security and trust boundaries |
| [`architecture/exam-system/diagrams.md`](architecture/exam-system/diagrams.md) | Evidence-backed architecture diagrams |
| [`architecture/exam-system/incident-authority.md`](architecture/exam-system/incident-authority.md) | Exam incident authority (ADR-014) |
| [`architecture/configuration-authority.md`](architecture/configuration-authority.md) | Configuration authority DAG: source → resolver → consumer, precedence, audit baseline |
| [`architecture/frontend.md`](architecture/frontend.md) | As-built frontend architecture |
| [`design/candidate-rich-editor-ux.md`](design/candidate-rich-editor-ux.md) | Candidate Rich editor interaction contract (#669 Phase U) — command model, toolbar/keyboard/formula/table behavior, lock-state presentation; consumes, never restates, the Rich semantic authority |
| [`design/admin-list-pagination-bdd.md`](design/admin-list-pagination-bdd.md) | **Admin list pagination / search / status behavior authority (#785)** — reachability, search scope, total semantics, page-reset rules, status vs score-permission independence for ExamPage / CandidatesPage / CoursePage / ResultsOverviewPage; query pipeline (scope → predicate → stable order → LIMIT/OFFSET), API param contracts, B01–B10 scenario→test matrix |
| [`design/admin-list-query-state-bdd.md`](design/admin-list-query-state-bdd.md) | **Admin list URL query-state authority (#784 A3)** — URL as the single authority for the submitted query on `/admin/questions` and `/admin/exams`: parameter tables and normalization, the two key spaces of the render gate, history semantics (push vs replace), strict return-target validation, A01–A18 scenario→test matrix |

#### Exam semantic authority — where to answer "who owns the fact?"

The cross-boundary Exam semantic authority is
[`architecture/exam-semantic-boundaries.md`](architecture/exam-semantic-boundaries.md)
(EXSEM-001..020), adopted by
[ADR-021](adr/ADR-021-exam-semantic-authority-adoption.md); there is no need
to search Issues #640/#641 for it. Division of authority:

| Carrier | Owns |
| --- | --- |
| `architecture/exam-semantic-boundaries.md` | Cross-boundary semantic authority (EXSEM clauses) |
| ADR-021 | Adoption / supersession rationale and the list of precisely superseded assertions |
| Existing mechanism ADRs | Specific mechanisms not superseded (transaction, time, recovery, authz) |
| `architecture/exam-runtime.md` | Current runtime commands and state relationships |
| SPEC / contracts / OpenAPI | Product and API formats |
| Code / tests | Mechanism + conformance evidence |
| Issues / audits / archive | Historical evidence, not normative authority |

Changing a frozen EXSEM clause requires an explicit superseding architecture
decision (see the boundaries document §6); code, tests, schema
representability, and stored reserved values cannot silently redefine it.

### Contracts (behavior code must preserve)

| Document | Purpose |
| --- | --- |
| [`contracts/api-contract.md`](contracts/api-contract.md) | Runtime-first API contract policy + canonical **Message & Error Contract** (ErrorCode / reason / params / message / field violations / localization zones; frozen by #413 C0) |
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
| [`adr/ADR-001-redis.md`](adr/ADR-001-redis.md) … [`ADR-023-remove-backup-evidence-subsystem.md`](adr/ADR-023-remove-backup-evidence-subsystem.md) | Formal architecture decisions |

Product capability composition: [`architecture/product-capability-composition.md`](architecture/product-capability-composition.md)
— adopted by [ADR-022](adr/ADR-022-product-capability-composition.md), tracked by
[#678](https://github.com/jnhu76/exam/issues/678).

- Phase 1 (implemented): closed Standard catalog, pure fail-closed resolver,
  single server composition root, and read-only projection through
  `GET /api/system/public-config`.
- Phase 2 (not implemented): authoritative server-side write guards.
- Phase 3 (not implemented): Minimal runtime.
- Phase 4 (not implemented): persisted deployment configuration with
  revision/CAS.

The projection is deployment availability only; it does not grant actor
Permissions, change exam policy, or revoke accepted obligations.

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
| [`standards/i18n-copy-policy.md`](standards/i18n-copy-policy.md) | i18n copy policy — **review-enforced** hardcoded-copy rules and copy taxonomy (browser / wire compat / server-rendered / diagnostics / data-format); the machine guard was removed by #634 (see the policy's directive model); semantics live in `contracts/api-contract.md` |
| [`standards/test-flakes.md`](standards/test-flakes.md) | Test flake registry |
| [`standards/ui-system.md`](standards/ui-system.md) | Design tokens, recipes, component authority, accessibility, visual lint |
| [`ui/visual-foundation.md`](ui/visual-foundation.md) | Visual Foundation authority map (issue #601): where each visual fact is governed, frozen non-table decisions, Agent-facing MUST rules, Phase-F table boundary |

### Status (what is implemented now)

| Document | Purpose |
| --- | --- |
| [`status/implementation-status.md`](status/implementation-status.md) | Implemented / partial / limited summary; reconcile changing details with current master |

### Product documentation (reviewed projection)

Audience-facing projections **derived from** the normative sources above —
version-bound and reviewed, but not additional authorities. When they
disagree with a normative source, the normative source governs.

| Document | Purpose |
| --- | --- |
| [`product/standard-supported-capabilities.md`](product/standard-supported-capabilities.md) (+ [zh-CN](product/standard-supported-capabilities.zh-CN.md)) | Standard supported capabilities & guarantees — deployment, save semantics, recovery/fault domains, explicit non-guarantees, support & evidence matrix (bound to master `511e6e60`, post-`v0.0.10` development version) |
| [`guides/first-exam.md`](guides/first-exam.md) (+ [zh-CN](guides/first-exam.zh-CN.md)) | Admin first-exam walkthrough on the shipped (zh-CN) UI: install → first admin → first exam → grading → results → interruption handling |

### Documentation site pilot (#751 P2 — repo-only, not published)

[`../docs-site/README.md`](../docs-site/README.md) defines a bounded VitePress
pilot that renders an allowlisted projection of the product pages above. It is
**not** a second authority and is **not** published: no GitHub Pages, Wiki,
hosting, domain, or telemetry is configured. The projection allowlist, source →
route map, link rules, and build/verification commands live in that README.
Everything else under `docs/` (`archive/**`, `research/**`, ADRs, contracts,
architecture, standards, status, deployment, operations) is deliberately not
compiled into the site and appears there only as pinned GitHub links.

### Formal executable models

| Path | Purpose |
| --- | --- |
| [`../formal/README.md`](../formal/README.md) | TLA+ executable specifications and model-checking inputs |

### Deployment

| Document | Purpose |
| --- | --- |
| [`deployment/README.md`](deployment/README.md) | Deployment landing page — topology, image acquisition, configuration |
| [`deployment/mvp-deployment-runbook.md`](deployment/mvp-deployment-runbook.md) | Complete operator runbook |
| [`deployment/upgrade-and-uninstall.md`](deployment/upgrade-and-uninstall.md) | Upgrade lifecycle and uninstall guide |

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
bash scripts/e2e/run.sh
```

Database lifecycle and environment discipline are authoritative in
[`standards/testing.md`](standards/testing.md) §2, especially §2.8. The root
[`AGENTS.md`](../AGENTS.md) retains only the destructive-operation safety guard.
