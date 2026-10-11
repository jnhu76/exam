# Architecture Atlas — design area

> **Status:** R0 design artifacts (execution issue
> [#763](https://github.com/jnhu76/exam/issues/763), parent master plan
> [#757](https://github.com/jnhu76/exam/issues/757)). R0 freezes a semantic
> contract and an IR/provenance model. It implements **no extractor**, **no UI**,
> **no drift gate**.
>
> **R1 has since implemented the first snapshot** (execution issue
> [#764](https://github.com/jnhu76/exam/issues/764), PR
> [#769](https://github.com/jnhu76/exam/pull/769)): the extraction code lives in
> [`packages/atlas/`](../../../packages/atlas/), its output in
> `packages/atlas/generated/` (`atlas-snapshot.json`, `coverage-report.json`),
> and its review/freeze record in
> [`r1-extraction-review.md`](r1-extraction-review.md). R1 renegotiated nothing:
> the contract below is the one it implements.
>
> **Versions:** IR schema `v0.1` · source-ref schema `SREF-1`
>
> **Snapshot:** every factual claim in this directory is bound to the R0 base
> revision **`cbe33db1a7f241ba85aadbf21c4f6dea01133f03`** unless a source ref is
> explicitly marked `historical` or `external`. See
> [`provenance-v0.1.md`](provenance-v0.1.md) for the source-ref schema and
> [`r0-review.md`](r0-review.md) for the review/freeze record. (The R1 snapshot
> binds to its own observed revision `aec71c2c701c0d1c80dc8ba5360116d538af1e8d`,
> recorded in its manifest.)

## 1. What the Atlas is

The Atlas is a **read model**: a queryable, rebuildable representation of

```text
capability → workflow → operation → runtime seam
           → authority / scope → durable fact
           → evidence → work item
```

built from sources that already exist — Accepted ADRs, `docs/README.md`'s
authority index, contracts, production code, the actual Fastify route surface,
tests, and GitHub work items.

## 2. Authority boundary

**Atlas is not a normative head.** The rules below are binding on any future
Atlas phase (R1–R4) and on this directory's own content.

- The Atlas **owns** exactly one thing: the representation contract for the
  claims it makes about Exam (this directory).
- The Atlas **owns no Exam fact**. For every fact type, the authority is the
  one already named in
  [`docs/README.md` § Authority by fact type](../../README.md#authority-by-fact-type).
  Atlas never becomes the owner of a product invariant, a contract, a route
  behaviour, an authorization rule, or a work-item status.
- Atlas **creates no new business authority** by normalizing, projecting, or
  summarizing facts.
- Atlas **never resolves a conflict by choosing a winner.** A conflict between
  current authorities is a reported state (`AUTHORITY_CONFLICT`), not an Atlas
  decision. Resolving it requires the authority owner, recorded as a work item.
- Atlas output (renders, tables, role matrices, generated prose, Three.js
  layouts) is a **projection**: it cannot create, amend, or override a fact.
- When Atlas cannot establish a fact, the correct output is `UNKNOWN`. An
  `UNKNOWN` is a **successful** Atlas outcome, not a failure to be optimized
  away. Fabricating a value to avoid `UNKNOWN` is a defect.

## 3. Artifacts in this directory (R0)

| Artifact | Owns |
| --- | --- |
| [`README.md`](README.md) | Purpose, authority boundary, artifact map, scope of R0 |
| [`semantic-contract.md`](semantic-contract.md) | **The single canonical R0 semantic contract**: Fact, Evidence, NormativeAuthority, Claim, WorkItem, Projection, status axes, support rule, forbidden inferences, UNKNOWN/CONFLICT propagation |
| [`ir-v0.1.md`](ir-v0.1.md) | Minimal IR node/edge set, stable identity, record shapes, normalization contract |
| [`provenance-v0.1.md`](provenance-v0.1.md) | `ArchitectureSourceRef` (`SREF-1`), locator model, resolution states, repo-SHA vs external freshness |
| [`golden/rich-subjective.md`](golden/rich-subjective.md) | Falsification fixture A — delivered core vs residual facets |
| [`golden/manual-grading.md`](golden/manual-grading.md) | Falsification fixture B — capability → operation → scope → durable fact → evidence |
| [`golden/rbac-maintainer-admin.md`](golden/rbac-maintainer-admin.md) | Falsification fixture C — `RolePreset` ≠ effective authorization; declared metadata ≠ runtime truth |
| [`golden/timed-sync-negative-control.md`](golden/timed-sync-negative-control.md) | Falsification fixture D — representable ≠ supported |
| [`r0-review.md`](r0-review.md) | Adversarial review findings, adjudications, correction record, R0 verdict |
| [`r1-extraction-review.md`](r1-extraction-review.md) | R1 adversarial review, adjudications and correction record, snapshot freeze verification, R1 verdict |

There is **one** semantic contract. The four golden slices are consumers of it;
none of them may define a private schema variant (see `ATLAS-SEM-090`).

## 4. What R0 is not

R0 deliberately does **not** deliver: a TypeScript Compiler API crawler, a
Tree-sitter pipeline, a runtime route-capture generator, a graph database, a
Three.js or 2D explorer, audience documentation generation, a drift/impact CI
engine, an incremental cache, or any change to production code, database
schema, authorization behaviour, contracts, or Accepted ADR decision text.

The golden slices are **semantic falsification cases**, not Atlas content
coverage. R0 is not scored on extraction automation; R1
([#764](https://github.com/jnhu76/exam/issues/764)) owns extraction and the
major-capability inventory. R0 is not authorized to start R1.

## 5. Reading order

1. [`semantic-contract.md`](semantic-contract.md) §9 (support rule) and §10
   (forbidden inferences) — the load-bearing part of R0.
2. [`provenance-v0.1.md`](provenance-v0.1.md) — how a claim binds to a revision.
3. [`ir-v0.1.md`](ir-v0.1.md) — the smallest structure that carries those
   semantics.
4. The four golden slices — the attempt to break the two documents above.
5. [`r0-review.md`](r0-review.md) — what actually broke, and the verdict.
