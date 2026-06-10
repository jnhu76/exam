# Prompt: Absorb Review Findings

Use `bounded-review-context`.

Mode: absorb-review-findings

Inputs:
- Review comments: `<paste or path>`
- Boundary: `docs/ai/pr-boundaries/<phase-or-job>.md`
- Relevant profiles:
  - `docs/ai/review-profiles/<profile>.md`

Tasks:
1. Classify every finding as:
   - `Fix now`
   - `Add test now`
   - `Defer issue`
   - `Investigate`
   - `Reject`
2. Current PR specific findings go to `docs/ai/review-decisions/<phase-or-job>-review.md`.
3. Long-lived confirmed risk patterns update the relevant review profile.
4. Deferred work becomes `docs/ai/followup-jobs/*.md`.
5. False positives do not update review profiles.
6. Do not modify production code.
