# Release process

Repository releases use Semantic Versioning tags (`vMAJOR.MINOR.PATCH`),
`.release-version` as the release trigger, and `CHANGELOG.md` as the canonical
human-readable release history.

For each release:

1. Start from a clean, current `master`.
2. Choose the next version and update `.release-version` to `vMAJOR.MINOR.PATCH`.
3. Move completed entries from `CHANGELOG.md`'s `Unreleased` section into a new
   dated version section for the same version.
4. Add or update `docs/releases/vMAJOR.MINOR.PATCH.md` with the GitHub Release
   notes.
5. Open a focused release-preparation PR and require the normal repository
   checks.
6. Merge the release-preparation PR to `master`.
7. `.github/workflows/release.yml` validates the three version authorities,
   creates an annotated tag on the exact merge commit, and creates the matching
   GitHub Release from the version-specific notes.
8. Verify the tag and GitHub Release both resolve to the intended `master`
   commit.

The publisher is intentionally narrow: it runs only when `.release-version`
changes on `master`. A normal changelog edit does not publish a release.

Rules:

- `.release-version`, the `CHANGELOG.md` version section, and
  `docs/releases/vMAJOR.MINOR.PATCH.md` must name the same version.
- Never move or overwrite a published version tag. If a tag already exists on a
  different commit, the workflow fails instead of repairing it.
- Never publish a release from an unmerged feature branch; release authority is
  the exact `master` commit that changed `.release-version`.
- A failed Release-creation step may be rerun safely: an existing tag is accepted
  only when it resolves to the exact release commit, and an existing GitHub
  Release is left unchanged.
- Pre-1.0 releases may change quickly; breaking changes still belong in the
  changelog.
