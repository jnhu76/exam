# Blockers

## B001: Bun runtime not installed

**Date**: 2026-06-01
**Job**: J0 Infrastructure Setup
**Status**: RESOLVED

**Problem**: `bun` command not found.

**Resolution**: Bun installed at `$HOME/.bun/bin/bun` v1.3.14. `bun install` succeeded with proxy (npmmirror had missing packages for React 19 deps; used proxy to official npm registry).

**Note**: Tech stack has since been changed to Node.js LTS + Fastify + pnpm (see SPEC.md §5). This blocker is no longer relevant — Bun is not used.

---

## B002: npmmirror missing scheduler@^0.27.0

**Date**: 2026-06-01
**Job**: J0 Infrastructure Setup
**Status**: RESOLVED

**Problem**: `bun install` with npmmirror registry failed — `scheduler@^0.27.0` (React 19 dependency) not available on mirror.

**Resolution**: Configured proxy (`http://127.0.0.1:7897`) to access official npm registry. Install succeeded.

**Note**: With migration to pnpm + Fastify, dependency management will change. This blocker is no longer relevant.

---

## Active Blockers

None.
