# Prompt: Init Bounded Review Context

Use `bounded-review-context`.

Mode: init

Target root: `docs/ai`

Tasks:
1. Verify templates exist under `skills/bounded-review-context/templates/`.
2. Create directories:
   - `docs/ai/pr-boundaries/`
   - `docs/ai/review-profiles/`
   - `docs/ai/review-decisions/`
   - `docs/ai/followup-jobs/`
3. Do not create `_template.md` under `docs/ai/*`.
4. Do not review code.
5. Do not modify business code.

Optional:
- If I provide starter profile names, instantiate them from `skills/bounded-review-context/templates/review-profiles/` into `docs/ai/review-profiles/`.
- If I provide a phase/job name, instantiate `skills/bounded-review-context/templates/pr-boundary.md` into `docs/ai/pr-boundaries/<phase-or-job>.md`.
