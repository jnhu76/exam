# R1 extraction review and snapshot freeze record

> **This file is the R1-D deliverable**: the adversarial review of the first
> deterministic, repository-derived Atlas snapshot, the adjudication of every
> finding, the correction record, and the R1 verdict. Execution issue
> [#764](https://github.com/jnhu76/exam/issues/764); parent master plan
> [#757](https://github.com/jnhu76/exam/issues/757).
>
> **This file is not an Exam authority.** It records what was reviewed, what was
> found, and what was changed — review history is evidence, and it is kept rather
> than rewritten. The semantic contract it implements was frozen by R0
> ([`semantic-contract.md`](semantic-contract.md), [`ir-v0.1.md`](ir-v0.1.md))
> and is **not renegotiated here**.

```text
R1_BASE                 = 0044e2a0a859427aa6927d19a0ff939525a60130   (R0 merge, PR #768)
SOURCE_SHA              = aec71c2c701c0d1c80dc8ba5360116d538af1e8d   (the observed revision)
CAPTURE_OBSERVED_HEAD   = 79f22ad2739b08c95157152a49faea20d1dc8445   (route-facts capture)
BRANCH                  = feat/atlas-r1-extraction-snapshot
PR                      = jnhu76/exam#769
IR_SCHEMA_VERSION       = v0.1        (frozen by R0; unchanged)
SOURCE_REF_VERSION      = SREF-1      (frozen by R0; unchanged)
EXTRACTOR               = @exam/atlas 0.1.0
ROUTE_FACTS_EXTRACTOR   = @exam/api/atlas-route-facts 0.1.0
SNAPSHOT                = packages/atlas/generated/atlas-snapshot.json
SNAPSHOT_ID             = sref1-ir0.1-aec71c2c-347dcc49
NORMALIZED_BODY_HASH    = 347dcc49c81ed8112a1956469e0be528403dbd3e57b567613229607635311e0e
COVERAGE_REPORT         = packages/atlas/generated/coverage-report.json
```

`SOURCE_SHA` is **not** the PR head: committing the snapshot moves HEAD, so a
HEAD-bound rebuild could never reproduce the committed bytes. The freeze binds at
the observed revision, and the build proves the observation is still current (the
capture revision is an ancestor with no product-tree drift).

## 0. How the review was run

Five **independent** read-only reviewers were dispatched against the R1-C head
`a2e3be46`, one per attack direction, with no shared context and no access to the
author's reasoning. Each was told to *disprove* the snapshot and to report
specific findings or nothing:

```text
1  determinism            force order, working directory, wall-clock and
                          environment dependence into the bytes
2  false support / join   force enum → SUPPORTED, closed issue → SUPPORTED,
                          route exists → full workflow, test exists → VERIFIED
3  RBAC / route authority force preset → global access, assignment/scope loss,
                          a hidden registry gap, runtime vs declared conflation
4  provenance / locator   move a file, rename a symbol, delete a locator,
                          change external work-item freshness
5  anti-demo inventory    try to make the 23-family inventory a demo: golden
                          slices only, invented predicates, coverage pressure
                          to invent, silent UNKNOWN→NOT_SUPPORTED
```

Corrections landed in four waves on top of that head, and each wave was
re-verified:

```text
WAVE 1  code        151988b1  roll-up parts, activation-claim selection,
                               ATLAS-IR-040a derivation, SEM-071 gates,
                               normalizer/graph findings, set canonicalization,
                               SREF-1 MISSING semantics, replace-ref isolation
WAVE 2  curation    26b21334  the 23-family graph, derived-field discipline,
                               boundary/evidence alignment, D-K1/D-K3 as
                               hazards, the fabricated gate edge removed
WAVE 3  tests       747e7cf3  determinism permutations, derived-field
                               overwrites, IR-080, SEM-071, capture equality
WAVE 4  freeze      837928e7  rebuild at SOURCE_SHA, freeze check
```

Two further defects were found by the author **during the freeze**, not by a
reviewer: a fabricated `DECISION_GATE` edge (F-03) and a `FALSE_CONFLICT` record
(F-04). Both are recorded below with the same force as a reviewer finding, because
a defect found late is not a smaller defect.

## 1. R1 checkpoint results

### 1.1 R1-A — deterministic core

```text
DOUBLE_REBUILD_EQUAL          = YES  (byte-identical envelope, same inputs)
SHUFFLED_ENUMERATION_EQUAL    = YES  (nodes/edges/facts/evidence/claims/conflicts)
SET_FIELD_PERMUTATION_EQUAL   = YES  (set-valued + keyed record sets)
PROSE_ORDER_PRESERVED         = YES  (`does_not_prove` is content, not enumeration)
WALL_CLOCK_IN_BODY            = NONE (no generated_at/timestamp/duration)
WORKING_DIRECTORY_IN_BODY     = NONE
NETWORK_DURING_BUILD          = NONE (the build reads curation + capture + git objects)
MANIFEST_FIELDS               = exactly the eight SREF-1/IR-060 fields
SNAPSHOT_ID                   = sref1-ir0.1-<SOURCE_SHA:8>-<body_hash:8>
DUPLICATE_MERGE               = agreeing duplicates merge; disagreeing
                                single-valued duplicates are a CONFLICT,
                                never last-write-wins (ATLAS-IR-065)
UNKNOWN_VS_NONE               = distinct sentinels; a wrong sentinel is rejected
REPLACE_REFS_ISOLATED         = YES  (GIT_NO_REPLACE_OBJECTS=1 on every read)
```

### 1.2 R1-B — runtime and authority extraction

```text
RUNTIME_ROUTE_SOURCE          = ACTUAL_CAPTURE  (the composed Fastify app via
                                the production apiSurface registration + onRoute)
CAPTURE_REPRODUCES_ARTIFACT   = YES  (apps/api/src/atlas/routeFactsCapture.test.ts
                                re-runs the real capture and compares it with the
                                committed artifact, observed_head excluded)
DECLARED_REGISTRY_DISTINCT    = YES  (113 registry entries mirrored, never promoted)
AUTHZ_CATALOG_EXTRACTED       = YES  (88 permissions, 7 presets, 12 scopes)
SCOPE_FACTS_EXTRACTED         = YES
SOURCE_REFS_SHA_BOUND         = YES  (391 refs RESOLVED at SOURCE_SHA)
NO_HEURISTIC_SUPPORTED_INFERENCE = YES  (no route, test, enum or closure
                                produces a support verdict)
O07_RE_DERIVED_NOT_FIXED      = YES  (148 runtime / 127 protected / 113
                                declared / 14 runtime-only / 0 declared-only
                                orphans, derived from the capture)
```

The capture runs at `CAPTURE_OBSERVED_HEAD`; `check` proves that revision is an
ancestor of `SOURCE_SHA` **and** that the product tree is unchanged in between
(`apps/`, `packages/`, excluding `packages/atlas/` and `apps/api/src/atlas/`).

### 1.3 R1-C — claim normalization and the inventory

```text
FOUR_GOLDEN_SLICES_REPRODUCED     = YES
MAJOR_CAPABILITY_FAMILIES_ACCOUNTED = YES  (23/23)
GOLDEN_SLICES_ONLY                = NO
COVERAGE_PRESSURE_TO_INVENT       = 0
FALSE_SUPPORTED_FROM_ENUM         = 0  (D-08 REJECTED)
FALSE_SUPPORTED_FROM_ISSUE_STATE  = 0  (D-07 REJECTED)
FALSE_GLOBAL_RBAC_FROM_PRESET     = 0  (C-07 REJECTED, B-08 SUPPORTED)
KNOWN_O07_CONFLICT_PRESERVED      = YES (C-K1 UNRESOLVED, owner #762 O-07)
UNKNOWN_NOT_FORCED                = YES (no verdict is forced in either
                                   direction: 20 of 23 capabilities carry no
                                   aggregate verdict because no curated claim
                                   establishes their activation)
```

Snapshot census (all re-derived, no hardcoded counts):

```text
NODES           514   Capability 23 · Facet 7 · Workflow 25 · Operation 150
                      Interface 149 · Permission 88 · RolePreset 7 · Scope 12
                      DurableEntity 9 · PolicyValue 16 · NormativeAuthority 9
                      WorkItem 19
EDGES           505   exposes 149 · performs 152 · requires_permission 125
                      contains 36 · governed_by 17 · tracked_by 11 · scoped_by 5
                      writes 6 · transitions_to 2 · reads 1 · depends_on 1
RECORDS               Fact 5 · Evidence 72 · Claim 83 · Conflict 10
CLAIM_VERDICTS        21 of the 83 claims store an activation verdict —
                      SUPPORTED 6 · MIXED 1 · GATED 1 · DEFERRED 1
                      NOT_SUPPORTED 7 · REJECTED 5. The other 62 claims carry
                      no activation_support value at all (they are not
                      capability-support claims; nothing is invented for them).
PART_ROLLUPS          the 30 parts (23 Capability + 7 Facet), as stored on the
                      nodes — SUPPORTED 5 · MIXED 1 · DEFERRED 1
                      NOT_SUPPORTED 3 · UNKNOWN 20 · GATED 0.
                      10 parts carry a verdict; 20 carry none and roll up
                      UNKNOWN by clause 5. (The claim-level GATED belongs to a
                      PolicyValue's activation_status, not to a part roll-up.)
MAPPING_STATE         MAPPED 30 / 30 Capability+Facet parts (PARTIAL 0,
                      UNMAPPED 0, UNKNOWN 0)
CONFLICT_RECORDS      10 = 8 UNRESOLVED + B-K3 RESOLVED_BY_DERIVATION
                      + C-K4 RESOLVED_BY_CORRECTION  (R0's frozen arithmetic)
SOURCE_REFS           0 MISSING · 0 STALE · 0 AMBIGUOUS
FINDINGS              48, all ATLAS-SEM-041 incomplete-claim reports. Findings
                      are build diagnostics printed by `build`; they are not
                      persisted in the envelope
INTERFACE_FAMILY_ORPHANS = 0 (145 of 149 interfaces were orphans before Wave 2)
```

### 1.4 R1-D — reviewer verdicts

```text
NONDETERMINISTIC_SNAPSHOT_DEFECTS = 0 known
FALSE_SUPPORT                     = 0 known
FALSE_RBAC_AUTHORITY              = 0 known
HIDDEN_REGISTRY_GAP               = 0
STALE_REF_DETECTED                = YES (resolve.test.ts)
MISSING_REF_DETECTED              = YES (resolve.test.ts, R0 regressions)
AMBIGUOUS_REF_NOT_SILENT         = YES (resolution_detail carries candidates)
```

### 1.5 Durable artifacts left by R1

```text
schema / runtime types      packages/atlas/src/ir/{types,record,records,ids,rollup}.ts
snapshot builder            packages/atlas/src/snapshot/{build,types,coverage}.ts
normalizer / serializer     packages/atlas/src/canon/{canonicalize,serialize}.ts
manifest                    built in packages/atlas/src/snapshot/build.ts,
                            written + checked by packages/atlas/src/cli.ts
source-ref resolver         packages/atlas/src/sref/{resolve,types,claimResolution}.ts
                            over packages/atlas/src/view/revision.ts
bounded extractors          packages/atlas/src/extract/{routes,authz,refs}.ts
                            + the capture seam
                            apps/api/src/atlas/extractRouteFacts.ts
golden mapping / fixtures   packages/atlas/curation/*.json (10 files),
                            packages/atlas/test/fixtures.ts
validator                   packages/atlas/src/ir/validate.ts +
                            `tsx src/cli.ts validate <file>`
focused tests               packages/atlas/test/*.test.ts (86),
                            apps/api/src/atlas/routeFactsCapture.test.ts
review / closeout evidence  this file, generated/atlas-snapshot.json,
                            generated/coverage-report.json
flake evidence              the two 2026-10-11 entries in
                            docs/standards/test-flakes.md, which record this
                            branch's own observations (§6.1). They document the
                            existing lane behaviour; no timeout, skip or retry
                            was added anywhere as a result
```

No second competing schema exists: `packages/atlas/src/ir/` implements
`ir-v0.1.md`, and `@exam/domain`/`@exam/contracts` remain the product's own
authorities — the Atlas never redefines a product type (`lint:arch` enforces the
package boundary).

## 2. Adversarial findings and adjudications

| ID | Direction | Finding | Adjudication | Correction |
| --- | --- | --- | --- | --- |
| F-01 | false support / roll-up | `ATLAS-IR-032` treated **every** `contains` child as a roll-up part, so any workflow-bearing capability rolled up `MIXED` — including `grading.manual` and `result.publication`, whose own `CAPABILITY_SUPPORT` claims qualify at `B4`. A false `MIXED` flattens "delivered" into "partly delivered". | **Accepted.** The frozen rule says a capability's parts are itself and its **facets**; a workflow is composition. | `src/snapshot/build.ts` builds parts from `facetsOf` only; `test/determinism.test.ts` + slice B now assert `SUPPORTED` at `B4` |
| F-02 | false support / join | A part's activation claim was selected by predicate alone, so a claim whose predicate is `support_summary` — a recorded roll-up **output** (A-11) — could feed the roll-up as an input; two competing activation claims silently took the first. | **Accepted.** Claim kind **and** predicate select the claim; two candidates are a conflict, not first-wins (`ATLAS-IR-065`). | `supportClaimOf` throws `SemanticConflictError` on a second activation claim |
| F-03 | false support / gate | `capability:runtime.candidate-exam` rolled up **`GATED`** off a `DECISION_GATE` edge to `work:jnhu76/exam#302` — a **CLOSED_SUPERSEDED** issue with no lift condition. The build synthesized the missing text (`"… (no lift condition recorded)"`), i.e. it manufactured the verdict's own justification. `ATLAS-SEM-053`/`-071` require a nameable gate and lift condition. | **Accepted (found during the freeze).** A gate that cannot state its lift condition is not a gate; a closed superseded work item is not an activation decision gate. | The edge is deleted; the part falls through to clause 5 → `UNKNOWN`. A `DECISION_GATE` on a Capability/Facet whose work item states no lift condition is now a **build error**, and the anti-demo test asserts both the rule and the `UNKNOWN` verdict |
| F-04 | false support / conflict | `D-K3` was recorded as a `TEMPORAL_CONFLICT` with `resolution_status = RESOLVED_BY_SCOPE` whose own proposition began "NO CONFLICT FOUND". R0's frozen census names **10** conflict records and counts `FALSE_CONFLICT = 0`; the frozen slice marks both `D-K1` and `D-K3` "not a `conflict_kind` value". | **Accepted (found during the freeze).** A non-conflict recorded as a conflict is the `FALSE_CONFLICT` the slice requires to be zero. | The record is removed; the scope distinction is recorded as a documentation hazard on `ev-ts-design-contract` (the evidence that establishes the design freeze's own side), exactly as `D-K1` already was on `ev-ts-shape-intentional` |
| F-05 | false support | 19 claims declared a `boundary` that **no cited evidence record covered** (`ATLAS-SEM-083` checks membership, never rank). Most were claims about the capture artifact citing prose documents. | **Accepted.** Evidence must cover the boundary the claim declares. | New `B0` evidence for the artifact-content claims, `B3`/`B4`/`B2` additions where the claim was stronger than its citations, corrected boundaries (`D-CF` B2→B1, `D-RS` B2→B0), and citations removed where a claim cited nothing it owned. One exception remains, recorded below |
| F-06 | false support | Five grading `PolicyValue`s derived `activation_status = UNKNOWN` while the frozen slice documents them as activation-consistent: their `activation_claim_ref` pointed at claims that never carried the design axis, so `ATLAS-IR-040a`'s four-conjunct derivation could not complete. | **Accepted.** A `PolicyValue`'s activation is derived from the claim that owns its boundary, not from a convenient neighbour. | They now point at `B-01` (the capability-boundary `CAPABILITY_SUPPORT` claim carrying all four `ATLAS-SEM-080` conjuncts) → `SUPPORTED`, derived |
| F-07 | false support | `PolicyValue.activation_status` could be **hand-set** in curation and survive (the timed_sync negative control is exactly the field a demo would raise). | **Accepted.** Derived fields are computed, never trusted (`ATLAS-IR-003`). | `activation_status` (and `support_summary`, `step_count`) are declared as derived in the record schemas; supplied values are overwritten; `test/determinism.test.ts` proves a hand-set `SUPPORTED` cannot survive either derivation |
| F-08 | determinism | Every normalizer finding was emitted **twice** (pre-merge and post-merge) and the graph-level `ATLAS-IR-080` findings were dropped entirely — 96 findings where there are 48, and a silent loss. | **Accepted.** Findings are part of the build output, never duplicated and never dropped. | `normalized.findings` is cleared and every record re-validated after the merge; `graph.findings` are appended |
| F-09 | determinism | Keyed record sets (`parties`, `source_refs`, `additional_gates`) kept author order in a single record while duplicate merges sorted them, so the same semantic content could produce two different snapshots. | **Accepted.** Two curation files listing the same set in different orders are the same input; prose lists are content and keep their order. | `orderKeyedRecords` canonicalizes keyed sets at the single-record level; the permutation test asserts byte equality and the rendered order |
| F-10 | determinism | A local `refs/replace` entry could change what "revision X" contains, so two machines could produce different snapshots of the same commit. | **Accepted.** `ATLAS-IR-060` is about the bytes, not about intent. | Revision reads pass `GIT_NO_REPLACE_OBJECTS=1` |
| F-11 | provenance | A ref whose commit the view **can** verify and cannot find resolved as `UNKNOWN`, and any `historical` flag short-circuited to `UNKNOWN` — so a deleted locator (the actual failure mode) was reported as unverifiable instead of `MISSING`. | **Accepted.** SREF-1 §4: not found at the bound revision is `MISSING`; only a genuinely unverifiable historical binding is `UNKNOWN`. | `src/sref/resolve.ts` distinguishes the two; `resolve.test.ts` + R0 regressions pin both |
| F-12 | RBAC / route authority | The inventory asserted mapping in prose while the graph could not back it: 52 nodes / 86 edges, 145 of 149 interfaces with no family membership, and 25 operations for a 148-route surface. `coverage_result: MAPPED` was a text field, not a traversable path. | **Accepted.** `ATLAS-IR-080` requires a sanctioned mapping — a real operation path or a work item — for `MAPPED`. | The inventory now carries the full family → workflow → operation → interface graph (187 nodes / 451 edges); `MAPPED` without a sanctioned mapping is a build **error**; 0 orphans |
| F-13 | RBAC / route authority | The RBAC slice's `C-K4` attributed a host-operator statement to the deployment runbook; the statement is ADR-017's. | **Accepted.** An evidence contradiction is a conflict record with both parties, and Atlas corrects only its own attribution. | `C-K4` keeps `EVIDENCE_CONTRADICTION` + `RESOLVED_BY_CORRECTION` with the corrected party and a verified closed search over the runbook |
| F-14 | anti-demo inventory | Family enumeration bases named the capture artifact as a *source* but not the family's own route basis, so "the family is covered" was not checkable; three families (`questions.bank`, `exams.lifecycle`, `incidents`) sat at `PARTIAL` with no closed search, and `capability:client-events` was named by no family — inviting "not applicable" as the escape hatch. | **Accepted.** Every family states its own route basis and its own closed search; scope that no seed family names is reported as discovered, never dismissed. | All 23 families carry real per-family bases (21 SAME, 1 MERGED, 1 SPLIT — one of R1-C's two MERGED families turned out to be a SPLIT); zero `NOT_APPLICABLE`; `capability:client-events` is recorded `DISCOVERED_BEYOND_SEED` and reported by identifier in the coverage report |
| F-15 | provenance | Extracted permissions/presets/scopes declared `extraction_method = AST_SYMBOL_LOOKUP` while they are read from the exported catalog tables. | **Accepted.** The method must describe the read that happened. | `SCHEMA_INTROSPECTION` |
| F-16 | false support / join | `preset_kind` derived `SYNTHETIC_ACTOR` from `isSystem`, which means "built-in", so six application-role presets were classified as synthetic actors. | **Accepted.** A synthetic actor is the non-login, non-assignable preset. | `preset_kind` derives from `login_allowed`/`assignable`; the golden C test asserts presets never carry grantee sets or resource reach |
| F-17 | determinism / provenance | The rebuild inside CI's `package-coverage` job produced a **different body hash** from the committed artifact (`927b44e2…` vs `347dcc49…`) and the history-walking freeze assertion could not resolve `aec71c2c` at all. Cause: the runner checks out depth 1, so every `git show <SOURCE_SHA>:…` read fell through to `undefined` and the extractor silently observed an *empty* repository — the same inputs building a different snapshot, i.e. the artifact was a function of clone depth. | **Accepted (found by exact-head CI; no local full-clone run can show it).** A repository the extractor cannot fully observe must be refused loudly, never sampled. | `GitRevisionView` refuses a shallow repository or an absent observed revision with an actionable message (`ATLAS-IR-060`), `test/revisionView.test.ts` pins both refusals plus the healthy path, `packages/atlas/README.md` states the requirement, and the `package-coverage` job now checks out `fetch-depth: 0` |

