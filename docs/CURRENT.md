# Current Documentation Index

> **Note:** The canonical documentation entry point is now
> [`docs/README.md`](README.md). This file is retained as a legacy pointer.
> Start at `docs/README.md`, not here and not in `docs/archive/`.

## Active Documents

| Document | Purpose | Authority |
|----------|---------|-----------|
| `docs/SPEC.md` | Product specification — invariants, domain model, architecture | ✅ Authoritative |
| `docs/phase-roadmap.md` | Phase 1/2/3/4 scope and status | ✅ Authoritative |
| `docs/code-quality.md` | Code quality rules, gates, AI coding rules | ✅ Authoritative |
| `docs/CURRENT.md` | This file — navigation index | — |

## Active Dev Documents (`docs/dev/`)

| Document | Purpose |
|----------|---------|
| `i18n-copy-policy.md` | i18n copy rules and gate documentation |
| `observability-contract.md` | Logging, audit, trace conventions |
| `redis-baseline.md` | Redis optional infrastructure baseline |
| `test-flakes.md` | Test flake register and improvement log |

## Historical closure evidence (`docs/evidence/`)

These are final closure / verification proofs. They record that a milestone
was reached; they are **not** active plans and must not be treated as current
implementation guidance.

| Document | Purpose |
|----------|---------|
| `docs/evidence/phase2-baseline.md` | Phase 2 implementation baseline (closure evidence) |
| `docs/evidence/phase2-closeout-report.md` | Phase 2 closeout report with i18n status |
| `docs/evidence/RBAC-M10-F-FINAL-VERIFICATION-1.md` | Pre-PR-197 M10-F closure (carries an INVALIDATION NOTICE — superseded by a pending post-PR-197 rerun) |
| `docs/evidence/RBAC-M10-FINISH-BASELINE-1.md` | RBAC M10 finish baseline |
| `docs/evidence/wave1-document-link-audit.md` | Wave 1 documentation link-audit evidence |

## Do NOT read

- `docs/archive/` — historical reference only, not current implementation guidance
- `docs/archive/dev/` — archived dev docs (test baselines, config, seed data)
- `docs/archive/phase1-archive/` — Phase 1 implementation docs
- `docs/archive/phase2-archive/` — Phase 2 implementation docs

If an archived doc conflicts with an active doc, the active doc wins.

## Quick Reference

```bash
# Start developing
pnpm dev

# Run tests
pnpm test

# Full verification
pnpm verify

# E2E tests
bash scripts/e2e/run-wsl.sh

# Check hardcoded copy gate
pnpm lint:copy
```
