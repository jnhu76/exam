# Rich Content Semantic Contract

> **Rich V1 semantic and protocol-integration authority.** This document defines
> what a Rich `ContentDocumentV1` value means, how it enters the system, how it is
> read back, and how it composes with the surrounding Exam protocols.
>
> Status: **normative**, adopted by
> [ADR-019](../adr/ADR-019-content-document-model.md) (Phase-B amendment,
> 2026-10-02). Adoption does not itself change production code behavior; known
> implementation deviations are recorded explicitly (§4).

## 1. Scope and authority

**Rich owns what a Rich value means.** Other Exam protocols own whether and when
that value may be acted upon.

This document owns:

- closed V1 representation semantics;
- canonicalization semantics and equivalence;
- allowed-input / product complexity limits;
- safe structural intake rules;
- canonical identity;
- typed persisted-read interpretation;
- static rendering / projection semantics;
- cross-protocol integration obligations at the Rich seam.

This document explicitly does **not** own:

- actor identity or authentication;
- authorization or permission decisions;
- admission mechanisms;
- Attempt lifecycle, deadlines, or recovery authority;
- `SaveAnswer` acceptance / state transitions / receipt storage;
- transaction ownership or persistence implementation;
- submission lifecycle, locking, or terminal transitions;
- grading score / workset semantics;
- result visibility or publication;
- deployment capability resolver design (see ADR-022).

Rich is a content authority, not a lifecycle engine. Canonical values produced
here are consumed by SaveAnswer, submit, grading, result, export, and rendering
protocols; those protocols decide when a value is accepted, frozen, graded, or
shown.

## 2. Single Rich authority

The authoritative Rich V1 source is:

```text
closed ContentDocumentV1 grammar
+ normalization / equivalence rules
+ CONTENT_LIMITS
+ declared editor → canonical mapping policy
```

It is **not** any of the following by itself:

- Tiptap, ProseMirror, or toolbar behavior;
- the React renderer;
- KaTeX configuration;
- the JSONB storage shape alone;
- client-side advisory checks.

The server-accepted **canonical document** is the persistent Rich semantic
truth. A plain-text projection derived from a canonical document is read-only
and must never be treated as a second authority over the same slot.

## 3. Canonicalization invariants

The following invariants are load-bearing for Phase-B freeze.

**RC-01 — One V1 grammar / normalization / limits authority.** There is exactly
one Rich V1 semantic authority. All write, read, render, export, and grading
paths that interpret V1 documents must converge on this authority or fail
closed.

**RC-02 — Editor-visible semantics survive canonicalization.** Supported
editor-visible V1 semantics must survive conversion into canonical persistent
semantics. Off-grammar or editor-only constructs must be rejected or routed
through an explicitly declared editor → canonical mapping.

**RC-03 — Canonicalization is closed and idempotent.** If canonicalization of an
input produces output `c`, then all of the following must hold:

- `ContentDocumentV1Schema` accepts `c`;
- `CONTENT_LIMITS` accepts `c`;
- `Normalize(c) == c`;
- canonicalizing `c` again succeeds with `c`;
- `c` can be safely read, replayed, and projected by every supported read path.

This is a closure property: **successful canonicalization must produce a value
that the same semantic system accepts.**

**RC-04 — Preflight must not silently shrink the legal document set.** Safety
preflight exists to bound parsing / intake cost. It may enforce depth safety,
fan-out safety, non-JSON / cycle rejection, bounded traversal, and bounded
serialization, but it must not create an undocumented smaller semantic set for
otherwise valid V1 documents.

### 3.1 What is not frozen as a universal invariant

Plain-text projection equality is **not** a universal canonicalization
invariant:

```text
plainTextProjection(normalize(d)) == plainTextProjection(d)
```

is intentionally **not required** for every input. Canonical equivalence is
structural identity after normalization:

```text
N(d1) == N(d2)
```

not visual similarity, plain-projection equality, or mathematical equivalence.

## 4. Known closure failure: B-F01

A known counterexample motivates RC-03:

A legal Rich input can pass `ContentDocumentV1Schema`, `CONTENT_LIMITS`,
structural preflight, and `validateAnswerForQuestion`, yet normalization merges
adjacent compatible text runs into a single text run longer than the current
`textRun` limit. The resulting canonical value is then rejected by the same
schema / limit read path that accepted the original input.

This demonstrates the class:

```text
schema-valid / limit-valid input
  → normalize
  → canonical output outside accepted schema / limits
```

**B-F01 disposition:**

- KNOWN;
- NOT FIXED by this Phase-B authority pass;
- USED AS A PHASE-B COUNTEREXAMPLE supporting RC-03;
- repair algorithm and mechanism selection are Phase-C/D follow-up work.

