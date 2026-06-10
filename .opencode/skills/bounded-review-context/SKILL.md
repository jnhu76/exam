---
name: bounded-review-context
description: 维护 PR Boundary Doc 与 Review Profiles，并为 superpowers 的 requesting-code-review 生成有边界的 Review Context Pack。
---

# Bounded Review Context

## Purpose

This skill does **not** review code and does **not** fix code directly.

It maintains the context files that make code review bounded and useful:

1. Create or update the current PR Boundary Doc.
2. Create or update project Review Profiles.
3. Generate a Review Context Pack from the boundary, profiles, job card, and diff.
4. Hand that context pack to superpowers' existing `requesting-code-review` skill.
5. Keep review findings from expanding the current PR beyond its intended scope.

## Core Model

```text
bounded-review-context
  -> maintains docs/ai/pr-boundaries/*.md
  -> maintains docs/ai/review-profiles/*.md
  -> builds Review Context Pack
  -> hands off to requesting-code-review
  -> receiving-code-review handles feedback triage
```

The templates live inside this skill:

```text
skills/bounded-review-context/templates/
  pr-boundary.md
  review-profile.md
  review-decision.md
  followup-job.md
  review-context-pack.md
  review-profiles/
    backend-db-async.md
    api-auth-tenant.md
    state-machine.md
    frontend-ui-state.md
```

The generated project documents live in the target project location, normally:

```text
docs/ai/
  pr-boundaries/<phase-or-job>.md
  review-profiles/<profile>.md
  review-decisions/<phase-or-job>-review.md
  followup-jobs/<followup-job>.md
```

## Important Distinction

- Files under `skills/bounded-review-context/templates/` are reusable templates and starter profiles.
- Files under `docs/ai/pr-boundaries/*.md` are generated per PR / phase job.
- Files under `docs/ai/review-profiles/*.md` are project-specific risk profiles maintained over time.

Do not store `_template.md` files under `docs/ai/*` by default. The skill folder is the source of templates.

## Modes

### Mode 1: init

Use this when the project does not yet have bounded review context directories.

Inputs:

- Target root, default: `docs/ai`
- Optional starter profiles to instantiate, default: none
- Optional current job / phase name, if the user wants an initial boundary created immediately

Behavior:

1. Verify that templates exist under `skills/bounded-review-context/templates/`.
2. Create target directories only:

   ```text
   docs/ai/pr-boundaries/
   docs/ai/review-profiles/
   docs/ai/review-decisions/
   docs/ai/followup-jobs/
   ```

3. Do **not** create `_template.md` files under `docs/ai/*`.
4. If the user requests starter profiles, instantiate selected templates from:

   ```text
   skills/bounded-review-context/templates/review-profiles/*.md
   ```

   into:

   ```text
   docs/ai/review-profiles/*.md
   ```

5. If the user provides a phase/job name, instantiate:

   ```text
   skills/bounded-review-context/templates/pr-boundary.md
   ```

   into:

   ```text
   docs/ai/pr-boundaries/<phase-or-job>.md
   ```

6. Fill generated files from current job card / PR description / diff when available.
7. Leave placeholder markers only when the required information is not available.
8. Do not review code.
9. Do not modify business code.

Output:

- Created directories.
- Generated boundary/profile files, if any.
- Missing information that should be filled later.
- Next command to build a Review Context Pack.

### Mode 2: create-boundary

Use this to create one PR Boundary Doc for one phase/job/PR.

Inputs:

- Boundary output path, for example:

  ```text
  docs/ai/pr-boundaries/phase1.4-a02.md
  ```

- Job Card path or pasted job card.
- PR description, if available.
- Branch name.
- Base branch or base SHA.
- `git diff --stat`.
- `git diff --name-only`.
- Optional selected review profiles.

Behavior:

1. Read `skills/bounded-review-context/templates/pr-boundary.md`.
2. Create the requested boundary file at the user-specified path.
3. Treat one phase job as one boundary document.
4. Infer the smallest safe boundary from the job card and diff.
5. Explicitly separate:
   - Primary Goal
   - In Scope
   - Out of Scope
   - Allowed Files
   - Forbidden Expansion
   - Required Review Profiles
   - Risk Checklist
   - Merge Gate
6. Do not include future improvement ideas in the boundary unless they constrain the current PR.
7. If the diff contains files that do not fit the job card, mark them as `Boundary Drift` instead of silently expanding the boundary.