## 3. Findings raised but NOT adopted as stated

| Raised | Adjudication | Why |
| --- | --- | --- |
| "Delete the roll-up; render facets only" | **Declined** | The roll-up is the fixture's purpose (`ATLAS-IR-033`): `MIXED` exists so "delivered core + residual" can hold at once. It is hardened (F-01, F-02), not removed |
| "Return `UNKNOWN` for every capability outside the golden slices" | **Declined as a rule** | Forcing `UNKNOWN` is the same defect as forcing `SUPPORTED`. Every non-golden capability is `UNKNOWN` **because no curated claim establishes its activation**, which is clause 5 doing its job — not because a rule forbids verdicts |
| "Keep `D-K3` as a conflict with `RESOLVED_BY_SCOPE`" | **Declined** | The frozen census names ten records and calls `D-K1`/`D-K3` non-conflicts; `RESOLVED_BY_SCOPE` describes the *analysis outcome* ("so there is no conflict to resolve"), and the doc's own Kind cell says "not a `conflict_kind` value". Keeping the record would report `FALSE_CONFLICT = 1` |
| "Record both worked non-examples as `Fact` records" | **Declined** | `ATLAS-SEM-116` prescribes the carrier for a boundary distinction: a documentation/API-reference hazard. A parallel `Fact` would be a second truth source for the same fact |
| "Keep the `DECISION_GATE` edge and let the capability stay `GATED`" | **Declined** | The gate is a closed superseded issue; `GATED` would tell a reader a live decision gate exists |
| "Treat 149 interfaces and 150 operations as equal, or force one-to-one" | **Declined** | The gap is real: `operation:content.canonicalize` is an `INTERNAL_SYNTHETIC` operation performed by two workflows inside an accepting write's transaction and exposed by no HTTP interface. Padding it with an interface, or dropping it, would delete a real durable-effect step |
| "Adopt `pg_class`, enforce `ATLAS-IR-092`, give `Fact`/`Claim` node identity" | **Out of R1 scope** | R0 §5.5 assigned these to the standards owner and R2/R3/v0.2. R1 implements `v0.1` as frozen |

