# #669 Phase E — Counterexample Ledger (§33–35)

One entry per falsified contract clause, in discovery order. Each entry is
reproducible from its harness test + command; the evidence JSON artifacts in
`results/` carry the recorded run data. Vocabulary: Gate-1 evaluates
RICH_PROTOCOL_BACKEND_SOUND as strict PASS / FAIL / BLOCKED — a PASS requires
every campaign green AND zero open counterexamples.

Status legend: OPEN (falsified, unrepaired — §41 forbids production repair
during Phase E) / REPAIRED (post-Gate fix landed with a regression test) /
WAIVED (adjudicated as contract-legal divergence, with the clause citation).

## D-F01 — authority-accepted Rich answer bearing U+0000 dies at the SaveAnswer wire (HTTP 500)

- STATUS: OPEN
- DISCOVERED: 2026-10-04, Campaign D (L4, real PostgreSQL, SaveAnswer wire)
- FALSIFIED CLAUSE: semantic contract §6 durability obligation behind E-WR01's
  Campaign-D reachability — every answer the production authorities accept
  must be accepted by the wire and durably round-trip. The authorities
  (ContentDocumentV1Schema + canonicalizeContentDocument) ACCEPT the document;
  the wire answers HTTP 500 INTERNAL_ERROR instead of persisting it or
  rejecting it with a structured category.
- PREMISE (verified in-test):
  `{docVersion:1,type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"a\u0000b"}]}]}`
  passes `ContentDocumentV1Schema.safeParse` and `canonicalizeContentDocument`
  (both authorities are NUL-blind; the grammar and CONTENT_LIMITS place no
  restriction on U+0000 inside text runs).
- OBSERVED:
  - POST /api/attempts/:id/answers/:qid → HTTP 500, body
    `{"error":{"code":"INTERNAL_ERROR","message":"服务器内部错误",...}}`.
  - Root cause (as-built reading): `attempts.answers` is a `jsonb` column
    (`packages/db/src/schema/pg.ts:565`); PostgreSQL cannot encode U+0000 in
    jsonb text, so the accepted-canonical write fails at the driver/SQL layer
    — after canonicalization, after the CAS check, inside the protocol
    transaction. No upstream layer owns a rejection category for it.
  - CONTAINMENT HELD: the transactional write left no partial state — the
    slot still serves the previous canonical answer at the same version, and
    the failed save leaked no replay receipt (a legal write reusing the same
    clientSeq is accepted fresh at v+1).
- IMPACT: a Candidate whose (legal) answer contains U+0000 gets a 500 instead
  of a save; the answer is lost client-side. Editing surfaces that let NUL in
  (paste of control characters) make this reachable in principle; the same
  jsonb representability gap presumably applies to every other jsonb Rich
  write seam (question create/update, publish freeze gate) — Campaigns O/Q
  sweep the cross-seam spread.
- Q EXTENSION (2026-10-04, Campaign Q): an UNPAIRED SURROGATE (`\uD83D`, not
  valid UTF-8) in a text run fails identically — HTTP 500 INTERNAL_ERROR at
  the SaveAnswer wire, containment held. The family is "authority-accepted
  value outside the durable store's representable set": U+0000 and unpaired
  surrogates both. The rest of the shared Unicode corpus (12 entries: CJK,
  astral, ZWJ emoji, combining, bidi, separators, control chars ≠ NUL, tabs)
  round-trips byte-deep with stable identity (`results/Q-unicode-roundtrip-*.json`).
- BLAST RADIUS (characterized 2026-10-04): the failed write does NOT poison
  the pool persistently — after 5 consecutive NUL-500s, 40 sequential GETs
  were all 200 and a subsequent save was accepted. One TRANSIENT
  503 AUTHZ_UNAVAILABLE was observed in 3 early harness runs immediately
  after the first NUL-500 and never recurred across instrumented runs
  (instrumentation kept in `harness/Q-unicode-roundtrip.test.ts`
  `observedGet`); registered in `docs/standards/test-flakes.md` as a
  low-recurrence transient pending a second sample.
- EVIDENCE:
  - Test: `harness/D-durable-roundtrip.test.ts` → "DOCUMENTED COUNTEREXAMPLE
    D-F01 …" (pins the 500 + containment + receipt-leak probe)
  - Run log: `results/run-2026-10-04-a2g-d.log`
  - Reproduce: `cd docs/research/exam-669-rich-phase-e-1 && npx vitest run
    harness/D-durable-roundtrip.test.ts`
- §41 DISCIPLINE: recorded, not repaired. Repair (post-Gate candidate):
  either the grammar/normalization rejects control characters at the write
  authority (shrinking the legal set — a contract change), or the save path
  gains a structured INVALID_ANSWER category for values the durable store
  cannot represent. Both are production decisions outside Phase E.

## Prior-phase counterexample continuity replays (§33–35, 2026-10-04)

All pinned regression suites for earlier-phase counterexamples were re-run on
the current tree (research branch head, no production changes) and stayed
green — the earlier repairs hold; no prior counterexample class reopened:

| Suite | Files | Result |
| --- | --- | --- |
| domain contentDocument (PC-F01 canonical-closure class, limits) | `packages/domain/src/content/contentDocument.test.ts` | 24/24 |
| contracts authority stack (PC-F01/F02 classifier regressions, canonicalize idempotence, persisted question content) | `contentDocument.test.ts`, `persistedRichAnswer.test.ts`, `persistedQuestionContent.test.ts` | 50/50 |
| exam-engine (D5.1 publish-gate regressions, replay receipts) | `examCommands.test.ts`, `saveAnswerReceipts.test.ts` | 91/91 |
| api Rich closure + save protocol (PC-F02/D2) | `answerRichClosure.test.ts`, `questionRichContent.test.ts`, `validateAnswerForQuestion.test.ts`, `saveAnswerReceiptsD2.test.ts` | 37/37 |
| web read-trust regressions | `contentAdapter.test.ts`, `RichTextAnswerInput.readTrust.test.tsx`, `MathRenderer.evidence.test.tsx`, `QuestionRenderer.test.tsx` | 53/53 |
| db migration 0044 (answer save receipts) | `0044-answer-save-receipts.test.ts` | 8/8 |

Evidence: `results/run-2026-10-04-replay-pcf-d51.log` (263 tests total).