### Mode 3: update-boundary

Use this when the PR changed after the boundary was created.

Inputs:

- Existing PR Boundary Doc.
- Latest `git diff --stat`.
- Latest `git diff --name-only`.
- Current job card / PR description.

Behavior:

1. Check whether changed files still fit `Allowed Files` and `In Scope`.
2. Check whether any changes violate `Out of Scope` or `Forbidden Expansion`.
3. Update the boundary only when the job scope legitimately changed.
4. If changes look accidental, output `Boundary Drift Detected` and recommend reverting or splitting the PR.
5. Do not broaden the PR just to satisfy review comments.

### Mode 4: create-or-update-profile

Use this to maintain project Review Profiles.

Inputs:

- Profile output path, for example:

  ```text
  docs/ai/review-profiles/backend-db-async.md
  ```

- Existing profile, if any.
- Confirmed review findings.
- Project architecture facts.
- Repeated failure patterns.

Behavior:

1. If creating a new profile, start from:

   ```text
   skills/bounded-review-context/templates/review-profile.md
   ```

2. If there is a matching starter profile under:

   ```text
   skills/bounded-review-context/templates/review-profiles/
   ```

   use it as the seed.
3. Record long-lived project risk patterns only.
4. Do not record one-off tasks, temporary PR details, or unverified review findings.
5. Do not turn false positives into permanent rules.
6. Keep profiles short enough to be usable in review context.

### Mode 5: absorb-review-findings

Use this after CodeRabbit, AI reviewer, or human reviewer comments arrive.

Inputs:

- Review comments.
- Current PR Boundary Doc.
- Relevant Review Profiles.
- Current diff, if needed.

Behavior:

1. Classify each finding as:
   - `Fix now`
   - `Add test now`
   - `Defer issue`
   - `Investigate`
   - `Reject`
2. Current PR specific findings go to `docs/ai/review-decisions/<job>-review.md`.
3. Long-lived confirmed risk patterns go to relevant `docs/ai/review-profiles/*.md`.
4. Follow-up work goes to `docs/ai/followup-jobs/*.md`.
5. False positives are documented only in review decisions, not in profiles.
6. Do not modify production code.

### Mode 6: build-review-context

Use this before invoking superpowers `requesting-code-review`.

Inputs:

- Current PR Boundary Doc.
- Relevant Review Profiles.
- Job Card.
- `git diff --stat`.
- `git diff --name-only`.
- Current validation summary.
- Existing review comments, if any.

Behavior:

1. Read `skills/bounded-review-context/templates/review-context-pack.md`.
2. Generate a Review Context Pack.
3. Include only profile sections relevant to the current diff and boundary.
4. Explicitly state forbidden review expansion.
5. Require reviewer output to include:

   | 文件/位置 | 问题 | 严重程度 | 当前 PR 引入？ | 是否 blocking | 处理决策 | 最小修复 |
   |---|---|---|---|---|---|

6. Require decisions to use only:
   - `Fix now`
   - `Add test now`
   - `Defer issue`
   - `Investigate`
   - `Reject`
7. End with a handoff instruction:

   ```text
   Now use superpowers requesting-code-review with this Review Context Pack.
   Do not use the full conversation history as review context.
   Do not expand beyond the PR Boundary Doc.
   ```

## Review Decision Rules

Always include these rules in generated Review Context Packs:

- Current PR introduced correctness / security / data integrity bug -> `Fix now`
- Current PR introduced behavior or error contract without tests -> `Add test now`
- Real issue outside current PR boundary -> `Defer issue`
- Insufficient evidence -> `Investigate`
- False positive, over-classified, or not applicable -> `Reject`

## Scope Discipline

The boundary is stronger than the reviewer's curiosity.

Reviewer may identify follow-up issues, but fixing agent must not expand the current PR unless the finding is `Fix now` or `Add test now` under the current boundary.

## Forbidden Behavior

This skill must not:

- Directly review code.
- Directly fix code.
- Create `_template.md` files under `docs/ai/*` by default.
- Start an unbounded review without a boundary.
- Treat historical debt as a current PR blocker.
- Copy all review profiles into a review context pack.
- Add one-off PR tasks to long-lived review profiles.
- Store false positives in review profiles.
- Use the full conversation history as review context.