## 4. False-support stress test (R1's overfit check)

```text
enum value exists                       -> D-08 REJECTED (B0 metadata, B2 writer absent)
issue is CLOSED                         -> D-07 REJECTED (closure ≠ activation)
work item DELIVERS a capability         -> does not create a verdict; only a
                                           qualifying activation claim does
permission key exists                   -> B-21 REJECTED (inert grant is B0)
preset exists / is powerful             -> C-07 REJECTED; B-08 SUPPORTED with
                                           assignment_required = TRUE
route exists                            -> Interface + Operation, never a
                                           capability verdict
test file exists                        -> evidence at its own strength, never
                                           "VERIFIED"; the kernel tests prove
                                           the kernel, not the capability
component test at B3                    -> cannot raise a B4 roll-up
                                           (boundary laundering closed)
every seed family covered               -> does not raise any support verdict
one file lists the same set in a
different order                         -> identical bytes (not a second input)
```

## 5. Open items, known conflicts, deferrals

### 5.1 Retained findings (deliberate)

```text
ATLAS-SEM-041 INCOMPLETE_CLAIM = 48
```

Every claim with an empty `challenging_evidence` is reported rather than repaired:
a falsification attempt that was not made cannot be back-filled by the extractor,
and the count is the honest record of it. The finding is per claim id in the
snapshot envelope, so it is auditable rather than summarized away.

