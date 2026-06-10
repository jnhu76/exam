# Prompt: Build Review Context Pack

Use `bounded-review-context`.

Mode: build-review-context

Inputs:
- PR Boundary Doc: `docs/ai/pr-boundaries/<phase-or-job>.md`
- Review Profiles:
  - `docs/ai/review-profiles/<profile>.md`
- Job Card: `<path>`
- Base: `origin/main`
- Head: `HEAD`

Tasks:
1. Generate a Review Context Pack using `skills/bounded-review-context/templates/review-context-pack.md`.
2. Include only profile sections relevant to the current diff and boundary.
3. Include changed files and diff stat.
4. Require review findings to use:
   - `Fix now`
   - `Add test now`
   - `Defer issue`
   - `Investigate`
   - `Reject`
5. End with the handoff instruction:
   `Now use superpowers requesting-code-review with this Review Context Pack.`
6. The subsequent review must not use full conversation history.
7. The subsequent review must not expand beyond the PR Boundary Doc.
