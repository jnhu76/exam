# Prompt: Create Boundary for One Phase Job

Use `bounded-review-context`.

Mode: create-boundary

Template:
- `skills/bounded-review-context/templates/pr-boundary.md`

Output:
- `docs/ai/pr-boundaries/<phase-or-job>.md`

Inputs:
- Job Card: `<path>`
- Branch: `<branch>`
- Base: `origin/main`
- Head: `HEAD`

Tasks:
1. Read the job card and current diff.
2. Run or inspect:
   - `git diff --stat origin/main...HEAD`
   - `git diff --name-only origin/main...HEAD`
3. Instantiate the boundary template into the output path.
4. Treat this phase/job as one boundary document.
5. Fill Primary Goal, In Scope, Out of Scope, Allowed Files, Required Review Profiles, Risk Checklist, and Merge Gate.
6. If changed files do not fit the job, mark `Boundary Drift` instead of silently expanding the boundary.
7. Do not review code.
8. Do not fix code.
