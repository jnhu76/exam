# Versioning baseline

The repository begins formal GitHub Releases at `v0.0.1`.

This version number is the repository release identifier. The root workspace is
private, so its historical `package.json` version is not used as the published
release authority. Future work may align package metadata separately if the
workspace is ever published as packages.

From `v0.0.1` onward:

- repository versions use `vMAJOR.MINOR.PATCH` tags;
- `CHANGELOG.md` is updated before the tag is created;
- GitHub Releases use the matching tag and changelog entry;
- tags are immutable once published.
