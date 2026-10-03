# #669 Phase E — Frozen Invariant Ledger (§3)

Extracted ONLY from `rich-content-semantic-contract.md` (§§2–15), ADR-019
(decision + amendment), and the delegated protocol authorities at their own
seams. Each entry records owner, input domain, expected/forbidden result,
production seams, and the reachability level(s) at which Phase E must confirm
it. Section refs are to the semantic contract unless noted.

## Canonicalization core

### E-RC01 — one Rich grammar / normalization / limits authority
- OWNER: domain kernel + `ContentDocumentV1Schema` (contract §2, §18; RC-01)
- INPUT DOMAIN: every value interpreted as Rich V1 anywhere in the system
- EXPECTED: all write/read/render/export/grading interpretation converges on
  the single authority or fails closed
- FORBIDDEN: a second semantic oracle deciding what persisted Rich means
- SEAMS: all (verified structurally + by Campaign U source census)
- REACHABILITY: L0 census + L1 differential + spot L3/L4

### E-RC02 — supported editor semantics survive canonical mapping
- OWNER: `contentAdapter.ts` under the declared mapping policy (§17, RC-02)
- INPUT DOMAIN: supported Tiptap JSON (allow-listed extensions)
- EXPECTED: paragraphs/marks/hardBreak/inlineMath/blockMath/lists/nested
  lists/tables/codeBlock survive the declared mapping (incl. the frozen
  tableCell/listItem blockMath → inlineMath downgrade)
- FORBIDDEN: a NEW undeclared silent downgrade or data loss
- SEAMS: editor adapter → canonical write
- REACHABILITY: L1 (adapter), L2-web (reality suite), L5 spot

### E-RC03 — canonicalization closure + idempotence
- OWNER: `canonicalizeContentDocument` (contract §3 RC-03; ADR-019 amendment §2)
- INPUT DOMAIN: schema-admissible documents `d` (ContentDocumentV1Schema +
  preflight accept)
- EXPECTED: for every successful `canonicalize(d) = c`:
  `Schema(c)` ok ∧ `Limits(c)` empty ∧ `Normalize(c) == c` ∧
  `canonicalize(c) == c` ∧ every read path classifies `c` `rich_valid`
- FORBIDDEN: accepted canonicalization output rejected by the same authority
  (the B-F01 class)
- SEAMS: kernel, answer canonicalizer, question write seam
- REACHABILITY: L1 property campaign + L3/L4 round-trip

### E-RC04 — preflight does not silently shrink the legal set
- OWNER: `preflightContentDocumentStructure` (contract §5, RC-04)
- INPUT DOMAIN: schema-valid + CONTENT_LIMITS-valid documents
- EXPECTED: preflight accepts every such document
- FORBIDDEN: `HIDDEN_STRICTER_SET` (preflight rejects a legal document);
  preflight admitting hostile structure that breaks the recursive parser
- SEAMS: schema entry (route validation, SaveAnswer, read classification)
- REACHABILITY: L1 differential

## Writes

### E-WR01 — all durable Rich writes persist accepted canonical output only
- OWNER: question write seam (`resolveQuestionContentWrite`, `resolveOption`)
  + SaveAnswer canonicalizer (`validateAnswerForQuestion`) (§6, ADR-019 §5)
- INPUT DOMAIN: every production Rich write path (create/update/import/copy/
  admin tools/migration helpers/test-support-in-prod)
- EXPECTED: persisted value == canonicalize() output; identity digest computed
  on the canonical value
- FORBIDDEN: any durable writer persisting pre-canonical or non-canonical Rich
- SEAMS: question CRUD routes, answer save route, receipts
- REACHABILITY: L0 inventory (Campaign F) + L4 round-trip (Campaign D)

### E-WR02 — projection fields are derived, never a second authority
- OWNER: B′ write authority (ADR-019 §4.1); publish projection invariant
- INPUT DOMAIN: rich question/option rows
- EXPECTED: `content == plainTextProjection(contentDocument)` at every durable
  Rich commitment; client-supplied content ignored on rich writes
- FORBIDDEN: independent `content` mutation stranded against the document
- SEAMS: question CRUD, publish gate
- REACHABILITY: L4 (write then inspect row; publish rejection on divergence)

## Reads

### E-RD01 — persisted Rich typed read classification is fail-closed
- OWNER: the two §7 classifiers (contract §7; D3/D5 as-built owners)
- INPUT DOMAIN: the 7-state corpus (empty/plain/legacy_plain/rich_valid/
  rich_noncanonical/unsupported_version/corrupt)
- EXPECTED: typed classification; bad data → integrity state, never 500 /
  repair / fallback
- FORBIDDEN: corrupt → plain; corrupt → empty editable; unsupported → V1
- SEAMS: restore/reload/STALE_VERSION adoption, grading/result render, export,
  ContentRenderer, publish gate
- REACHABILITY: L1 matrix + L3/L4 consumer matrix (Campaign K) + L5 render

