# Release process

Repository releases use Semantic Versioning tags (`vMAJOR.MINOR.PATCH`) and
`CHANGELOG.md` as the human-readable release history.

For each release:

1. Start from a clean, current `master`.
2. Move completed entries from `CHANGELOG.md`'s `Unreleased` section into a new
   dated version section.
3. Open a focused release-preparation PR and require normal repository checks.
4. Merge the release-preparation PR.
5. Create the version tag from the exact resulting `master` commit.
6. Create the GitHub Release from the same tag, using the changelog section as
   the release-note authority.
7. Verify the tag and GitHub Release both resolve to the intended commit.

Rules:

- Never move or overwrite a published version tag.
- Never publish a release from a dirty or unmerged feature branch.
- `CHANGELOG.md`, the tag, and the GitHub Release must describe the same code
  baseline.
- Pre-1.0 releases may change quickly; breaking changes still belong in the
  changelog.