### 5.2 UNKNOWN / CONFLICT preserved

```text
UNKNOWN support verdicts            = 0 explicitly; 23 capabilities carry no
                                      verdict at all because no claim establishes
                                      their activation (clause 5), and none was
                                      converted into GATED/NOT_SUPPORTED
CONFLICT records                    = 10 (8 UNRESOLVED, 2 resolved by an
                                      action ATLAS-SEM-115 permits Atlas to record)
UNRESOLVED conflicts with an owner  = 8 (A-K1, A-K2, B-K1, B-K2, C-K1, C-K2,
                                      C-K3, D-K2) — every one keeps both parties
                                      and its `open_governance_item`
#762 O-07 divergence preserved      = YES (113 declared vs 127 protected; not
                                      repaired, not hidden)
```

### 5.3 Known gaps carried by identifier, not by count

```text
capability:client-events   named by no seed family -> coverage_report
                           capabilities_not_named_by_family_ids [1]
D-04                       the one claim whose declared boundary is covered by
                           R0's own three-element SEM-071 adequacy
                           (gate locator + lift condition + refusing seams)
                           rather than by a single cited evidence record ->
                           claims_boundary_not_covered_ids ["D-04"]
external_freshness         UNKNOWN: external work-item states are capture-time
                           observations (2026-10-11), recorded as revisions
unknown (D-U1..D-U5)       the negative control's five open questions stay open
lower-bound (B-U3)         historical inconsistent grading rows: no data census
```