### E-RD02 — corrupt ≠ empty
- OWNER: §7 (`CORRUPT_PERSISTED_RICH != EMPTY_DOCUMENT`)
- INPUT DOMAIN: corrupt persisted Rich on rich slots
- EXPECTED: integrity surface; no editable empty document materialization that
  autosave could overwrite
- FORBIDDEN: corrupt mounting the editor / becoming `{docVersion:1,content:[]}`
- SEAMS: RichTextAnswerInput, restore, export
- REACHABILITY: L2-web + L3/L4

### E-RD03 — Rich-slot string needs explicit provenance
- OWNER: §7 provenance rule (classifier `legacyPlainProvenance`)
- INPUT DOMAIN: string value where Rich is authoritative
- EXPECTED: `corrupt` unless `legacyPlainProvenance === true` (no production
  call site sets it)
- FORBIDDEN: `typeof value === "string"` promoting to plain/legacy_plain on a
  rich slot
- SEAMS: answer classifier consumers
- REACHABILITY: L1 + L3/L4

### E-RD04 — read classification never repairs persisted data
- OWNER: §7 ("Read validation / classification does not itself mutate
  persisted data")
- INPUT DOMAIN: noncanonical/corrupt/unsupported fixtures at every read seam
- EXPECTED: zero durable writes triggered by read operations
- FORBIDDEN: silent normalization/upgrade/persist during read
- SEAMS: restore, grading read, export, render, publish validation failure
- REACHABILITY: L4 DB state-hash proof (Campaign V)

### E-RD05 — rich_noncanonical DISPLAY ≠ editability/canonicality
- OWNER: §7 + D3 as-built (DISPLAY grants render, never edit/repair)
- INPUT DOMAIN: schema-valid non-canonical persisted documents
- EXPECTED: read-only display permitted; editor seam fails closed; no
  relabeling as canonical
- FORBIDDEN: mounting the editor on rich_noncanonical; export labeling it valid
- SEAMS: RichTextAnswerInput, ContentRenderer, export
- REACHABILITY: L2-web + L3/L4

## Replay (contract §12)

### E-RP01 — same accepted clientSeq + same canonical identity → same prior ACK
- OWNER: SaveAnswer protocol (§12 semantic replay contract)
- INPUT DOMAIN: replayed (clientSeq, canonical-equal payload)
- EXPECTED: accepted:true, prior version + prior savedAt verbatim, zero writes
- FORBIDDEN: second answer write; new savedAt; version bump
- SEAMS: saveAnswer engine + receipts repo
- REACHABILITY: L2 + L4

### E-RP02 — same clientSeq + different canonical identity → conflict
- OWNER: SaveAnswer protocol (§12)
- EXPECTED: CONFLICTING_PAYLOAD rejection, no write
- FORBIDDEN: silent overwrite or acceptance
- REACHABILITY: L2 + L4

### E-RP03 — accepted replay keys are not silently forgotten while mutable
- OWNER: §12 + append-only receipts (D2 as-built)
- INPUT DOMAIN: long answer histories on a mutable attempt
- EXPECTED: seq 1 replayable after arbitrarily many later seqs; restart-stable
- FORBIDDEN: retention bound / eviction making a key unknown
- REACHABILITY: L4 (H1/H2)

### E-RP04 — known replay retains precedence where frozen
- OWNER: §13 precedence (lifecycle → deadline → canonicalization → known
  replay → CAS)
- INPUT DOMAIN: combinations (known replay + stale/future baseVersion, known
  replay + terminal attempt, …)
- EXPECTED: known-replay decision happens after lifecycle/deadline and before
  CAS; terminal/deadline guards win over replay
- FORBIDDEN: replay masking a terminal/deadline rejection; CAS clobbering a
  known replay
- REACHABILITY: L2 combination campaign (G) + L4 spot

### E-RP05 — replay receipt + accepted transition are atomic
- OWNER: D2 as-built single protocol commit (§12 receipt ownership delegates
  implementation; atomicity obligation frozen by D2 corrective phase)
- INPUT DOMAIN: accepted new answers; injected receipt-storage failure
- EXPECTED: no durable answer-without-receipt; no receipt-without-answer
- FORBIDDEN: partial commit
- REACHABILITY: L4 (H6)

## Freeze chain

### E-SB01 — submit freezes exactly the last accepted canonical draft
- OWNER: ADR-008 / `buildSubmittedAnswersSnapshot` (contract §8)
- INPUT DOMAIN: attempt with multiple accepted versions/replays
- EXPECTED: `submitted_answers[i].value` == last accepted canonical value
  (byte/structure-equivalent under canonical identity)
- FORBIDDEN: re-normalization/upgrade/downgrade/reinterpretation at submit
- SEAMS: submitAttempt
- REACHABILITY: L3/L4 (Campaign I)

### E-SB02 — submit does not re-normalize / repair / reinterpret Rich
- OWNER: contract §8 ("Do not add a second Rich canonicalizer to the submit path")
- EXPECTED: submitted value === persisted draft value (identity digest equal)
- REACHABILITY: L3/L4 + L0 (source census of submit path)

## Grading / result

### E-GR01 — grading consumes frozen answer/question authority
- OWNER: contract §9 / ADR-008
- EXPECTED: grading reads `submitted_answers` + frozen snapshot; never live
  bank truth; a bad frozen Rich value surfaces as integrity condition
- FORBIDDEN: live-bank reinterpretation of a frozen answer
- REACHABILITY: L3/L4 (Campaign J/K)

### E-RS01 — result consumes frozen Rich truth without reinterpretation
- OWNER: contract §9
- EXPECTED: result render classifies via the shared authority; corrupt stays
  integrity state
- REACHABILITY: L3/L4 + L5

## Export

### E-EX01 — raw evidence ≠ semantic projection
- OWNER: contract §14 + D4 as-built (JSON raw + mode/integrity/projection;
  CSV cell from projection only)
- EXPECTED: raw preserved; projection consistent with classifier; corrupt/
  unsupported projection null; CSV uses "—" marker
- FORBIDDEN: fabricating a Plain projection for corrupt/unsupported
- REACHABILITY: L3/L4 (Campaign L) 

### E-EX02 — corrupt/unsupported Rich cannot masquerade as valid Plain export
- EXPECTED: typed objective slots (boolean/array/record) never classified as
  corrupt Rich (classifier not invoked off text_response)
- REACHABILITY: L3/L4

## Render

### E-RE01 — static Rich must earn renderability
- OWNER: ContentRenderer trust boundary (§15, D5 as-built)
- EXPECTED: only rich_valid/rich_noncanonical reach the document renderer
- FORBIDDEN: corrupt/unsupported falling back to plain `content`
- REACHABILITY: L2-web + L5

### E-RE02 — corrupt/unsupported Rich fails closed (render)
- EXPECTED: controlled integrity notice (`content-integrity-notice`)
- REACHABILITY: L2-web + L5

### E-RE03 — rendering is inert
- OWNER: §15
- EXPECTED: no active HTML/script execution from text/code/math
- FORBIDDEN: script tags, event handlers, javascript: URLs from content
- REACHABILITY: L2-web + L5 (network-level evidence exists in D5; Phase E
  extends corpus)

### E-RE04 — rendering resource behavior is bounded
- EXPECTED: latex bound (CONTENT_LIMITS.latex), bounded KaTeX expansion
  (maxSize/maxExpand), bounded render recursion on hostile nesting
- FORBIDDEN: unbounded recursion crash / stack overflow on legal-or-injected
  shapes
- REACHABILITY: L1/L2-web measured

### E-RE05 — malformed math preserves source evidence
- EXPECTED: KaTeX throwOnError:false renders source text; source recoverable
- REACHABILITY: L1 library seam + L2 React seam

### E-RE06 — no unauthorized active/remote content path
- EXPECTED: no cross-origin fetch from rendered content (KaTeX trust:false)
- REACHABILITY: L5 (existing D5 network evidence + Phase E extension)

## Publish

### E-PB01 — publish trusts repository Rich before projection
- OWNER: D5.1 gate (`assertPublishableRichDocument` before plainTextProjection)
- EXPECTED: corrupt/unsupported/noncanonical → typed ValidationError, never
  projection crash
- REACHABILITY: L2 + L3 (Campaign O)

### E-PB02 — new publication freezes canonical Rich only
- EXPECTED: rich_noncanonical row is NOT normalized into a new commitment;
  publish rejects
- REACHABILITY: L2 + L3/L4

### E-PB03 — question/option Rich have equivalent trust discipline
- EXPECTED: option-level documents pass the same classify gate + projection
  invariant
- REACHABILITY: L2 + L3

### E-PB04 — publish does not repair historical Rich
- EXPECTED: publish validates then freezes; no normalization write to the
  question row
- REACHABILITY: L4 (Campaign V)

## Frozen independence

### E-FZ01 — frozen attempt/question facts do not drift with live question changes
- OWNER: contract §9/§10, ADR-008 snapshot authority
- INPUT DOMAIN: post-freeze live-bank mutations (prompt, contentDocument,
  answerMode, rubric, standardAnswer, options, score)
- EXPECTED: candidate reload/save/submit/grading/result/export/render behave
  per the frozen facts; only explicitly live-owned fields may differ
- FORBIDDEN: frozen answer interpretation changing after bank edits
- REACHABILITY: L3/L4 (Campaign J), Plain + Rich cases

## Evidence-quality gates (§31/32/30)

- NO_REIMPLEMENTED_DECISION_ORACLE_IN_HARNESS
- SHRINKER_PRESERVES_FAILURE_CLASS
- CLAIMED_PRODUCTION_SEAMS_ARE_ACTUALLY_USED

## Campaign seeds (§6)

Regression continuity: `0x66900001` (existing Phase-C lineage seed),
`0x67300001`, `0x68100001`. New Phase-E seeds: `0x669E0001`, `0x669E0002`,
`0x669E0003`. Every harness run records its seeds.
