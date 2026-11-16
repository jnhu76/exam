# Commit Message Standard

Authority for commit message rules on this repository. The same rule set is
enforced at three gates — commit-msg hook, pre-push hook and the CI
`Commit messages` job — all reading one config: [`commitlint.config.mjs`](../../commitlint.config.mjs).
This document explains the rules and the workflows around them (merge,
revert, amend, autosquash); the config is the executable truth.

## Format

Every formal commit — human or AI agent authored, including merge commits —
must have a first line of:

```
type(scope): subject
```

| Rule | Value |
| --- | --- |
| `type` | one of the whitelist below, all lowercase |
| `scope` | required, matches `[a-z][a-z0-9-]*` |
| `subject` | non-empty; first line ≤ 72 characters |
| Breaking change | `type(scope)!: subject` and/or a `BREAKING CHANGE: …` footer |
| Body / footer | optional (issue refs, rationale, breaking change notes) |
| Language | Chinese or English subjects are both accepted; no natural-language case or imperative-mood checks are enforced |

### Types

| Type | Meaning |
| --- | --- |
| `feat` | new feature |
| `fix` | defect fix |
| `refactor` | behavior-preserving code restructuring |
| `perf` | performance improvement |
| `docs` | documentation |
| `test` | tests |
| `build` | build system and dependencies |
| `ci` | CI/CD |
| `chore` | engineering maintenance |
| `style` | format-only changes with no logic impact |
| `revert` | reverting a commit |

Ad-hoc types such as `wip`, `update` or `misc` are rejected. Work that is not
finished is not pushed — or is pushed on a branch with a still-conforming
subject.

### Examples

Valid:

- `feat(exam): support timed exam recovery`
- `fix(otel): correct telemetry configuration`
- `docs(api): clarify error response contract`
- `chore(merge): integrate reviewed W6 changes into W7`
- `ci(github): enforce commit message policy`

Invalid:

- `Merge branch 'otel/w6' into otel/w7` (merge commits are not exempt)
- `Update files`, `fix some bugs` (no type)
- `feat: add recovery` (scope missing)
- `Feat(exam): add recovery` (type case)
- `chore(): update tools` (empty scope)

### Scope guidance (non-normative)

The scope charset is free-form; for consistency prefer these canonical
scopes — workspace packages and governance areas:

`api` `web` `db` `domain` `contracts` `auth` `authz` `engine` `import-export`
`e2e` `otel` `deploy` `ci` `github` `docs` `merge` `exam`

## Enforcement

| Gate | What it checks | Notes |
| --- | --- | --- |
| `.husky/commit-msg` (commitlint) | the message being committed | fixup!/squash! tolerated locally |
| `.husky/pre-push` (`scripts/check-commit-messages.mjs`) | every commit new to the remote | rejects fixup!/squash!; skips CI-only integration merges |
| CI job `Commit messages` | PR title + every commit the PR introduces | runs on PR open/sync/title-edit/reopen, all target branches |

The pre-push gate computes "new to the remote" as commits reachable from the
pushed tips but from no pre-push remote tip (pushed refs' remote SHAs plus
remote-tracking refs), so history already on the server — including legacy
non-conforming commits — is never re-validated.

Manual checks:

```bash
node scripts/check-commit-messages.mjs --title "feat(api): planned subject" # agent pre-flight
node scripts/check-commit-messages.mjs --range origin/master..HEAD          # local branch audit
pnpm test:commit-messages                                                  # gate self-tests
```

Failure output is designed to be self-correcting (rule name, required shape,
fix command), so an agent or developer blocked at any gate can converge in
one iteration. Gates reject; they never rewrite messages.

## Merge commits

Merge commits are formal commits and must conform (`chore(merge): …` is the
usual type). Git's default merge subjects never conform, so:

- merge with an explicit message:
  `git merge --no-ff -m "chore(merge): integrate reviewed W6 changes into W7" <branch>`
- prefer `git pull --rebase` for plain updates.

**Integration-merge exemption (topology, not message shape):** a merge whose
one parent side is already on the remote (pre-push) or outside the PR's commit
set (CI) only re-introduces already-validated commits; its tool-generated
message ("Merge master into otel/w7 for integration CI") is exempt. A sibling
merge — both sides new, e.g. merging one feature branch into another before
either lands — introduces new commits and must carry a conforming subject.

GitHub's own merge commits are governed by repository settings (see
"Owner settings" in the PR that introduced this document), not by these
hooks — with `Merge commit title = Pull request title`, a conforming PR
title produces a conforming merge commit.

## Revert

Use the `revert` type with a subject, and reference the reverted commit in
the body:

```bash
git revert --no-commit <sha>
git commit -m "revert(deploy): remove the observability stack" -m "Reverts <sha>."
```

Git's default `Revert "…"` subject does not conform and will be rejected;
edit it (`git revert -e`) or use `--no-commit` as above.

## Amend and autosquash

- `git commit --amend` re-runs the commit-msg hook; the amended message must
  still conform.
- `git commit --fixup <sha>` / `--squash <sha>` create `fixup! …` / `squash! …`
  messages. They are **tolerated locally** (the commit-msg hook accepts them)
  but **rejected at push and in CI**. Fold them before pushing:

  ```bash
  git rebase -i --autosquash <upstream>
  ```

## AI agent workflow

Agents committing to this repository follow the same contract. Recommended
loop: draft `type(scope): subject` using the type table and scope guidance
above, pre-flight with `--title`, commit, and let the gates confirm. A
rejected message prints the violated rule and the exact fix command — apply
it directly instead of inventing a new format.
