# @exam/atlas — Architecture Atlas IR v0.1 tooling

Deterministic, repository-derived Architecture Atlas snapshots for the frozen
R0 contract (`docs/architecture/atlas/` — `semantic-contract.md`,
`ir-v0.1.md`, `provenance-v0.1.md`). Execution issue
[jnhu76/exam#764](https://github.com/jnhu76/exam/issues/764).

This package is **offline tooling**, not a production dependency of any app.
It never calls the network during a build; external (GitHub) facts enter only
through explicitly captured revisions in `curation/`.

## Layout

```text
src/ir/        IR v0.1 closed sets, ID grammar, record field tables
               (the default table), ATLAS-IR-032 roll-up, semantic validation
src/sref/      SREF-1 source refs, resolution/freshness (independent axes),
               claim-level derivation
src/canon/     canonical normalization (merge/dedupe/sort) + serialization
src/snapshot/  semantic input → derived fields → canonical envelope + manifest
src/view/      RevisionView (git-backed / in-memory) observed by the resolver
src/cli.ts     build / validate entry points (run with tsx)
test/          conformance suite incl. the permanent R0-D regression inputs
curation/      reviewed curation input (golden slices, inventory, authorities)
input/         committed apps/api route-facts capture (declared + runtime)
generated/     canonical snapshot + coverage report (committed artifacts)
```

## Commands

```bash
pnpm --filter @exam/atlas test     # conformance suite
pnpm --filter @exam/atlas exec tsx src/cli.ts validate generated/atlas-snapshot.json
ATLAS_SOURCE_SHA=<40-hex> pnpm --filter @exam/atlas exec tsx src/cli.ts build <input.json>
```

## Determinism contract

`ATLAS-IR-060`: same source revision + same extractor version + same curation
input ⇒ byte-identical normalized snapshot. No wall clock, no filesystem
enumeration order, no locale collation and no network input reaches the
semantic bytes; volatile build metadata is not committed at all.