The Phase-B normative requirement is closure: successful canonicalization must
produce a valid canonical value. This document does **not** prescribe whether the
repair is deterministic split, rejection, or limit adjustment; that choice
requires adversarial evidence and product justification.

## 5. Allowed-input authority (C1)

`CONTENT_LIMITS` defines Rich V1 product / document complexity limits.

Structural preflight exists for safe bounded parsing and intake. It may enforce:

- depth safety;
- fan-out safety;
- non-JSON / cycle rejection;
- bounded traversal;
- bounded serialization.

Preflight must not create an undocumented smaller semantic set for otherwise
valid V1 documents.

Three limit categories must remain distinguishable:

1. **Transport / body limits** — HTTP-layer payload boundaries;
2. **Rich product limits** — `CONTENT_LIMITS` semantics;
3. **Safety / preflight resource limits** — parsing-intake hardening budgets.

Current constants are not tuned by this document; they remain implementation
parameters.

## 6. Write contract

The semantic intake pipeline is:

```text
editor / external input
  → bounded structural intake (preflight)
  → closed V1 parsing
  → product limits (CONTENT_LIMITS)
  → normalization
  → canonical-output validation
  → canonical Rich value
  → existing protocol owner decides persistence
```

- Client-side checks are advisory UX; they may improve responsiveness but cannot
  authorize a canonical value.
- Server-side accepted canonicalization is authoritative.
- Rich validation may produce typed semantic failures internally, but outer
  protocols (SaveAnswer, route validation) own their wire / error mapping.

As-built (Phase D5.1): the exam publish/freeze gate is one such protocol owner
and classifies every repository-loaded question / option `contentDocument`
through the same shared static read authority (§7,
`classifyPersistedQuestionContent`) before its projection invariant —
`rich_valid` proceeds to the `content == plainTextProjection(document)` freeze
check, while `rich_noncanonical` / `unsupported_version` / `corrupt` are typed
publish rejections (`ValidationError`), never a projection crash and never a
fallback to the stored `content` string. Publication freezes only canonical
Rich (a noncanonical row bypassed the single write seam and may not become a
new frozen commitment); publish validates then freezes and never normalizes a
historical row — repair is a separate explicit migration.

Rich does **not** emit the following lifecycle / authz errors:

- `STALE_VERSION`
- `DEADLINE_EXCEEDED`
- `ATTEMPT_ALREADY_SUBMITTED`
- permission failures

Those belong to SaveAnswer / Attempt / authorization authority.

## 7. Read contract

Persisted Rich values must be classified into typed read states. Conceptually:

| Read state | Meaning |
| --- | --- |
| `empty` | The document slot is absent / null and represents an intentionally empty value. |
| `plain` | The slot's answer mode is Plain: a plain string is the legitimate representation, and Rich authority is not invoked. |
| `legacy_plain` | A plain string in a slot / source where Rich is authoritative, legitimate only when provenance explicitly establishes the legacy plain case (rules below). |
| `rich_valid` | A canonical V1 document that passes schema and limits. |
| `rich_noncanonical` | A schema-recognizable V1 document that violates a canonical invariant (e.g., unnormalized marks, unsorted text runs). It is not silently repaired at read time. |
| `unsupported_version` | A document envelope with a `docVersion` the current system chooses not to interpret as V1. |
| `corrupt` | Not a recognizable document at all (bad JSON, wrong envelope, hostile structure, or inconsistent stored shape). |

`plain` and `legacy_plain` are distinct trust decisions, not one state:

- `plain` follows from the slot's answer mode. It is never inferred from
  `typeof value === "string"` alone.
- `legacy_plain` requires explicit source / mode provenance establishing that
  the value was written by the legacy plain protocol for that slot. Without
  that evidence, a plain string where Rich is authoritative is classified
  `corrupt` (inconsistent stored shape) — it must not be adopted as a valid
  plain answer by candidate restore, reload, recovery, `STALE_VERSION`
  adoption, grading / result rendering, or export.

Critical normative rule:

```text
CORRUPT_PERSISTED_RICH != EMPTY_DOCUMENT
```

A corrupt persisted Rich value must not silently become an empty editable
document that is then overwritten by autosave. Candidate restore, reload,
recovery, `STALE_VERSION` adoption, grader / result rendering, and export must
share one semantic interpretation authority. They may have different UX failure
handling, but they must not have different definitions of valid Rich.

Read validation / classification does not itself mutate persisted data.

## 8. Submit freeze integration

The submit protocol owns:

```text
locking
terminal transition
freeze
workset materialization
```

Rich owns only interpretation of the value.

Submission **must not** re-normalize, upgrade, repair, or reinterpret an already
accepted Rich value as part of normal submission. The frozen submitted answer is
exactly the last accepted canonical draft under the authoritative lock.