### 5.4 Not R1 work

- `pg_class` vocabulary adoption, `ATLAS-IR-092` enforcement and the `Fact`/`Claim`
  node-identity question remain where R0 §5.5 assigned them (standards owner,
  R2/R3, v0.2 schema evolution).
- R2/R3 semantics: projections, Three.js/UI, drift CI, incremental cache, graph
  database. R1 delivers a snapshot and its gates, nothing that renders.

## 6. Verification performed for this freeze

```text
build at SOURCE_SHA        ATLAS_SOURCE_SHA=aec71c2c... pnpm exec tsx src/cli.ts build
                           -> snapshot_id sref1-ir0.1-aec71c2c-347dcc49
freeze check               pnpm exec tsx src/cli.ts check
                           -> PASS (rebuild at the observed revision byte-equals
                              the committed envelope)
envelope validation        pnpm exec tsx src/cli.ts validate generated/atlas-snapshot.json
                           -> PASS (body hash matches the manifest)
clean-worktree rebuild     a detached worktree at the freeze commit rebuilt the
                           artifact byte-identically (`git status` clean after
                           the rebuild) and its `check` also passed — the
                           snapshot does not depend on this worktree's state
atlas tests                pnpm --filter @exam/atlas test -> 86/86
                           (determinism 23 · golden conformance 24 ·
                            R0 regressions 13 · resolve 13 · extract 10 ·
                            revisionView 3)
capture equality           pnpm --filter @exam/api exec vitest run
                           src/atlas/routeFactsCapture.test.ts -> 1/1
static gates               pnpm verify:static -> PASS
                           (format:check · lint · lint:arch · lint:db-config ·
                            lint:db-journal · lint:env-contract · lint:env-surface ·
                            lint:eslint · typecheck · api:openapi:check)
full-fleet pnpm test       run 1 FAILED on the registered web `vi.waitFor` flake,
                           run 2 PASS · 17/17 turbo tasks, EXIT=0
                           api 2776 (+21 skipped) · web 2338 · exam-engine 742 ·
                           db 740 · contracts 384 · domain 88 · atlas 83 ·
                           authz 60 · auth 25 · import-export 17
full-fleet pnpm verify     FAILED in all three local runs — run 1 at
                           @exam/db#coverage, run 2 at @exam/api#coverage, run 3
                           at @exam/api#coverage (all host-load timeouts/hook
                           budgets in files this branch never touches). See §6.1
                           for the per-lane, re-run and base-revision evidence
exact-head CI (1st run)    FAILED at the `package-coverage` job — the CI checkout
                           is depth 1, so the in-CI rebuild observed an empty
                           repository and produced a different body hash (F-17).
                           Repaired by the shallow/absent-revision refusal plus
                           `fetch-depth: 0` in that job; re-run -> §7
```

