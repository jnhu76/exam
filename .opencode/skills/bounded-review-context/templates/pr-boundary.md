# PR Boundary: <phase-or-job-name>

## 1. Identity

- Phase / Job: `<phase-or-job-name>`
- Branch: `<branch>`
- Base: `<base-branch-or-sha>`
- Status: `draft | review | ready | merged`

## 2. Primary Goal

This PR only solves:

- `<goal 1>`
- `<goal 2>`

One-line boundary:

> This PR is `<what this PR is>`, not `<what this PR is not>`.

## 3. In Scope

Allowed files / directories:

```text
<path>
<path>
```

Allowed changes:

- `<allowed behavior change>`
- `<allowed test>`
- `<allowed local refactor>`

## 4. Out of Scope

This PR must not handle:

- `<forbidden performance work>`
- `<forbidden architecture change>`
- `<forbidden unrelated cleanup>`
- `<forbidden documentation expansion>`

Unless the issue is a correctness / security / data integrity bug directly introduced by this PR, it must become a follow-up job instead of being fixed here.

## 5. Forbidden Expansion

Reviewer and fixing agent must not expand this PR into:

- historical performance debt;
- global architecture refactor;
- Redis / multi-instance deployment migration;
- broad SQL pushdown rewrite;
- audit durability redesign;
- unrelated lint / format / rename;
- non-essential lockfile changes.

## 6. Required Review Profiles

Required:

- `docs/ai/review-profiles/<profile>.md`

Optional:

- `docs/ai/review-profiles/<profile>.md`

## 7. Risk Checklist

This PR touches:

- [ ] repository nullable return
- [ ] async / Promise / fire-and-forget
- [ ] SQLite / PostgreSQL dual dialect
- [ ] auth / permission / tenant context
- [ ] audit / background job
- [ ] query scale / N+1
- [ ] state machine transition
- [ ] import / batch data
- [ ] frontend stale state / UI race
- [ ] test contract

## 8. Review Decision Rules

Every review finding must be classified as one of:

| Decision | Meaning | Current PR Action |
|---|---|---|
| `Fix now` | Correctness / security / data integrity issue introduced by this PR | Must fix |
| `Add test now` | New behavior or error contract introduced by this PR lacks tests | Must add tests |
| `Defer issue` | Real issue, but outside current PR scope | Create follow-up job |
| `Investigate` | Insufficient evidence | Do not make large changes |
| `Reject` | False positive, over-classified, or not applicable | Explain why |

## 9. Merge Gate

Before merge:

- [ ] `Fix now` findings are fixed.
- [ ] `Add test now` findings have tests.
- [ ] `Defer issue` findings are recorded as follow-up jobs.
- [ ] `Reject` findings have clear technical reasons.
- [ ] Verification commands pass.
- [ ] Diff does not drift beyond this boundary.
- [ ] No review comment expanded this PR beyond its boundary.

## 10. Verification Commands

Full verification:

```bash
<project verify command>
```

Targeted verification:

```bash
<targeted test command>
```

## 11. Notes

- `<additional context>`