Do not add a second Rich canonicalizer to the submit path.

## 9. Grading and result integration

```text
submitted frozen answer
  → grading
  → result
```

is one content authority.

Grading owns:

- workset materialization;
- rubric / reference authority;
- grader permission;
- score and completion.

Result owns:

- readiness;
- publication;
- visibility.

Rich owns only safe interpretation / rendering / projection of the frozen
answer value.

Grading / result must not read live question-bank Rich to reinterpret an
existing frozen answer. A bad frozen Rich value must be surfaced as a
data-integrity condition, not silently converted into a normal Plain answer.

## 10. Capability composition integration

Product capability composition is governed by
[ADR-022](../adr/ADR-022-product-capability-composition.md) and
[`product-capability-composition.md`](product-capability-composition.md). Rich
does not redesign that architecture.

The only Rich-specific freeze is:

```text
current capability ceiling
governs NEW product commitments
```

while accepted obligations remain serviceable.

Explicitly preserve:

- published Rich exams;
- active Rich attempts;
- allowed retake under frozen policy;
- pending manual grading;
- historical Rich results;
- authorized export;

after a deployment disables new Rich authoring / publishing capability.

A new Attempt executing an already accepted / published exam obligation is **not**
automatically a new Rich capability commitment. Capability enablement grants no
actor authority; `capability != permission`.

## 11. Admission integration

Rich semantics are independent of admission mechanism. Roster, account,
company membership, federated launch, or future entry adapters must converge on
the existing Attempt / runtime authority.

The Rich parser / canonicalizer must not inspect:

- issuer;
- roster;
- `companyId`;
- launch token;
- session provenance;

except where another protocol provides already-resolved context required by an
explicitly defined content / version compatibility rule.

## 12. Save / retry / replay integration

Freeze the **semantic** replay contract:

```text
same accepted clientSeq + same canonical answer identity
  → same prior acknowledgement, zero new answer write

same accepted clientSeq + different canonical answer identity
  → conflicting payload

unknown clientSeq
  → normal existing CAS / version protocol
```

Also freeze:

```text
During the mutable lifetime of an Attempt,
an already accepted clientSeq MUST NOT be silently forgotten such that
it later appears to be a never-before-seen key.

Terminal lifecycle guards retain precedence.
```

This document owns **canonical answer identity** and the equivalence replay uses.
It does **not** own receipt storage, lookup, retention implementation,
transactional persistence, or migration. Those belong to the SaveAnswer / Exam
authority.

The following implementation mechanisms are explicitly out of scope for Rich
authority:

- SHA-256 or any other digest algorithm;
- key-sorted JSON implementation;
- receipt SQL table design;
- append-only physical storage;
- specific index design;
- specific database migration mechanism.

## 13. Failure precedence

Rich validation must not reorder existing lifecycle / deadline / authorization
precedence. The conceptual order around the SaveAnswer seam is:

```text
authz / route validation
deadline reconciliation
terminal lifecycle
Rich canonicalization
known replay
baseVersion CAS
accept
```

Rich canonicalization sits after lifecycle / deadline guards and before
idempotency / version semantics. Only the seam necessary to prevent Rich from
becoming a parallel lifecycle engine is frozen here; the full SaveAnswer state
machine remains under its existing authority.

## 14. Export contract

```text
raw evidence != semantic projection
```

The export owner chooses which authoritative source is exported. Rich may
provide:

- integrity / read status;
- plain projection when valid.

The existing raw candidate answer field is not required to be replaced.

Additively, export semantics may include fields such as:

```text
raw / source / mode / integrity / projection
```

but exact field names are API / implementation design unless already frozen by
an external contract.

As-built (Phase D4): the JSON attempt export keeps the raw `candidateAnswer`
as the authoritative evidence and adds `candidateAnswerMode` /
`candidateAnswerIntegrity` / `candidateAnswerProjection` per question result;
the CSV attempt export appends `考生答案模式` / `考生答案状态` after its frozen
columns and renders its answer cell from the classified projection — never
from the raw value — so `unsupported_version` / `corrupt` cells carry the
not-applicable marker instead of stored text. Both routes classify through the
shared persisted-answer classifier against the frozen snapshot `answerMode`
(§7); the export seam owns representation only and does not re-derive Rich
semantics from the runtime shape.

Required invariant:

```text
invalid / corrupt Rich must never be silently exported as if it were a valid
semantic Plain projection.
```

## 15. Rendering / security contract

Rich rendering must be **inert and bounded**:

- Text / code cannot become active HTML or script execution.
- Math rendering must preserve source on malformed input and must be exercised
  through real production rendering seams.