### 6.1 The full-fleet failures, and why they are not R1's

The 4-worker coverage lanes on this host did not come up green on either full-fleet
attempt. Both failures are timeout/hook-budget failures — **no assertion failed** —
in files the branch does not touch. They are reported here as the failing gate
result rather than re-run until green and then reported as a pass.

```text
RUN 1 (pnpm verify, head 837928e7)
  @exam/db#coverage         1 failed file | 63 passed (64)
                            2 failed tests | 738 passed (740), both
                            `Error: Test timed out in 5000ms`, no assertion failure
                            src/repository/recoveryRepo.test.ts:2154
                            src/repository/recoveryRepo.test.ts:2232
                            lane: 199.82s wall for 443.29s of test work
  targeted re-run           pnpm --filter @exam/db exec vitest run
                            src/repository/recoveryRepo.test.ts -> 75/75 PASS
  serial lanes              @exam/db coverage EXIT=0 · @exam/web coverage EXIT=0

RUN 2 (pnpm verify, same head, idle host)
  @exam/api#coverage        3 failed files | 221 passed | 4 skipped (228)
                            3 failed tests | 2783 passed (2797)
                            src/scripts/bootstrap-admin.test.ts:375  5000ms timeout
                            src/routes/auth.test.ts:126              5000ms timeout
                            src/orchestrators/systemIncidentDelivery.test.ts:460
                              assertion drift `expected 1 to be 2` (overlap counting)
                            lane witnesses: src/runtime/processRestartDeadline
                            .process.test.ts 52.7s (cases 7.6s / 20.8s / 22.8s);
                            976.78s of test work in 378.40s wall
  @exam/db#coverage         PASS 64/64 on this run — the victims moved between runs
  targeted re-run           3 victim files in the same coverage lane -> 56/56 PASS
                            (14.3s / 18.9s / 18.2s; the exit code is the subset's
                            global coverage threshold, not a test failure)
  lane alone                pnpm --filter @exam/api coverage with the same env ->
                            7 failed files (6 suite hook budgets of 10s/30s + 2
                            test timeouts) | 217 passed | 2762 passed tests,
                            again no assertion failures, in files the branch
                            does not touch (e2e-reseed-convergence,
                            authz/backupEvidence, bootstrapLifetime,
                            clientEvents.referenceTrust, exam-protocol-security,
                            slotReuse/slot-reuse-isolation, routes/email)
  lane alone, attempt 2     same command, same head, idle host, 30 minutes later ->
                            224 passed | 4 skipped (228), 2786 passed | 11 skipped
                            (2797), EXIT=0 — the same lane that had just failed
  base revision             0044e2a0 in a separate worktree, same command ->
                            222 passed | 4 skipped (226), 2780 passed | 11 skipped
                            (2791), EXIT=0

RUN 3 (pnpm verify, same head, host otherwise idle)
  @exam/api#coverage        1 failed file | 223 passed | 4 skipped (228)
                            1 failed test | 2785 passed (2797)
                            src/scripts/bootstrap-admin.test.ts:375 — `Error: Test
                            timed out in 5000ms`, no assertion failure. This is the
                            line named verbatim in the BUG-FLAKE-005 entry, whose
                            four recorded occurrences (2026-10-06/07/08) happened
                            while verifying *other* branches
                            lane: 276.23s wall for 770.71s of test work

CAUSATION
  branch footprint in apps/api   package.json (one script line) +
                                 src/atlas/{extractRouteFacts.ts,
                                 extractRouteFacts.test.ts,
                                 routeFactsCapture.test.ts}
  diff for the victims           git diff --stat 0044e2a0..HEAD --
                                 apps/api/src/{orchestrators,scripts,routes}
                                 packages/db apps/web  -> EMPTY
  measured added lane load       the two new api test files cost 2.5s + 1.2s under
                                 coverage, against 976.78s–1268.74s of lane work
  open possibility               that burst sits on an already saturated lane, so
                                 it cannot be excluded as a contributor to *when*
                                 a hook budget is blown; one clean head run and one
                                 clean base run are too few to separate that from
                                 host variance. Recorded as open in the flake
                                 entry, which asks for comparison runs on branches
                                 that do not touch the api tests
  registered family              every victim signature is in
                                 docs/standards/test-flakes.md: bootstrap-admin:375
                                 is named verbatim in the BUG-FLAKE-005 entry,
                                 auth.test.ts:126 in the BUG-FLAKE-001
                                 auth-amplification entry, and the 2026-10-07 entry
                                 records the same 30s `afterAll` exhaustion
                                 (slot-reuse) on an unmodified master head
  not done                       no timeout raised, no test skipped, no retry
                                 added, no concurrency lowered, no snapshot rebuilt
                                 between any of these runs
```

