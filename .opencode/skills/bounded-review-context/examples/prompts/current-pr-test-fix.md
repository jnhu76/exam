# Prompt: Fix Only Current PR Test Contract Gaps

Use the current PR Boundary Doc before making changes.

Allowed decision types to fix in this pass:

- `Add test now`

Forbidden:

- Do not fix `Defer issue` items.
- Do not perform SQL pushdown / N+1 / architecture refactor.
- Do not modify production code unless the test cannot compile due to a missing export or type.

Task:
1. Read `docs/ai/pr-boundaries/<phase-or-job>.md`.
2. Read `docs/ai/review-decisions/<phase-or-job>-review.md`.
3. Implement only `Add test now` items.
4. Run targeted tests.
5. Run full verification if available.
6. Report changed files and verification result.
