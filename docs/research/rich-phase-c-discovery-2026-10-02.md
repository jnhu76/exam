# #669 Phase C — Rich Subjective Adversarial Discovery Ledger (2026-10-02)

- **Base**: `master` = `6c50ebfe5fed869a48e3aef74900a1ec9bc68ed9` (= merge of PR #685, 2026-10-02T10:32:34Z). Research branch `research/669-rich-phase-c-adversarial-discovery` rooted exactly at that commit.
- **Mode**: 调查/审计 + harness 施工 (discovery-only per #669 Phase C authorization). **No production file modified**; all changes are research harness, fixtures, and this ledger.
- **Oracle**: `docs/architecture/rich-content-semantic-contract.md` (frozen Phase-B authority) + ADR-019. The implementation is the system under test; the oracle was never inverted and never edited.
- **Method**: property campaigns (seeded, bounded) + measured boundaries + real-PostgreSQL route rigs + real-editor (Tiptap/jsdom) mounts + real KaTeX render seam. Real production functions only; no normalize/limits/schema logic reimplemented.
- **Reviewability**: the harness/source patch (11 code files, excluding the already-accepted ledger) is committed in-repo at `docs/research/rich-phase-c-harness-source.patch` so it is readable wherever this branch is; a working-copy copy also exists at `/home/hoo/669-phase-c-corrections.patch` (see §11).
- **Status**: campaigns COMPLETE; Gate-1 review round 1 = CHANGE_REQUIRED (F1–F3 blockers, F4 clarify). Evidence-correction pass applied in §4/§12 (reachability taxonomy restored to the registered scale, PC-F06 reclassified as resource observation, D2/D4 authority boundary corrected, PC-F08 split malformed vs trust-gated). Awaiting focused re-review before Phase D.

---

## 1. Preconditions and authority confirmation

| Requirement | Evidence |
| --- | --- |
| PR #685 merged | `gh pr view 685` → state `MERGED`, mergedAt `2026-10-02T10:32:34Z`, mergeCommit `6c50ebfe` |
| Contract on live master | `git cat-file -e origin/master:docs/architecture/rich-content-semantic-contract.md` OK at `6c50ebfe` |
| ADR-019 ACCEPTED, amended | `docs/adr/ADR-019-content-document-model.md` §Status: "ACCEPTED, amended (2026-10-02)" at `6c50ebfe` |
| `PHASE_B_ACCEPTANCE_SHA` | `6c50ebfe5fed869a48e3aef74900a1ec9bc68ed9` |
| `LIVE_MASTER` | `6c50ebfe5fed869a48e3aef74900a1ec9bc68ed9` (origin/master, fetched 2026-10-02) |
| `WORKTREE_STATUS` (at first submission, `f7be75dc`) | clean of tracked-file modifications; only untracked research artifacts (committed in `f7be75dc`) |

`PHASE_C = COMPLETE` (not `BLOCKED_ON_PHASE_B_ACCEPTANCE`).

## 2. Method and budget compliance

- PRNG: mulberry32; seeds only from the mandated set `0x66900001`, `0x67300001`, `0x68100001` (plus deterministic fixed fixtures where no RNG is needed).
- Case budgets: ≤1000 generated cases per campaign (A: 1000+1000+500; D: 300; K: bounded sweep; others: fixed corpora ≤ 25 crafted cases or a real-route N=30 rig).
- Wall time per campaign file: measured 1.0s–6.3s (budget 60s). Hostile single cases < 1s (KaTeX corpus per-case, 1800-node editor mount, merge-floor canonicalization).
- Shrinker: greedy text-run halving + trailing-block dropping against the campaign's own failure predicate; every reported counterexample is presented in shrunk form.
- Real resources: Campaigns F/H/I/J run through `buildTestApp` + `fastify.inject` against real PostgreSQL (test database per `docs/standards/testing.md` §2); Campaigns D/G mount the real Tiptap editor; Campaign L calls the production `renderToString` seam.

## 3. Campaign matrix

| # | Campaign (authority clause) | Layer | Seed(s) | Cases | Counterexamples | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| A | Canonicalization closure + idempotence (RC-03) | L1/L2 | 0x66900001, 0x67300001, 0x68100001 | 1000 + 1000 + 500 + boundary sweeps | merge class only → **PC-F01** | closure BROKEN (known class only); idempotence holds on every canonical output produced |
| B | CONTENT_LIMITS vs preflight (RC-04) | L2 | deterministic ramps + binary search | 7 families × (ramp + binsearch) | **PC-F02** (all 7 families) | RC-04 VIOLATED: preflight hides a strictly smaller legal set |
| C | Normalization equivalence (RC-02 corollaries) | L1 | fixed corpus | 12 equivalence + 13 non-equivalence pairs | 0 | equivalence relations hold; inlineCode+bold normalization is deterministic |
| K | Unicode integrity (RC-02/§4) | L1/L2 | 0x66900001 + fixed corpus | UTF-16/astral/CJK/lone-surrogate/ZWJ/bidi/NFC-NFD/CRLF corpora + sweep | astral/CJK variants of the merge class (folded into **PC-F01**) | all other Unicode semantics preserved verbatim; UTF-16 accounting correct at limit (10000 emoji = 20000 units) |
| D | Editor ⇄ canonical round trip (RC-02) | CLIENT_COMPONENT (jsdom, real Tiptap) | 0x67300001, 0x68100001 | 300 generated + boundary (1800 nodes) + off-grammar probe | probe only → **PC-F07** | round trip lossless on the grammar; off-grammar block: adapter no-throw → `undefined` entry → editor mounts silently |
| E | SaveAnswer protocol (§12/§13) | L2 (pure core + production canonicalizer) | fixed corpus | precedence matrix, replay, CAS, B-F01 interaction | **PC-F01 downstream chain** (no protocol-order defect) | precedence matches §13 exactly; replay/CONFLICTING_PAYLOAD/CAS semantics correct; B-F01 canonical (over-limit) is accepted once, persisted, replayed, and served as `latestAnswer` |
| F | Mutable-attempt replay (§12) | L3/L4 (real route + PostgreSQL) | fixed rig, N=30 accepted saves | replay seq 1 / 17 / unknown | semantic 0; resource observation → **PC-F06** | prior ACK + byte-identical row on replay; unknown seq → CAS; receipts grow unbounded full-payload (NOT a contract counterexample — §12 freezes no storage representation) |
| G | Typed persisted-read trust (§7) | CLIENT_COMPONENT (jsdom, real Tiptap) | 11-state corpus | 11 classifier states + 3 mount counterexamples | **PC-F03, PC-F04, PC-F05** | shared classifier collapses §7's 7 states to 2; candidate mount path violates §7 three ways |
| H | Submit freeze / grading parity (§8) | L4 | 5 rigs | draft/frozen/workset parity + live-question mutation | 0 | draft == submitted frozen == workset candidateAnswer, verbatim; frozen snapshot immune to live question mutation |
| I | Corrupt value behavior (§7/§8) | L4 | corrupt + unsupported_version rigs | take snapshot / submit / workset | 0 (chain evidence for G) | corrupt drafts are served verbatim at every read seam → reaches the client mount path of G unchanged |
| J | Export semantics (§14) | L4 | JSON + CSV rigs | raw-evidence assertions, projection counting | 0 | export emits raw structured frozen evidence (JSON object; CSV JSON-stringified cell); semantic projection appears only once as question content, never as answer projection — no C7 behavioral defect on current master (contract decision still open, Phase D4) |
| L | KaTeX rendering security (§15) | L1 (production pure-function render seam) | 20-case corpus | trust-gated/active-content/self-referential \def | rendering observation → **PC-F08** (classified: no violation); security 0 | inert (no style/event/active content emitted from attacker input) and bounded (`maxExpand` stops `\def\x{\x}\x`); trust-gated commands render only the command token — parsed arguments are dropped |

Totals: **100 tests** (API 7 files / 69 tests, web 3 files / 31 tests), all passing at base `6c50ebfe`. No campaign was rerun for the correction pass; every reclassification below is a re-labeling of evidence already in the committed corpus (Campaign L included — its per-case expectations already separate the two input classes).

## 4. Findings

**Reachability scale (REGISTERED Phase-C protocol — restored verbatim; findings re-labeled, scale not redefined):**

```text
L0 static hypothesis
L1 production pure-function
L2 engine / command seam
L3 HTTP / API
L4 real PostgreSQL persisted
L5 browser / user path
```

Non-level metadata used alongside the scale (never a substitute for an L-level): `CLIENT_COMPONENT` (jsdom mount), `REAL_EDITOR` (real Tiptap instance), `ANOMALOUS_PERSISTED_STATE_REQUIRED` (version skew / downgrade / direct DB write — no supported current writer), `SUPPORTED_CURRENT_WRITER` (reachable through the SaveAnswer route as-is). Component-level evidence sits outside the L-scale; it is never labeled L5.

**Finding inventory (dedup per Gate-1 review):**

```text
Contract counterexamples (6 fixtures, 4 defect classes)
├─ PC-F01  RC-03 closure break (contract-known B-F01)
├─ PC-F02  RC-04 hidden stricter legal set (#673 C1)
├─ PC-F03 ┐ one defect class: TYPED_READ_TRUST_NOT_ENFORCED_ON_CANDIDATE_EDITABLE_PATH
├─ PC-F04 │ (#673 C4 family) — three fixtures, one root cause
├─ PC-F05 ┘
└─ PC-F07  RC-02 editable-path off-grammar silent degradation

Resource observation (not a contract counterexample)
└─ PC-F06  C5 full-payload receipt growth — CONTRACT_VIOLATION = NO

Rendering observation (classified; no violation)
└─ PC-F08  trust-gated fidelity — §15 malformed-source invariant HELD
```

`COUNTEREXAMPLE_FIXTURES = 6` · `DEFECT_CLASSES = 4` · `RESOURCE_OBSERVATIONS = 1` · `RENDERING_OBSERVATIONS = 1 (no violation)`

### PC-F01 — Canonicalization emits a value the same authority rejects (B-F01 class; RC-03 closure broken)

- **Invariant**: RC-03 (`Schema(c) ∧ Limits(c) ∧ Normalize(c)==c ∧ canonicalize(c)==c` for canonical output `c`).
- **Mechanism**: `normalizeInlineList` merges adjacent text runs with identical canonical mark sets (`packages/domain/src/content/contentDocument.ts:447-472`) with **no post-merge re-check** against `CONTENT_LIMITS.textRun`. The production canonicalization seam `validateAnswerForQuestion` returns `normalizeContentDocument(parsed.data)` directly (`apps/api/src/lib/validateAnswerForQuestion.ts:144`) — limits are never evaluated on the output.
- **Seed (preserved exactly)**: one paragraph, two adjacent unmarked runs `"a".repeat(20000)` + `"b"` — schema-valid, within limits, preflight-clean input → canonical output carries a single 20001-char run → `ContentDocumentV1Schema.safeParse(c)` fails, `checkContentDocumentLimits(c) == ["text run exceeds 20000 chars"]`, `preflightContentDocumentStructure(c) == []`, and `validateAnswerForQuestion(RICH_TEXT_QUESTION, c)` rejects (`closureCampaign.test.ts:113-152`).
- **Class floor**: 20001 total chars across two same-mark runs is minimal; 20000 total stays closed for every split position (`closureCampaign.test.ts:154-218`).
- **Generalization**: 1000-case boundary-biased campaign (seed 0x66900001): every closure failure found is this merge class (violated invariant exactly `text run exceeds 20000 chars`, evaluated on the canonical output of a schema-valid input); no second class surfaced. Astral (20002 UTF-16 units via 10001 𐀀) and CJK variants reproduce identically (`unicodeCampaign.test.ts`).
- **Downstream chain (L2 composition, decision core + production canonicalizer)**: the merge-class input is **accepted once and the over-limit canonical value is persisted** (`saveAnswerProtocolCampaign.test.ts:272-310`): `processSaveAnswer` → `accepted: true`, persisted value fails `ContentDocumentV1Schema`; the replay of the same seq ACKs from the over-limit canonical; a later stale-version save serves it on the wire as `latestAnswer` (mapped to `details.serverAnswer` by the route). The merged form is rejected on any later re-validation, so a candidate whose client normalizes adjacent runs (Tiptap does) cannot re-save that draft — a user-visible save failure after one successful accept.
- **What still holds**: `Normalize` is a fixed point on every canonical output it produces (500-case sweep, seed 0x68100001); closure holds for 1000 small mixed structures (seed 0x67300001, 0 failures).
- **Mapping**: contract §4 B-F01 (KNOWN / NOT FIXED); RC-03; seam `contentDocument.ts:447-472` + `validateAnswerForQuestion.ts:144`.
- **Reachability**: `HIGHEST_PROVEN = L2` (engine/command seam: `processSaveAnswer` decision core composed with the production canonicalizer; kernel pure functions = L1 also proven). `L3 = INFERRED, NOT EXECUTED` — the HTTP-route save of the merge-class seed itself was not driven in this campaign (noted as the first Phase-D1 verification step); inference is by exact code path identity, not by test evidence. `L4 / L5 = NOT EXECUTED`.
- **Severity**: **P2** — legal candidate input leads to a persisted non-canonical answer and a subsequent unsaveable draft; already a documented contract counterexample (not a new authority break), but this campaign adds the accepted-persisted-rejected chain and the class floor.

### PC-F02 — Structural preflight hides a strictly smaller legal set (RC-04 violated; #673 C1)

- **Invariant**: RC-04 (preflight must not shrink the contract's legal set).
- **Mechanism**: `preflightContentDocumentStructure` counts **every raw JSON value** (objects, arrays, strings — one node per DFS pop, `contentDocument.ts:332-366`) against `PREFLIGHT_NODE_BUDGET = CONTENT_LIMITS.totalNodes * 2 + 64 = 4064` (`contentDocument.ts:287`), while `totalNodes = 2000` counts grammar nodes only. A marked text run is 1 grammar node but ~6 raw values, so the ×2 fudge factor under-provisions: documents at ≈31% of the serialized budget and well under `totalNodes` are rejected with "document exceeds 4064 structural nodes" before the schema parse ever runs.
- **Measured boundaries** (ramp + binary search, per family: smallest rejected / grammar nodes at that point / serialized chars at that point — all `withinContentLimits: true`, classification `HIDDEN_STRICTER_SET`):

  | family | minFail units | grammar nodes | serialized chars |
  | --- | ---: | ---: | ---: |
  | plain-runs | 677 paras | 1354 | 40661 |
  | marks-[] runs | 581 | 1162 | 41292 |
  | one-mark | 508 | 1016 | 39157 |
  | bold+italic+underline | 407 | 814 | 39927 |
  | mark-dense (110 marks/run) | 313 | 626 | 39479 |
  | empty paragraphs | 1354 | 1354 | 46077 |
  | table rows (marked cells) | 16 rows | 992 | 42937 |

  These independently reproduce #673's A5 table (1352/1354, 1160/1162, 1014/1016, 812/814) on current master and add two new shapes (mark-dense units, marked table rows). Deepest legal list nesting passes; the `serializedChars` axis agrees with the walker at ±1 (closed from both sides).
- **Production consequence**: the rejection fires inside `validateAnswerForQuestion` (`validateAnswerForQuestion.ts:129-135`), so the SaveAnswer route rejects within-limits Rich answers — the accepted input set is strictly smaller than the frozen contract's legal set, with no documented authority for the raw-node unit.
- **Mapping**: RC-04; #673 C1 (P2); seams `contentDocument.ts:287,332-366` + `validateAnswerForQuestion.ts:129-135`.
- **Reachability**: `L2 PROVEN` at the `validateAnswerForQuestion` seam. `supported route reachability = INFERRED` (same function on the route path); `L4 = NOT EXECUTED`. A candidate pasting a long structured answer (~1400 grammar nodes of plain paragraphs) hits it.
- **Severity**: **P2** — legal content rejected; the authority conflict (two definitions of the accepted input set) is exactly the condition #673 C1 flagged for a Phase-B decision before repair.

### PC-F03 — Unexplained string in a Rich slot is adopted as legacy content without provenance (§7)

- **Invariant**: §7 read contract — without explicit legacy provenance, a plain string where Rich is authoritative is `corrupt` and "must not be adopted as a valid plain answer by candidate restore".
- **Evidence**: `RichTextAnswerInput` gates with `isContentDocumentV1(value) ? value : plainTextToDocument(typeof value === "string" ? value : "")` — any string is fed to `plainTextToDocument` and rendered in the mounted editor (`richPhaseC.readTrust.test.tsx`, counterexample 1: `value="未解释的旧字符串"` appears as editor content).
- **Mapping**: §7; #673 C4 family; seam `apps/web/src/components/exam/RichTextAnswerInput.tsx` (shallow gate).
- **Reachability**: `CLIENT_COMPONENT + REAL_EDITOR` (jsdom Tiptap mount — registered scale has no component slot; not L5). `L3 = NOT EXECUTED` for the string-delivery chain. `ANOMALOUS_PERSISTED_STATE_REQUIRED`; `SUPPORTED_CURRENT_WRITER = NO` (rich-mode preflight rejects a bare string before the schema).
- **Severity**: **P2** (C4 family) — silently re-types a value the contract declares corrupt.

### PC-F04 — `unsupported_version` envelope becomes an empty EDITABLE document (corrupt == empty at mount)

- **Invariant**: §7 — `CORRUPT_PERSISTED_RICH != EMPTY_DOCUMENT`; the mount authority must surface a typed integrity state, not an editable blank.
- **Evidence**: counterexample 2 (`richPhaseC.readTrust.test.tsx:136-156`): mounting `RichTextAnswerInput` with a `docVersion: 2` envelope emits, on the first onChange, the canonical **empty** document `{docVersion:1, type:"doc", content:[{type:"paragraph", content:[]}]}` — the exact C4 overwrite shape: one autosave later the v2 value is silently replaced.
- **Mapping**: §7; #673 C4; seam `RichTextAnswerInput.tsx`.
- **Reachability**: delivery chain `L4 + L3 EXECUTED` — Campaign I persists an `unsupported_version` draft to **real PostgreSQL by direct write** (the anomalous channel; `ANOMALOUS_PERSISTED_STATE_REQUIRED`, `SUPPORTED_CURRENT_WRITER = NO` — schema rejects `docVersion: 2`) and the real take-snapshot route serves it verbatim (`richPhaseC.freezeCorruptExportCampaign.test.ts`). Mount behavior itself: `CLIENT_COMPONENT + REAL_EDITOR` (not L5).
- **Severity**: **P2** — silent data replacement for a value the contract types as corrupt.

### PC-F05 — Corrupt envelope-shaped value passes the shallow gate into the editor

- **Invariant**: §7 typed read; deep validation belongs to the read trust boundary, not to caller discretion.
- **Evidence**: counterexample 3: `isContentDocumentV1(CORRUPT_ENVELOPE) === true` (envelope matches), so the value enters the editor and the editor **mounts silently**; Campaign D's probe shows the same silence deeper in the stack — `contentDocumentToTiptap` does not throw on an unknown block (`blockToTiptap` has no default branch, `contentAdapter.ts:73-113`), produces an `undefined` entry, and the editor still mounts (`PHASE-C-D-PROBE {"adapterThrew":false,"undefinedEntries":1,"editorOutcome":"mounted"}`).
- **Mapping**: §7; #673 C4; seams `RichTextAnswerInput.tsx` + `contentAdapter.ts`.
- **Reachability**: delivery chain `L4 + L3 EXECUTED` (Campaign I: corrupt draft persisted to real PostgreSQL by direct write — `ANOMALOUS_PERSISTED_STATE_REQUIRED`, `SUPPORTED_CURRENT_WRITER = NO` — and served verbatim by the real take-snapshot route). Kernel gate `L1 EXECUTED` (`isContentDocumentV1(CORRUPT_ENVELOPE) === true` driven directly). Mount behavior: `CLIENT_COMPONENT + REAL_EDITOR` (not L5).
- **Severity**: **P3** — no data loss by itself, but it is the enabler that delivers deep-invalid structures to the renderer (and to PC-F04's overwrite).

### PC-F06 — RESOURCE OBSERVATION: clientSeq receipts store full payloads and grow unbounded (§12; #673 C5)

> **Classification (per Gate-1 review): `CONTRACT_VIOLATION = NO` · `SEMANTIC_REPLAY = PASS` · `RESOURCE_DEBT = CONFIRMED`.** Phase B froze the mutable-attempt no-silent-forgetting guarantee and deliberately froze **no** receipt storage representation, retention bound, digest scheme, or DB layout. Unbounded full-payload growth is therefore a resource pathology / C5 implementation debt, NOT a frozen-contract counterexample; it is excluded from the counterexample counts.

- **Measurement (L4 — SUPPORTED_CURRENT_WRITER, real route + real PostgreSQL, N=30 accepted saves of a small Rich doc)**: `clientSeqHistory` holds N-1 = 29 full-payload receipts; row jsonb size grows 256 B (seq 1) → 1887 B (seq 10) → 5567 B (seq 30) — linear in save count, and each receipt is a **full payload copy**, so growth scales with document size (`PHASE-C-F-GROWTH`).
- **What still holds (the frozen semantic, PASSING)**: replaying seq 1 or 17 returns the original ACK and leaves the row **byte-identical**; an unknown seq takes the CAS path; an accepted `clientSeq` is never silently forgotten within the mutable lifetime (`richPhaseC.replayCampaign.test.ts`).
- **Mapping**: §12 (semantic = satisfied); #673 C5 (implementation debt); seam `answerProtocol.ts:346-376` (receipt append), `answerProtocol.ts:286-289` (verbatim receipt persistence).
- **Reachability**: `L4 PROVEN` (real PostgreSQL persisted, supported writer) — every autosave appends; long editing sessions grow the row without bound.
- **Priority**: **P2 resource debt** — unbounded per-row growth on a hot path; remediation is Phase-D2 **implementation design**, bound by the frozen semantic (see §12 D2).

### PC-F07 — Off-grammar block degrades silently through the adapter into a mounted editor

- **Invariant**: RC-02's corollary that structural ignorance must be *typed*, not silent; §7's fail-closed rendering for unknown blocks (the static renderer does fail closed with `此内容包含当前版本不支持的元素` — the **editable** path does not).
- **Evidence**: Campaign D probe (above); `blockToTiptap` covers paragraph/bulletList/orderedList/codeBlock/blockMath/table and has no default branch.
- **Mapping**: RC-02/§15; #673 E8 (non-canonical adapter fixture gap) + C4 mechanism inventory; seam `contentAdapter.ts:73-113`.
- **Reachability**: `L1 EXECUTED` (adapter pure function `contentDocumentToTiptap` driven directly on an off-grammar block — no throw, `undefined` entry) + `CLIENT_COMPONENT + REAL_EDITOR` (jsdom Tiptap mount; registered scale has no component slot). `ANOMALOUS_PERSISTED_STATE_REQUIRED`; `SUPPORTED_CURRENT_WRITER = NO` — the wire schema's strict block enum rejects unknown blocks, so no supported writer can persist one; `L3 / L4 = NOT EXECUTED` and not reachable through the supported stack.
- **Severity**: **P3** — silent-ignore is the wrong failure mode for a typed contract but requires an anomalous persisted value.

### PC-F08 — RENDERING OBSERVATION (classified per Gate-1 review): trust-gated failures drop parsed arguments; §15 malformed-source invariant HELD

Campaign L's existing 20-case corpus already separates the two input classes the Gate-1 review requires (no rerun needed; each case asserts its expectation against the real seam and passes):

- **Class A — syntactically malformed (parse errors)**: `\frac{1}{` (malformed brace), `x^` (truncated superscript) → expectation `error-render`, asserting the **complete HTML-escaped source is visible** in the output. These assertions PASS: **§15 "preserve source on malformed input" is satisfied — no violation.**
- **Class A′ — valid syntax, expansion-overflow failure**: `\def\x{\x}\x`, `\def\a{\a\a}\a` → also `error-render` with full source visible (and bounded by `maxExpand: 1000`). Source preservation holds here too.
- **Class B — syntactically valid but trust-disallowed / unsupported commands** (9 cases: `\href`, `\includegraphics`, `\htmlClass`, `\htmlId`, `\htmlStyle`, `\htmlData`, `\input`, `\write18`, `\notacommand{…}`) → KaTeX renders **only the failing command token**; parsed arguments are dropped. This is a **fidelity observation only**: §15's frozen obligation covers malformed input, not trust-denied valid input.

**Verdict: `CONTRACT_VIOLATION = NO`. `malformed-source-preserved = HELD (4/4 cases)` · `trust-gated-fidelity = ARGUMENTS_DROPPED (9/9 cases)`.** Security posture confirmed: inert (no attacker-influenced `style`/event/active content in any of the 20 outputs; `trust: false`, `strict: "ignore"`, `throwOnError: false`, `maxSize: 50`, `maxExpand: 1000` all observed effective).

One-off local witness (2026-10-02, Gate-1 correction audit): a temporary uncommitted harness file drove the same production seam over all 13 A/A′/B cases and recorded machine output — class A/A′ `fullEscapedSourcePresent = true` (4/4); class B `fullEscapedSourcePresent = false`, `tokenPresent = true`, **every parsed argument group absent** (9/9). This upgrades the bring-up observation (§9.4) into dated executed evidence; the file was deleted immediately after the run and is not part of the suite.

- **Mapping**: §15; #673 C9 (CONFIRMED_EVIDENCE_GAP) — closed by executing the real seam (the prior test exercised only the lazy/Suspense fallback).
- **Reachability**: `L1 PROVEN` (production pure-function seam `katexRenderToHtml` — the same `renderToString` path the renderer uses, not the Suspense fallback).
- **Severity**: **P3 observation** — relevant to a future Phase-D5 decision on the fail mode for trust-gated commands (token-only vs source-preserving); no contract violation to repair.

## 5. B-F01 disposition

Preserved exactly as the Phase-B authority states it (`docs/architecture/rich-content-semantic-contract.md` §4): **KNOWN / NOT FIXED / USED AS RC-03 COUNTEREXAMPLE**. The seed fixture is byte-identical to the mechanism description (adjacent compatible runs merge past `textRun`); reproduction at `closureCampaign.test.ts:113-152`. Phase C adds: the class floor (20001), the closed boundary below it, astral/CJK variants, the "every failure is merge class" 1000-case evidence, and the accepted-persisted-rejected downstream chain (PC-F01). **No repair was made**, per Phase-C scope.

## 6. C12–C15 remain FIXED

PR #681's closures (produced-atom anchor, never-cross-block merge policy, settlement-extended receipt, full-order assertions) were not re-opened: Campaigns A/C/K found no new failure class in those areas (no blockMath anchoring, cross-block, or ordering counterexample anywhere in the generated corpora), and no genuinely new deterministic counterexample against them exists in this campaign's evidence.

## 7. Consumer trust map (persisted Rich reads)

| consumer | mechanism | obeys §7? |
| --- | --- | --- |
| `ResultPage`, `GradingDetailPage`, `AttemptDetailPage` | shared classifier `resolveRichAnswerDocument` (`richAnswer.ts`) → binary valid/null, fails closed; static renderer placeholders unknown blocks | yes (binary collapse of the 7 typed states is lossy but fail-closed) |
| `RichTextAnswerInput` (candidate mount/restore) | local shallow gate `isContentDocumentV1` + unconditional `plainTextToDocument(string)` | **no — PC-F03/04/05** |
| take snapshot / submit freeze / grading workset | verbatim pass-through (Campaigns H/I: byte-identical) | n/a (raw evidence by design; the trust decision is delegated to the client, where the mount path fails it) |
| admin export (JSON/CSV) | raw structured frozen evidence, no validation gate (Campaign J) | per §14 the exposure/labeling decision (Phase D4 — implementation only; the raw-evidence ≠ semantic-projection invariant is already frozen), not a behavioral defect found |
| SaveAnswer route | production canonicalizer (preflight → schema → normalize) | writes canonical values — except the PC-F01 merge class, which persists a value the same seam later rejects |

## 8. No-counterexample areas (negative results, with budgets)

- **Idempotence**: `N(N(d)) == N(d)` on 500 canonical outputs (seed 0x68100001).
- **Normalization equivalence**: 25 crafted relations hold; mark normalization deterministic.
- **Unicode integrity**: every non-merge-class semantics preserved verbatim (lone-surrogate split heals to the astral char; ZWJ/combining/bidi/NFC-NFD/CRLF/tab unchanged; JSON-escaped forms equivalent).
- **SaveAnswer precedence**: exact §13 order observed, including deadline ≥ canonicalization and terminal lifecycle short-circuit (canonicalizer never invoked for voided/submitted).
- **Replay/CAS**: prior-ACK zero-write replay (byte-identical row) and correct unknown-seq CAS at L4.
- **Freeze parity**: draft/frozen/workset byte-identical; live question mutation does not leak into frozen snapshots.
- **Export**: no semantic projection masquerading as answer evidence (C7's exposure/labeling decision remains open by choice, Phase D4 — not by defect).
- **Editor round trip**: 300-case lossless; 1800-node document round-trips in <1s.
- **KaTeX security**: inert and bounded on the full corpus.
- **KaTeX malformed-source preservation (§15)**: full escaped source visible on all 4 malformed/expansion-overflow cases (Class A/A′ of PC-F08) — the frozen invariant HOLDS; only trust-gated valid input (Class B) degrades to token-only rendering.

## 9. Harness-only adjustments (Phase-C §22 compliance)

No production behavior, schema, API, DB, frontend, or authority file was touched. Harness-side deviations, all documented here:

1. **Ledger emission helper** `emitLedgerLine` (`apps/api/src/rich-phase-c/generators.ts`): the repo quality gate (`scripts/check-code-quality.mjs`) forbids `console.*` in committed files with no disable mechanism, so the harness writes its machine-readable ledger lines (`PHASE-C-B-LEDGER`, `PHASE-C-F-GROWTH`, `PHASE-C-D-PROBE`) via `process.stdout.write`.
2. **G expectations corrected during bring-up**: unsupported_version emits the canonical empty doc on first onChange (that *is* the finding, now PC-F04); unknown **inline** nodes render nothing by design, so the placeholder assertion uses an unknown **block** (the renderer's fail-closed path).
3. **D probe restructured**: `contentDocumentToTiptap` does not throw on off-grammar blocks; the test records the observation instead of asserting a throw.
4. **L corpus expectations** restructured into error-render / command-token / rendered after observing that trust-gated commands drop parsed arguments.
5. **Route wire facts** (assertion-side fixes only): save rejections are HTTP 200 + `{accepted:false, reason}`; take snapshot keys by `id`; export results carry `order`, not `questionId`; CSV quote-doubling and jsonb key reordering are accounted for in assertions.

## 10. Files changed (research artifacts committed on the research branch)

- `apps/api/src/rich-phase-c/generators.ts` — seeded generators, shrinker, structural equality, ledger emitter (harness-only).
- `apps/api/src/rich-phase-c/closureCampaign.test.ts` (A), `preflightCampaign.test.ts` (B), `equivalenceCampaign.test.ts` (C), `unicodeCampaign.test.ts` (K), `saveAnswerProtocolCampaign.test.ts` (E).
- `apps/api/src/routes/attempts/richPhaseC.replayCampaign.test.ts` (F), `richPhaseC.freezeCorruptExportCampaign.test.ts` (H/I/J).
- `apps/web/src/components/shared/content/richPhaseC.editorRoundTrip.test.ts` (D), `richPhaseC.readTrust.test.tsx` (G), `richPhaseC.katexSecurity.test.ts` (L).
- `docs/research/rich-phase-c-discovery-2026-10-02.md` — this ledger.

`PRODUCTION_CODE_CHANGED = NO` · `AUTHORITY_CHANGED = NO`

## 11. Reproduction

```bash
# API campaigns (uses the test database contract of docs/standards/testing.md §2)
cd apps/api && npx vitest run src/rich-phase-c/ \
  src/routes/attempts/richPhaseC.replayCampaign.test.ts \
  src/routes/attempts/richPhaseC.freezeCorruptExportCampaign.test.ts
# web campaigns
cd apps/web && npx vitest run \
  src/components/shared/content/richPhaseC.editorRoundTrip.test.ts \
  src/components/shared/content/richPhaseC.readTrust.test.tsx \
  src/components/shared/content/richPhaseC.katexSecurity.test.ts
# static gates
pnpm format:check && node scripts/check-code-quality.mjs
(cd apps/api && npx tsc --noEmit) && (cd apps/web && npx tsc --noEmit)
```

Last full run at base `6c50ebfe`: API 69/69, web 31/31, all gates green.

For the focused harness source review (Gate-1 follow-up item 6), the full branch patch is exported:

```bash
git diff origin/master...research/669-rich-phase-c-adversarial-discovery -- . ':(exclude)docs'   > docs/research/rich-phase-c-harness-source.patch
```

## 12. Phase-D work packages (proposals; Gate 1 review decides)

- **D1 — Allowed-input authority + closure repair** (PC-F01, PC-F02; #673 B-1): decide the authoritative structural unit (grammar-node vs raw-node vs single formulation), then repair B-F01 by an explicit product decision (deterministic split / rejection / limit adjustment — the contract deliberately does not prescribe) and re-derive preflight so it provably cannot be stricter than the legal set. Acceptance: property proof of `preflight ⊇ legal` and closure over generated corpora; route-level regression for the merge class.
- **D2 — Replay receipt implementation design** (PC-F06 observation; #673 B-2): **preserve the frozen mutable-attempt replay guarantee** — an already accepted `clientSeq` MUST NOT be silently forgotten while the Attempt remains mutable; no silent eviction, no replay window that expires inside an active Attempt. Phase D chooses a **storage representation** that satisfies the guarantee without full-payload rewrite amplification (hash/identity receipts, receipt table, physical format, migration mechanics — all implementation, NOT semantic authority). Acceptance: property/route proof that replay, conflicting-payload, and CAS semantics are unchanged (Campaign F/E rigs) and that the no-silent-eviction invariant holds for arbitrarily many saves. **If — and only if — implementation evidence shows the frozen guarantee itself must change, that is a separate authority amendment, never bundled into this repair.**
- **D3 — Persisted Rich read trust** (PC-F03/04/05, PC-F07; #673 B-3): route the candidate mount path through the shared typed classifier; give `unsupported_version`/`corrupt` non-destructive typed states (never an editable blank); add a typed unknown-block failure to the adapter. Acceptance: §7 counterexamples fail red before, pass after; corrupt never silently overwritten by autosave.
- **D4 — Export implementation contract** (Campaign J; #673 B-4/C7): the Phase-B invariant "raw evidence ≠ semantic projection; corrupt Rich is never exported as a valid Plain projection" is **already frozen and not reopened**. Phase D decides only the DTO shape, source labels, and consumer exposure for the export payload (current behavior is already coherent: raw structured evidence + projection appearing solely as question content) — e.g., labeling `candidateAnswer` as verbatim frozen evidence and/or adding an explicit validated-projection channel for consumers that need one.
- **D5 — Rendering evidence/fidelity closure** (PC-F08, classified: §15 malformed-source invariant HELD; #673 B-5): keep the trust configuration; the only open fidelity decision is the fail mode for **trust-gated but syntactically valid** commands (token-only vs source-preserving) — a product/UX choice, not a contract repair. Promote the Campaign-L real-seam corpus (with its A/A′/B classification) into the permanent suite, replacing the fallback-only test.

---

**GATE_1 = NOT_EVALUATED** (round 1 = CHANGE_REQUIRED; correction pass applied — no campaign rerun). This ledger is discovery evidence, not authority. Stop here for focused re-review; Phase D starts only after the reviewer's ACCEPT.