- Current KaTeX controls may be referenced accurately, but version-specific
  implementation options are not made permanent architectural truth unless
  necessary.

Phase-E acceptance requires permanent executable evidence for:

- real static render path;
- real editor math path;
- malformed / adversarial math handling;
- bounded expansion / resource usage;
- no active / remote content path.

As-built (Phase D5): every static prompt / option read path classifies a
non-null `contentDocument` through the shared static read authority
(`packages/contracts/src/persistedQuestionContent.ts`) inside
`ContentRenderer` before any document rendering — only `rich_valid` /
`rich_noncanonical` (read-only DISPLAY) reach the document renderer;
`unsupported_version` / `corrupt` fail closed to a controlled integrity
notice and never fall back to the plain `content` projection. Math
rendering goes through one encapsulated KaTeX seam with trust disabled and
explicit expansion / size bounds (implementation parameters, not frozen
vocabulary). The permanent executable evidence lives at the library /
React-seam / composition layers in
`apps/web/src/components/shared/content/MathRenderer.evidence.test.tsx`
and at the browser network level in `apps/e2e/e2e/rich-content.spec.ts`
(D5 math render security).

## 16. Audit / telemetry

Audit / telemetry must not become a second answer-persistence surface. Raw Rich
answer bodies must not be required in ordinary telemetry.

Metadata such as the following may belong to existing audit / diagnostic policy:

- attempt id;
- question id;
- version;
- `clientSeq`;
- size;
- validation result.

This document does not redesign global audit policy. If current documentation
incorrectly claims `attempt.saved` audit behavior that code does not implement,
only a focused wording correction in an authorized touched document is
performed; this task does not expand into general audit cleanup.

## 17. Editor mapping boundary

Distinguish two operations:

1. **Canonical grammar normalization** — deterministic, idempotent,
   schema-closed transformation of a V1 document into canonical form.
2. **Editor-context mapping** — adapter-layer conversion between editor-specific
   constructs and the canonical grammar.

An established editor-context mapping: a `table` or `list` blockMath node is
adapted to a canonical paragraph containing inlineMath, because canonical table
cells / list structures do not admit arbitrary top-level blockMath.

Selection-settlement mechanics (C12–C15) remain editor-context behavior, not
domain semantics. They are fixed evidence, not Phase-B implementation work, and
are not moved into this semantic contract.

## 18. Authority map

| Concern | Authority |
| --- | --- |
| Rich V1 grammar, limits, normalization, equivalence | This document + [`packages/domain/src/content/contentDocument.ts`](../../packages/domain/src/content/contentDocument.ts) implementation |
| Wire schema / type identity | [`packages/contracts/src/contentDocument.ts`](../../packages/contracts/src/contentDocument.ts) |
| Persisted-answer read classification (§7) | [`packages/contracts/src/persistedRichAnswer.ts`](../../packages/contracts/src/persistedRichAnswer.ts) — the single shared classifier consumed by web read paths and API export (Phase D4) |
| Static question-content read classification (§7) | [`packages/contracts/src/persistedQuestionContent.ts`](../../packages/contracts/src/persistedQuestionContent.ts) — consumed by the `ContentRenderer` render trust boundary (Phase D5) and the exam publish freeze gate (Phase D5.1) |
| Cross-boundary Exam semantics | [`exam-semantic-boundaries.md`](exam-semantic-boundaries.md) / ADR-021 |
| Product capability composition | [`product-capability-composition.md`](product-capability-composition.md) / ADR-022 |
| Attempt lifecycle / SaveAnswer / submit / grading / result | [`exam-runtime.md`](exam-runtime.md), ADR-005, ADR-006, ADR-008, ADR-012 |
| Admission | Existing admission authority / #645 direction |
| Authorization / permission | ADR-010 / current authorization architecture |
| Adoption / amendment record | [ADR-019](../adr/ADR-019-content-document-model.md) |

## 19. Internal consistency checklist

This contract must continue to satisfy:

- **A:** Rich does not own authorization, deadlines, attempt state, grading
  state, or result visibility. ✓
- **B:** ADR-019 remains an adoption/decision record, not a duplicate of this
  architecture document. ✓
- **C:** This document freezes replay semantics, not receipt implementation
  (no SHA-256 / SQL table / index / physical format). ✓
- **D:** Implementation constants and KaTeX configuration are not made
  unnecessarily architectural. ✓
- **E:** New product commitment is distinguished from accepted obligation for
  ADR-022 integration. ✓
- **F:** Read contract distinguishes empty / legacy / valid / noncanonical /
  unsupported / corrupt without silently repairing persisted truth. ✓
- **G:** Successful canonicalization explicitly guarantees its own output is
  accepted by the same semantic system (RC-03). ✓
