# Documentation Index

> Entry point for the exam platform documentation. Start here.

```text
STATUS:          CURRENT
AUTHORITY:        Documentation navigation index
SCOPE:            Whole repository documentation tree
OWNER:            Architecture
BASELINE SYSTEM COMMIT:
                 e7af792815e8cf4bcff122a3d1d8db500b9d6eff (PR #197)
LAST VERIFIED REPOSITORY COMMIT:
                 c0dde8f1c11d05e78cf9dfb871afd3bbdee6daa2
SUPERSEDES:       docs/CURRENT.md (CURRENT.md is retained as a legacy pointer;
                  this README is now the canonical entry point)
RELATED ADRS:     —
```

## How to read this repository's docs

1. **Authority first.** The four authority documents below define the product,
   phase scope, code-quality gates, and this index. When an archived or
   point-in-time document conflicts with an authority document, the authority
   wins.
2. **Current architecture docs** live under `docs/architecture/` and
   `docs/status/`. They are reconstructed from production code and accepted
   ADRs, not from old phase plans.
3. **ADRs** live under `docs/adr/`. Each carries an explicit `Status` field
   (`Accepted`, `Deferred`, `Proposed`, `Superseded`). Status labels are the
   authority — never infer status from file location or age.
4. **Archived** material under `docs/archive/` is historical reference only.
   It must not be treated as current implementation guidance.
5. **Evidence** under `docs/evidence/` is final closure / verification proof.
   It records that a milestone was reached; it is not an ongoing plan.

## Authority documents

| Document | Role |
|----------|------|
| `docs/SPEC.md` | Product specification — invariants, domain model, architecture |
| `docs/phase-roadmap.md` | Phase 1 / 2 / 3 / 4 scope and status |
| `docs/code-quality.md` | Code-quality rules, gates, AI coding rules |
| `docs/README.md` | This index |

## Current architecture (reconstructed from code)

| Document | Subject |
|----------|---------|
| `docs/architecture/system-overview.md` | System layout, packages, runtimes |
| `docs/architecture/authorization.md` | Authorization model and `authz` boundary |
| `docs/architecture/exam-runtime.md` | Exam runtime kernel and `exam-engine` boundary |
| `docs/architecture/db-boundary.md` | `db` ↔ `domain` contract and repository rule |

## Current status

| Document | Subject |
|----------|---------|
| `docs/status/implementation-matrix.md` | Capability status matrix (code-evidenced) |
| `docs/roadmap/current.md` | Current authorized work and next steps |

## Decision records

| Document | Subject |
|----------|---------|
| `docs/adr/README.md` | ADR index with status labels |

## Active engineering references

| Document | Subject |
|----------|---------|
| `docs/api/contract.md` | Human-readable API contract (runtime Fastify/Zod is canonical) |
| `docs/api/reference.md` | API reference (human-readable) |
| `docs/testing/test-system-contract.md` | Test boundaries, env vars, CI lane contract (authority) |
| `docs/code-quality.md` | Code-quality contract (authority, also listed above) |
| `docs/import-export-format.md` | CSV import/export format |
| `docs/mock-data.md` | Mock / demo data reference |
| `docs/dev/i18n-copy-policy.md` | i18n copy rules and `lint:copy` gate |
| `docs/dev/observability-contract.md` | Logging, audit, trace conventions |
| `docs/dev/redis-baseline.md` | Redis optional-infrastructure baseline |
| `docs/dev/test-flakes.md` | Test flake register and improvement log |

## Frontend visual authority

| Document | Subject |
|----------|---------|
| `docs/frontend/P3-UI-AUDIT-0-frontend-visual-language-audit.md` | Accepted as-built visual-language audit |
| `docs/frontend/P3-UI-Foundation-plan.md` | UI foundation work authority (chain, recipes, sequence) |
| `docs/frontend/P3-UI-LINT-2-phase3-authority-bypass-decision.md` | Authority-bypass lint boundary decision |
| `docs/frontend/P3-UI-component-authority.md` | Shared visual component authority (UI-COMP-1) |
| `docs/frontend/component-governance.md` | Frozen web UI stack and component rules |

## Frozen review (basis of this reorganization)

| Document | Subject |
|----------|---------|
| `docs/architecture-scan-findings-2026-07-21.md` | Architecture scan (discovery evidence) |
| `docs/architecture-scan-review-2026-07-21.md` | Verified review and revised manifest |

These two files are the basis for the Wave 1 simplification. They are frozen;
do not edit them. New findings belong in new documents.

## Do NOT treat as current

- `docs/archive/` — historical reference only.
- `docs/evidence/` — closure proof, not an ongoing plan.
- Any document not listed in the index above should be assumed historical
  until an authority document references it.
