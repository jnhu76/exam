# Wave 1 Documentation Link Audit

> Reference-integrity audit for the Wave 1 documentation reorganization.
> Produced during Project-Simplification-Wave-1-Corrective-1.

```text
STATUS:          EVIDENCE (closure proof)
AUTHORITY:        — (audit record)
SCOPE:            Relative-link and path-reference integrity across active docs
OWNER:            Architecture
BASELINE SYSTEM COMMIT:
                 e7af792815e8cf4bcff122a3d1d8db500b9d6eff (PR #197)
LAST VERIFIED REPOSITORY COMMIT:
                 c0dde8f1c11d05e78cf9dfb871afd3bbdee6daa2
SUPERSEDES:       —
RELATED:          docs/status/project-simplification.md
```

## Method

1. Built the rename/move inventory with
   `git diff --summary --find-renames e7af792..HEAD -- docs/` (114 entries).
2. Searched active (non-archive) markdown for the moved path prefixes:
   `docs/(audit|followups|phase3/rbac|phase3/audit|phase3/emails|frontend-rollouts)/`.
3. Ran a programmatic relative-link checker over every active `.md` file
   (all of `docs/` except `docs/archive/`). The checker resolves each
   `[label](relative-path)` and `[label](#anchor)` target; absolute URLs
   (`http(s):`, `mailto:`) are excluded.
4. Checked non-markdown active surfaces: `AGENTS.md`, `docs/CURRENT.md`, ADR
   files, `scripts/`, `package.json`, `.github/workflows/*`,
   `.github/pull_request_template.md`, and production source comments.

## Results

```text
files checked:                              42 active markdown files
relative links checked:                     11 (absolute URLs excluded)
broken links found:                         1 real broken reference
broken links fixed:                         1
remaining archive-only broken links:        6 historical references in 1 evidence file
                                            + 11 stale comment-citations across 10 source files
final verdict:                              PASS — no unexplained active broken link remains
```

## Broken reference found and fixed

| File | Stale target | Fix |
|------|--------------|-----|
| `docs/adr/ADR-009-frontend-state-machine-adoption.md:11` | `docs/phase3/architecture/frontend-state-machine-audit.md` | Updated to `docs/archive/phase3-plans/architecture/frontend-state-machine-audit.md` (the file's actual post-reorganization location). |

This was the only broken relative reference in an active markdown file. It was
a backtick-quoted path (not a rendered link), corrected to the archive path.

## Remaining archive-only / historical references (explained, not defects)

These reference paths that were valid when the referencing document was
written and that now resolve under `docs/archive/` (the files still exist).
They are intentionally **not rewritten** because they live in frozen
historical evidence or in production-source comments, and rewriting them
would either falsify history or churn production source outside the
corrective's scope.

### Historical evidence file (6 references, 1 file)

`docs/evidence/RBAC-M10-F-FINAL-VERIFICATION-1.md` carries 6 internal
references to the pre-reorganization paths
(`docs/phase3/rbac/RBAC-M10-*`, `docs/phase3/rbac/RBAC-JOB-QUEUE.md`, etc.).
This file is a **frozen pre-PR-197 closure report** and now carries an
INVALIDATION NOTICE at its top stating it is superseded by a pending
post-PR-197 rerun. Rewriting its internal pointers would falsify the
historical record; the correct treatment is the invalidation header, which
is in place.

### Production-source comment citations (11 references, 10 files)

Comment-level citations to historical design docs that still exist under
`docs/archive/`:

- `apps/e2e/lib/seed.ts:29` → `docs/phase3/exam-protocol.md` (now archive)
- `apps/api/src/routes/attempts/redis-fallback-guard.test.ts:13` → `docs/phase3/audit/audit-redis-fallback-guard-m7.md`
- `apps/api/src/routes/attempts/deadline-scanner.test.ts:602` → `docs/phase3/exam-protocol.md`
- `apps/api/src/plugins/authz.ts:10` → `docs/phase3/rbac/adr-scoped-rbac-architecture.md`
- `apps/api/src/authz/scopedCapability.ts:24` → `docs/phase3/rbac/adr-scoped-rbac-architecture.md`
- `apps/api/src/config/runtimeConfig.ts:130` → `docs/phase3/jobs/email.md`
- `apps/api/src/config/runtimeConfig.ts:439` → `docs/phase3/emails/email-config.md`
- `packages/exam-engine/src/deadlineReconciliation.ts:146` → `docs/phase3/exam-protocol.md`
- `packages/exam-engine/src/lockSeam.ts:14` → `docs/audit/p3-formal-p0-d1-lock-seam-design.md`
- `packages/authz/src/catalog.ts:4` → `docs/phase3/rbac/adr-scoped-rbac-architecture.md`
- `packages/authz/src/resolver.ts:4` → `docs/phase3/rbac/adr-scoped-rbac-architecture.md`

These are **comment citations**, not active documentation links or rendered
markdown. The cited files still exist (relocated to `docs/archive/`). They do
not break any build, test, or rendered document. Per `AGENTS.md` ("No comments
in code unless asked") they are pre-existing; updating all of them is a
mechanical production-source churn that is out of scope for a Wave 1 docs +
targeted-test corrective. They are recorded here as a known follow-up for a
future comment-hygiene pass, **not** as unexplained active broken links.

## Surfaces verified clean

- `AGENTS.md` — its `docs/ui/*` references are pre-existing and already
  explicitly annotated as historical/archive (lines 336, 468). Not a Wave 1
  defect; not modified.
- `docs/CURRENT.md` — clean (redirects to `docs/README.md`).
- `docs/README.md` and the 7 other new current-authority docs — all internal
  references resolve.
- `scripts/`, `package.json` — no doc-path references.
- `.github/workflows/{ci,ai-code-review}.yml`, `.github/pull_request_template.md`
  — no doc-path references.

## Verdict

```text
final verdict: PASS
```

No unexplained active broken link remains. The single real broken reference
(ADR-009) was fixed. All remaining stale path references are either (a) inside
a frozen historical evidence file that carries an invalidation header, or
(b) production-source comment citations to files that still exist under
`docs/archive/`. Both categories are documented above and are not active
documentation defects.
