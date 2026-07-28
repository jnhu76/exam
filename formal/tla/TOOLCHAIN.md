# TLA+ Toolchain Pin

This document records the exact TLA+ toolchain used to produce the
model-checking evidence in `docs/audits/REC-F1-RECOVERY-PROTOCOL-FORMAL-MODEL.md`.
It is reproducibility evidence, not installation prose.

## Pinned version

| Field | Value |
|---|---|
| TLA+ release name | The Xenophanes release |
| TLA+ release tag | `v1.7.4` |
| Release date | 2024-08-05 (published), 2024-08-08 (assets uploaded) |
| TLC version string | `TLC2 Version 2.19 of 08 August 2024 (rev: 5a47802)` |
| Asset | `tla2tools.jar` |
| Asset size | 2,274,532 bytes |

The newest tag at time of pin is `v1.8.0`, marked **Pre-release** on the
official releases page. Per the REC-F1 prompt ("Choose the latest stable
release, not a pre-release"), `v1.7.4` is the pinned stable version.

## Official release source

```text
https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4
https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
```

Repository: [`tlaplus/tlaplus`](https://github.com/tlaplus/tlaplus)
(official TLA+ tools and Toolbox repository).

## Required Java version

The TLA+ tools require a Java 8 (or later) JVM. The local verification
below used OpenJDK 25; TLA+ v1.7.4 is known to run on Java 8 through 25.

```text
openjdk version "25.0.3" 2026-04-21
OpenJDK Runtime Environment (build 25.0.3+9-2-26.04.2-Ubuntu)
OpenJDK 64-Bit Server VM (build 25.0.3+9-2-26.04.2-Ubuntu, mixed mode, sharing)
```

## Published checksum

The official v1.7.4 release page publishes a **SHA-1** checksum for
`tla2tools.jar`. It does **not** publish a SHA-256.

```text
published sha1: bee4a54f3ee3d4afc347c3240ec2d9e93b075104
```

This SHA-1 is the only publisher-authenticated checksum available for this
asset. It is treated as the binding integrity check.

## Locally verified checksum

Computed locally against the downloaded asset on the verification date.

```text
local sha1:   bee4a54f3ee3d4afc347c3240ec2d9e93b075104   (matches published)
local sha256: 936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
```

The SHA-256 is **locally computed for traceability only**. It is not
publisher-authenticated because the official release does not publish one.
Do not represent it as a publisher value.

## Verification date

```text
2026-07-27
```

## Commands used to print/check the TLC version

```bash
# Print the TLC version banner (TLC prints it on every invocation):
java -cp "$TLA2TOOLS_JAR" tlc2.TLC -help 2>&1 | head -5
# Expected first line:
#   TLC2 Version 2.19 of 08 August 2024 (rev: 5a47802)

# Print the full option list (confirms -config/-metadir/-workers/-deadlock/-cleanup):
java -cp "$TLA2TOOLS_JAR" tlc2.TLC -help

# Verify the SHA-1 against the published value:
sha1sum "$TLA2TOOLS_JAR"
# Expected: bee4a54f3ee3d4afc347c3240ec2d9e93b075104

# Compute the local SHA-256 (traceability only — not publisher-authenticated):
sha256sum "$TLA2TOOLS_JAR"
# Expected: 936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
```

Note: TLC v2.19 does **not** accept `-version` as a stand-alone option
(it reports `unrecognized option: -version`). The version banner is
printed on every TLC invocation and via `-help`.

## Obtaining the JAR (for a fresh environment)

The committed repository does not vendor the JAR. A reviewer or CI
environment obtains it from the official release:

```bash
# From the official release page (no proxy needed on a network with
# GitHub access):
curl -L -o tla2tools.jar \
  https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
sha1sum tla2tools.jar
# bee4a54f3ee3d4afc347c3240ec2d9e93b075104

# Then point the runner at it:
export TLA2TOOLS_JAR="$(pwd)/tla2tools.jar"
pnpm formal:recovery:safety
```

Suggested cache locations (all git-ignored, never committed):

```text
$XDG_CACHE_HOME/exam/tla/tla2tools.jar
~/.cache/exam/tla/tla2tools.jar
formal/.work/toolchain/tla2tools.jar   (git-ignored under formal/.work/)
```

## Official documentation consulted

- TLA+ tools and Toolbox repository: <https://github.com/tlaplus/tlaplus>
- v1.7.4 release page: <https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4>
- TLC command-line behavior, config-file format, exit-status semantics:
  Context7 `/tlaplus/tlaplus` (authoritative, High reputation) — confirmed
  `-config`, `-metadir`, `-workers`, `-deadlock`, `-cleanup`, `-difftrace`,
  `-nowarning`; confirmed non-zero exit on property violation / error;
  confirmed `INVARIANT <Name>` must reference a defined predicate.
- Leslie Lamport TLA+ / PlusCal documentation and `docs.tlapl.us` are the
  canonical language references; the model in this PR is hand-written TLA+
  (no PlusCal translation step).
