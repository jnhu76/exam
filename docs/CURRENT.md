# Current Documentation Index

> Entry point for developers and AI agents. Start here, not in `docs/archive/`.

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
| `phase2-baseline.md` | Phase 2 implementation baseline |
| `phase2-closeout-report.md` | Phase 2 closeout report with i18n status |
| `i18n-copy-policy.md` | i18n copy rules and gate documentation |
| `observability-convention.md` | Logging, audit, trace conventions |
| `redis-baseline.md` | Redis optional infrastructure baseline |

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
