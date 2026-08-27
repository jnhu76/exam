# Release process

Repository releases use Semantic Versioning tags (`vMAJOR.MINOR.PATCH`),
`.release-version` as the machine-readable release trigger, `CHANGELOG.md` as the
canonical chronological history, and `docs/releases/vMAJOR.MINOR.PATCH.md` as
the detailed release record.

A release is not just a tag. It is a traceable historical chapter that should
let a future maintainer answer:

1. Why did this release exist?
2. What user, product, correctness, deployment, or engineering problems did it
   solve?
3. Which GitHub issues were actually resolved by code contained in the release?
4. Which pull requests delivered those outcomes?
5. What important behavior changed?
6. What limitations remained at publication time?
7. What verification proved the release baseline?

## Release authorities

A release-preparation change must keep these three authorities aligned:

1. `.release-version` — exact repository release version.
2. `CHANGELOG.md` — concise Keep-a-Changelog history entry.
3. `docs/releases/vMAJOR.MINOR.PATCH.md` — detailed release notes.

The root `package.json` is private workspace metadata and is not automatically
the repository release authority.

## Standard release workflow

For each release:

1. Start from a clean, current `master` and fetch tags.
2. Identify the latest semantic version tag and record the exact range from that
   tag to current `master`.
3. Audit that range for merged PRs, resolved issues, migrations, product changes,
   deployment changes, test/infrastructure changes, and documentation changes.
4. Build issue/PR traceability from repository evidence; do not infer release
   membership from timestamps alone.
5. Choose the next version and update `.release-version` to
   `vMAJOR.MINOR.PATCH`.
6. Move relevant `CHANGELOG.md` entries from `Unreleased` into a dated version
   section for the same version.
7. Create `docs/releases/vMAJOR.MINOR.PATCH.md`, using
   `docs/releases/TEMPLATE.md` as the structure.
8. Open a focused release-preparation PR containing release metadata only.
9. Require normal repository checks and exact-head CI evidence.
10. Merge the release-preparation PR to `master`.
11. `.github/workflows/release.yml` validates the release authorities, creates
    an annotated tag on the exact merge commit, and creates the matching GitHub
    Release from the version-specific notes.
12. Verify that `.release-version`, changelog, tag, GitHub Release, and final
    `master` all describe the same commit and version.

The publisher is intentionally narrow: it runs only when `.release-version`
changes on `master`. A normal changelog or release-process edit does not publish
a release.

## Traceability contract

Release membership is determined by ancestry and implementation evidence, not by
calendar dates.

Preferred evidence chain:

```text
Issue / problem
    ↓
PR(s) implementing the resolution
    ↓
merge commit(s)
    ↓
merge commit is contained in previous-tag..release-head
    ↓
issue may be listed as resolved in this release
```

An issue MUST NOT be listed under `Issues resolved` merely because it was closed
between two release dates. It may have been closed as duplicate, wontfix,
documentation-only, superseded, or by work not contained in the release.

For each issue claimed as resolved, confirm that the release ancestry contains
the implementation that resolved it. Prefer explicit PR links, `Closes #NNN`
relationships, issue closeout comments, and merge ancestry.

A PR may appear in the release without closing an issue when it delivers a
meaningful refactor, infrastructure change, or operational improvement. Do not
invent an issue relationship that does not exist.

## Release-note structure

Detailed release notes should follow `docs/releases/TEMPLATE.md` and contain:

- `Why this release exists`
- `Problems solved`
- `Issues resolved`
- `Pull requests included`
- `Notable changes`
- `Verification`
- `Known limitations`
- `Upgrade notes`

`Why this release exists` should be written at the problem/outcome level.

Avoid commit-log prose such as:

```text
changed route.ts
updated test.ts
added migration
```

Prefer outcome prose such as:

```text
completed the manual grading workflow and made restart/deadline recovery
deterministic, closing two remaining gaps in the generic exam product loop.
```

`Known limitations` must not be omitted merely to make a release look cleaner.
If none are known, state that explicitly.

## Changelog contract

`CHANGELOG.md` stays concise. It should summarize notable changes under relevant
Keep-a-Changelog categories such as:

- Added
- Changed
- Fixed
- Removed
- Security

Reference issue or PR numbers when they materially improve traceability, but keep
the detailed causal story in the version-specific release notes.

For releases after `v0.0.1`, keep compare links truthful:

```text
[Unreleased]: .../compare/vX.Y.Z...HEAD
[X.Y.Z]: .../compare/vPREVIOUS...vX.Y.Z
```

## Verification contract

Before publishing, record exact release-head evidence appropriate to the delta.
At minimum, require the repository's normal verification and CI gates. Include
blocking E2E and deployment/recovery acceptance when the release changes those
surfaces.

Do not treat stale cache output or CI from an older head as release evidence.

If release validation discovers a product or correctness defect, stop the
release, fix it through a separate issue/PR, then restart release preparation.
Do not hide product fixes inside release metadata work.

## Tag and publication rules

- Never move or overwrite a published semantic version tag.
- Never publish a release from an unmerged feature branch; release authority is
  the exact `master` commit that changed `.release-version`.
- If a tag already exists on a different commit, publishing must fail rather
  than repair or move it.
- A failed GitHub Release-creation step may be rerun safely only when the
  existing tag resolves to the exact intended release commit.
- The release workflow also publishes the prebuilt image
  `ghcr.io/jnhu76/exam:vX.Y.Z` (+ `sha-<commit>`) from the exact release
  SHA (#321). On the FIRST image release, flip the GHCR package to Public
  (one-time, Package settings) and verify an anonymous
  `docker pull ghcr.io/jnhu76/exam:vX.Y.Z` succeeds — closeout must record
  the resulting digest and the anonymous-pull check result.
- Pre-1.0 releases may change quickly; breaking changes still belong in the
  changelog.

## Using a local AI maintainer

A maintainer may delegate release preparation to a local AI, but the AI must
follow this document as the repository contract. A sufficient instruction is:

```text
Prepare and publish the next Exam release according to docs/releasing.md.
Audit the previous semantic tag through current master, build issue/PR ancestry
traceability, update .release-version, CHANGELOG.md, and the version-specific
release notes, require exact-head verification, then let the repository release
workflow create the immutable tag and GitHub Release. Stop instead of publishing
if a new correctness blocker is found.
```

The AI should report at minimum:

- version and previous version;
- why the release exists;
- problems solved;
- issues resolved with evidence;
- important PRs included;
- known limitations and upgrade notes;
- exact release-head SHA and CI run;
- tag target SHA;
- GitHub Release publication result.
