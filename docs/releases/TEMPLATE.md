# Exam vX.Y.Z

## Why this release exists

Describe the release at the problem/outcome level. Explain why this version is worth publishing instead of listing files or commits.

## Problems solved

- Describe each meaningful product, correctness, deployment, or engineering problem that was solved.

## Issues resolved

- #NNN — issue title — one-line outcome.

Only list an issue as resolved when the release ancestry contains the implementation that resolved it. Do not infer release membership from close date alone.

## Pull requests included

- #NNN — PR title — which problem or outcome it delivered.

Preserve many-to-one and one-to-many relationships when an issue required multiple PRs or a PR delivered several related outcomes.

## Notable changes

### Added

- ...

### Changed

- ...

### Fixed

- ...

### Removed

- ...

### Security

- ...

### Deployment / operations

- ...

### Internal / infrastructure

- ...

Delete empty categories in the final release notes.

## Verification

Record the exact release-head evidence, for example:

- `pnpm verify`
- exact-head CI run
- blocking E2E shards
- deployment/recovery acceptance where relevant

## Known limitations

- Record known limitations honestly. If none are known, say so explicitly.

## Upgrade notes

State migrations, configuration changes, restart requirements, or compatibility notes. If no special action is required, write:

No special upgrade action is required.
