# #669 Phase E — Baseline & Preconditions (§1)

Recorded: 2026-10-03, before any Phase-E work.

## Hard preconditions

1. Remote fetched: `git fetch origin --prune` — clean.
2. D1–D5.1 merge verification (all on `origin/master`):

| Phase | PR | Merge SHA | Subject |
|---|---|---|---|
| B (authority) | #685 | 6c50ebfe | docs/669-rich-semantic-contract-phase-b |
| D1 canonical write closure | #687 | 1d8bbb6a | fix/669-rich-phase-d1-canonical-closure |
| D3 read trust | #690 | a2a691c6 | fix/669-rich-phase-d3-read-trust |
| D2 replay receipts | #691 | c3713ba1 | fix/669-rich-phase-d2-replay-receipts |
| D4 export trust | #692 | 4b9bed38 | fix/669-rich-phase-d4-export-trust |
| D5 render trust + KaTeX | #693 | 01412bb8 | fix/669-rich-phase-d5-render-trust |
| D5.1 publish trust | #694 | 67079eff | fix/669-rich-d5-1-publish-trust |

3. PR #694: `gh pr view 694` → `state: MERGED`, mergedAt `2026-10-03T11:42:03Z`,
   mergeCommit `67079eff`.
4. D5.1 merge IS the current `origin/master` HEAD — no later commit touched Rich
   semantics (verified by commit listing between 67079eff and HEAD: none).

## Recorded values

```text
LIVE_MASTER     = 67079efff1eef22e95357300bf1a47b417891750
D1_MERGE_SHA    = 1d8bbb6a
D2_MERGE_SHA    = c3713ba1
D3_MERGE_SHA    = a2a691c6
D4_MERGE_SHA    = 4b9bed38
D5_MERGE_SHA    = 01412bb8
D5_1_MERGE_SHA  = 67079eff
WORKTREE_STATUS = clean except untracked .env.deploy (local deploy secrets;
                  untouched, never committed by Phase E)
BRANCH          = research/669-rich-phase-e-falsification (from 67079eff)
```

## Authority root (§2) — documents read before writing any harness

- `docs/architecture/rich-content-semantic-contract.md` (normative Rich V1
  semantic + integration authority, adopted by ADR-019 Phase-B amendment)
- `docs/adr/ADR-019-content-document-model.md` (adoption/decision record)
- Delegated authorities inspected at the seams they own: ADR-012 recovery /
  ADR-008 submit freeze (via exam-engine `saveAnswer`, `submitAttempt`,
  `buildSubmittedAnswersSnapshot` as-built), export route as-built, publish
  freeze gate as-built, KaTeX render seam as-built.
- Phase-C observations, PR descriptions, test names, and code comments are
  treated as EVIDENCE ONLY, never normative.

## Implementation authorities under test (production seams)

- Kernel: `packages/domain/src/content/contentDocument.ts` (grammar,
  `CONTENT_LIMITS`, `preflightContentDocumentStructure`,
  `checkContentDocumentLimits`, `normalizeContentDocument`,
  `plainTextProjection`, `contentDocumentsEqual`, `plainTextToDocument`,
  `isContentDocumentV1`)
- Wire: `packages/contracts/src/contentDocument.ts`
  (`ContentDocumentV1Schema` = preflight∘recursive-grammar+limits,
  `canonicalizeContentDocument`)
- Read classifiers: `packages/contracts/src/persistedRichAnswer.ts`
  (`classifyPersistedRichAnswer`), `packages/contracts/src/persistedQuestionContent.ts`
  (`classifyPersistedQuestionContent`)
- Replay identity: `packages/exam-engine/src/answerProtocol.ts`
  (`canonicalAnswerIdentity`, `processSaveAnswer`, `saveAnswer`,
  `buildSubmittedAnswersSnapshot`)
- Question write seam: `apps/api/src/routes/questionContent.ts`
  (`resolveQuestionContentWrite`, `resolveOption`, `assertRichContentUpdateAllowed`)
- Answer canonicalizer binding: `apps/api/src/lib/validateAnswerForQuestion.ts`
- Publish freeze gate: `packages/exam-engine/src/examCommands.ts`
  (`assertPublishableRichDocument`, `publishExam`, `buildQuestionSnapshot`)
- Export policy: `apps/api/src/lib/attemptExportAnswer.ts`
  (`resolveExportAnswerView`, `formatPlainExportValue`)
- Editor adapter: `apps/web/src/components/shared/content/contentAdapter.ts`
- Render trust: `apps/web/src/components/shared/content/ContentRenderer.tsx`,
  `MathRenderer.tsx`, `katexRender.ts`
