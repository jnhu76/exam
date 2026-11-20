---
name: code-review
description: Review TypeScript, TSX, and related JavaScript in the Exam monorepo for correctness, simplicity, type safety, contract compliance, and maintainability. Use for PR reviews, scoped code audits, or explicitly authorized refactors.
---

# Exam Code Review

Review or improve Exam code using the principles in [coding-style.md](coding-style.md). This skill adapts the useful parts of [SGLang-Omni's coding-style guide](https://github.com/sgl-project/sglang-omni/blob/main/.claude/skills/code-review/coding-style.md) for TypeScript; **it is not an independent policy source**.

## Source of truth

1. Read the repository root `AGENTS.md` first, including authorization, information-authority routing, change scope, and database safety.
2. Read the task-relevant parts of `docs/standards/code-quality.md`, especially §2–6 (real gates/types/architecture), §7–10 (repository/routes/errors/logging), §13.5 (tests), §16 (review checklist), and §17 (AI changes/reporting). This file is the **code-quality authority**.
3. Where relevant, consult `docs/standards/testing.md`, Accepted ADRs, `docs/architecture/exam-semantic-boundaries.md`, contracts, and the authorized OPEN Issue. Load only sections needed for the task.
4. The current code and runnable tests establish as-built behavior, but do not supersede contracts. If evidence and authority disagree, report the discrepancy; do not select the convenient version.
5. If any heuristic in `coding-style.md` conflicts with a higher-authority rule, **follow the authority** and flag the conflict. Never copy this skill into a second, competing project policy.

## Use cases

- Read-only PR review: inspect diff, behavior, test evidence, risks, and code quality.
- Focused code audit: identify unnecessary abstraction, hidden complexity, incorrect typing, unsafe async/transaction handling, or weak tests.
- Explicitly authorized refactor: preserve behavior, implement the smallest correction, and verify at the right layer.

**Invoking the skill does not authorize edits.** Follow `AGENTS.md` mode/permission rules. Never merge, force-push, release, or run destructive resource operations without the required current human gate.

## Review procedure

1. **Establish baseline**: record repo, base/head commits, branch/worktree state when available, authorized scope, affected modules, and relevant contracts. Compare with current master; do not trust stale Issue narratives.
2. **Trace the actual behavior**: input/schema -> authorization -> domain command -> repository/transaction -> API response, or UI event -> state/effect -> request -> rendered outcome. Identify the owner of each invariant.
3. **Review correctness before aesthetics**: tenant boundaries, domain state machine, idempotency/version conflicts, server time, frozen snapshots, error and log privacy, resource/Promise lifecycle, and type narrowing.
4. **Apply the TypeScript heuristics** in [coding-style.md](coding-style.md). Separate verified defects from readability suggestions. Do not demand arbitrary extraction, naming churn, or all-branches-have-else style.
5. **Ground each finding**: exact file/line or code span, evidence or reproducible counterexample, affected contract, consequence, and smallest repair. Identify which test would turn red before the fix.
6. **Check only real gates**: distinguish `docs/standards/code-quality.md` classifications (A enforceable, B partial, C human review, D not implemented). Do not claim `no-explicit-any`, `no-floating-promises`, `import/no-cycle`, or whole-repo ESLint are enforced when they are not.
7. **If changes were authorized**, work within the Issue scope, prefer failing regression/characterization before a fix, preserve unrelated files, and run the relevant existing `package.json` scripts. Follow `docs/standards/testing.md` resource ownership when running DB/E2E workflows.
8. **Report honestly**: do not equate CI green with architectural correctness or claim that an unexecuted command passed.

## Output contract

- **Baseline / scope**: refs, code examined, contracts used.
- **Findings**: prioritized P0/P1/P2 (and optional P3), each with location, evidence, impact, and minimal fix. No speculative style-only noise.
- **Verified non-findings / trade-offs**: noteworthy examined cases that are safe, if material.
- **Validation**: exact executed commands and results; `NOT_RUN` / `NOT_APPLICABLE` with reasons, including real DB/browser evidence when relevant.
- **Decision**: `GO`, `HOLD`, or `INCONCLUSIVE` with residual risks.

For an implementation job, also deliver the **five fields in `docs/standards/code-quality.md` §17**; do not substitute this format for that requirement. Review is not approval to merge.

## Invocation examples

- "Use the Exam code-review skill to review PR #123 against current master and `docs/standards/code-quality.md`. Audit only; do not edit."
- "Use this skill to assess `apps/api/src/...` for async lifecycle, repository, and transaction issues; provide evidence and the minimal repair."
- "Under Issue #123, use the Exam code-review skill to make the smallest authorized refactor, with regression evidence and relevant quality gates."