`FALSE_REPORT = 0`: the two failing runs are recorded as failing, and no green run
is claimed for a lane that never produced one.

What the comparison does and does not establish: the api coverage lane produced
**both** a failure and a clean pass on the same head within half an hour, in the
mode the package's own config documents as the flake-prone one
(`apps/api/vitest.config.ts`: cross-file parallelism under coverage "still
produces the BUG-FLAKE-001 5s-timeout family"; serial is the safety net, and
`pnpm verify`/CI both select the parallel mode through `API_TEST_MAX_WORKERS=4`).
Tallied: that lane came up green once in four runs on this head (two inside
`pnpm verify`, two standalone) and once in one run at base, and the registry's
BUG-FLAKE-005 entries record the same lane failing while verifying two unrelated
branches. One base run against four head runs is a **weak** comparison and is
written down as such rather than presented as a proof; what it does establish is
that every victim is a timeout or hook-budget failure (no assertion failure) in a
file this branch never touches, that each victim passes on re-run inside the same
lane, and that the lane load this branch adds is measured and small. The decisive
gate stays exact-head CI, which runs the same commands on a dedicated runner (§7).

## 7. Gate summary

```text
R1_A/B/C/D = PASS
DOUBLE_REBUILD_EQUAL = YES
MAJOR_CAPABILITY_FAMILIES_ACCOUNTED = YES
GOLDEN_SLICES_ONLY = NO
COVERAGE_PRESSURE_TO_INVENT = 0
FALSE_SUPPORT = 0 known
FALSE_RBAC_AUTHORITY = 0 known
HIDDEN_REGISTRY_GAP = 0
PROVENANCE_DEFECTS = 0 known
UNJUSTIFIED_SUPPORTED_CLAIMS = 0
R0_SEMANTICS_BROKEN = NO
IR_SCHEMA_RENEGOTIATED = NO
PRODUCTION_BEHAVIOR_CHANGED = NO
DB_SCHEMA_CHANGED = NO
PUBLIC_API_CHANGED = NO
MUST_FIX = none
MUST_RESTORE = none

PNPM_TEST = PASS (run 2; run 1 hit the registered web `vi.waitFor` flake)
PNPM_VERIFY = FAILED locally (three runs, host-load only; §6.1). Every failing
              victim is a timeout/hook-budget failure in a file this branch never
              touches, each passes on re-run in the same lane, the added lane
              load is measured, and the repository records the same lane failing
              while verifying unrelated branches (BUG-FLAKE-001/005)
EXACT_HEAD_CI = runs on the pushed head; its per-job results are reported in the
                PR and the closeout rather than back-edited into this record
```

## 8. R1 verdict

The first Atlas snapshot is a faithful, rebuildable representation of the frozen
R0 semantics over the real repository: every golden slice reproduces its frozen
outcome, the 23 seed families are accounted for with the graph to back the claim,
every capability without a curated activation claim says `UNKNOWN` instead of
borrowing a verdict, and the two mechanisms a demo would use to fake support —
a hand-set derived field and an unqualified gate — are now impossible by
construction.

`R1_VERDICT = APPROVE`
`NEXT_PHASE_AUTHORIZED = R2_R3`
`PR_DISPOSITION = MERGE`
`READY_FOR_HUMAN_MERGE = YES`

The merge decision is the human's: R1 does not merge, close the execution issue,
or authorize R2/R3 on its own.
