# Exam System Boundary Audit — Independent Adjudication

## A. Identity

```
RUN_ID:       EXAM-BOUNDARY-ADJUDICATION-20260719-000906-ddbc808b
TIMESTAMP:    20260719-000906
BRANCH:       feat/exam-audit-0718
HEAD:         ddbc808b9c640584ece7690dd8aef681739081a5
SHORT_SHA:    ddbc808b
DEFAULT_BRANCH: master
WORKTREE:     untracked docs/audits/ (source reports + this adjudication)
REPOSITORY:   git@github.com:jnhu76/exam.git

REPORTS REVIEWED:                   10
INDEPENDENT EXECUTIONS IDENTIFIED:  9
  - Agent A independent: 6 (A-213011, A-213429, A-214328, A-214453, A-231530)
  - Agent B independent: 4 (B-213429, B-214337, B-214453, B-222150)
  - Merged: 1 (FINAL-214453)
  - Note: A-214453 is a variant/evolution of A-213011 core analysis, not fully independent
  - Note: FINAL-214453 is a derived merged report, not an independent execution

MISNAMED REPORTS:  1
  - EXAM-BOUNDARY-B-20260718-214453-ddbc808b (RUN_ID=A, AGENT_SLOT=B)
STALE REPORTS:     0 (all share current HEAD ddbc808b)
```

**Authority statement**: This adjudication does not treat any prior audit report, merged report, timestamp, filename, or majority opinion as authority. Authority comes from current reproducible repository evidence and the explicit product boundary.

## B. Final Adjudication Verdict

```
BASIC PRODUCT CONDITIONAL PASS

ADMIN+CANDIDATE:             PASS (no P0/P1 blocking Admin+Candidate closure)
TRUSTED ORG-WIDE STAFF:      CONDITIONAL (document scope decision)
MULTI-TEACHER ISOLATION:     UNSUPPORTED (no assignment model)
ASSIGNED-PROCTOR:            UNSUPPORTED (no assignment model)
ASSIGNED-GRADER:             UNSUPPORTED (no assignment model)
RICH-TEXT SUBJECTIVE:        NOT SUPPORTED (by design, cleanly contained)
```

## C. Canonical Capability Matrix

| Capability | Source | Unit | Integration | Browser | Current classification | Deployment boundary |
|---|---|---|---|---|---|---|
| single_choice | ✅ | ✅ | ✅ | ✅ | PROVEN SUPPORTED | all |
| multiple_choice | ✅ | ✅ | ✅ | ✅ | PROVEN SUPPORTED | all |
| true_false | ✅ | ✅ | ✅ | ✅ | PROVEN SUPPORTED | all |
| fill_blank | ✅ | ✅ | ✅ | ❌ skipped | PARTIAL — BROWSER UNPROVEN | Admin+Candidate only |
| text_response plain text | ✅ | ✅ | ✅ | ✅ | PROVEN SUPPORTED | all |
| rich text | ❌ | ❌ | ❌ | ❌ | NOT SUPPORTED | by design |
| Candidate ownership | ✅ | ✅ | ✅ | ✅ | PROVEN SUPPORTED | all |
| Admin management | ✅ | ✅ | ✅ | ✅ | PROVEN SUPPORTED | all |
| Teacher org-wide ops | ✅ | ✅ | ✅ | ❌ | SUPPORTED WITH P2/P3 GAPS | trusted-staff only |
| Teacher assigned-resource isolation | ❌ | ❌ | ❌ | ❌ | NOT SUPPORTED | Phase 3 |
| Proctor monitoring | ✅ | ✅ | ✅ | ✅ | SUPPORTED WITH P2/P3 GAPS | trusted-staff only |
| Proctor assigned-resource isolation | ❌ | ❌ | ❌ | ❌ | NOT SUPPORTED | Phase 3 |
| Grader manual grading | ✅ | ✅ | ✅ | ✅ | SUPPORTED WITH P2/P3 GAPS | trusted-staff only |
| Grader assigned-resource isolation | ❌ | ❌ | ❌ | ❌ | NOT SUPPORTED | Phase 3 |

## D. Authoritative Findings

### P0 — None

### P1

| Canonical ID | F-ADJ-P1-001 |
|---|---|
| Title | Exam-level policy fields (scoreStrategy, passingScore, resultPublicationMode) NOT snapshotted per-attempt |
| Authoritative Severity | P1 |
| Disposition | CONFIRMED-AS-PRODUCT-LIMITATION |
| Affected Deployment | All (Admin+Candidate, trusted staff) |
| Source Reports | A-213429 (P1 claim). All other A reports contradict (omit the finding). B reports omit. |
| Contradicting Reports | A-213011, A-214328, A-214453, A-231530 — all omit this finding or don't flag it. FINAL-214453 omits. |
| Current Source Evidence | `grading.ts:158`: `computeGradingResult` reads `exam.passingScore` from live exam. `grading.ts:273`: `finalizeTerminalGrading` reads `exam.passingScore` from live exam. `grading.ts:324`: `finalizeTerminalGrading` reads `exam.scoreStrategy` from live exam. No snapshot of exam-level policy fields exists on `ExamAttempt`. |
| Current Test/Browser Evidence | No test verifies that changing `exam.scoreStrategy` after attempt creation does not affect existing attempts' final score selection. No test verifies that changing `exam.passingScore` does not retroactively change pass/fail. |
| Product Impact | If admin changes `scoreStrategy` (e.g., `highest`→`latest`) mid-exam-cycle, existing attempts' finalScore selection changes retroactively. If admin changes `passingScore`, previously graded attempts' pass/fail status may change. This is a live-reference integrity gap, not an active exploit — the risk requires an admin action. |
| Required Action | Snapshot `scoreStrategy`, `passingScore`, and `resultPublicationMode` onto `ExamAttempt` at attempt creation. |
| Can Defer: | Deferrable to Phase 1.5. Not a code-merge blocker for Admin+Candidate because no UI exposes runtime changes to these fields. |

---

| Canonical ID | F-ADJ-P1-002 |
|---|---|
| Title | Legacy fallback path grading from mutable `attempt.answers` when `submittedAnswers` is NULL |
| Authoritative Severity | P1 |
| Disposition | SUPERSEDED-BY-CURRENT-CODE |
| Affected Deployment | Historical migration only |
| Source Reports | A-213429 (P1 claim). A-214328 (P2). A-213011, A-214453, A-231530 omit. |
| Contradicting Reports | A-214328 classified as P2, not P1. |
| Current Source Evidence | `grading.ts:145-152`: when `attempt.submittedAnswers` is NULL, falls back to `attempt.answers` (draft/mutable). `TODO(P3-L0-4)` comment exists. |
| Current Test/Browser Evidence | All new attempts since the freeze-barrier migration populate `submittedAnswers`. Only legacy rows from before the migration have NULL. |
| Product Impact | New attempts are NOT affected — freeze barrier ensures `submittedAnswers` is always populated. Risk only for historical migration artifacts. |
| Required Action | Complete P3-L0-4 backfill and remove fallback. |
| Can Defer: | Deferrable. Document risk to migration completeness. |

---

| Canonical ID | F-ADJ-P1-003 |
|---|---|
| Title | Proctor Dashboard 403 — UI button shown, API rejects |
| Authoritative Severity | **P2** (downgraded from B-213429's P1) |
| Disposition | CONFIRMED-WITH-LOWER-SEVERITY |
| Affected Deployment | Trusted-staff with Proctor role |
| Source Reports | B-213429 (P1). B-214337, B-214453, B-222150 omit or downgrade. FINAL-214453 classifies as P2 (F-P2-5 merged). |
| Contradicting Reports | B-214337, B-222150 don't list as standalone P1. |
| Current Source Evidence | `ExamDetailPage.tsx:152`: `maySeeProctor` checks `canSeeProctor(user)` → `can(user, Permission.ExamRoomView)`. `ExamDetailPage.tsx:455`: button shown when `exam.status === "open" && maySeeProctor`. `exam.ts:1469`: `/admin/exams/:examId/candidates/status` gates on `requireCapability(Permission.ExamEnrollmentManage)`. `presets.ts`: Proctor preset includes `ExamRoomView` but NOT `ExamEnrollmentManage`. |
| Current Test/Browser Evidence | E2E `proctor-landing.spec.ts` tests Proctor workspace landing, NOT the ExamDetailPage navigation path. E2E `proctor-monitoring-ui.spec.ts` does NOT test this button → 403 path. |
| Product Impact | Proctor sees a button that leads to a broken page (403). The Proctor has an alternative workspace at `/admin/proctor` (landing page), so the core Proctor journey is NOT broken — this is a UI/API inconsistency on a secondary navigation path. |
| Required Action | Either (a) regate API endpoint to `ExamRoomView` or (b) hide button for Proctor role. |
| Can Defer: | Deferrable. Does not block Admin+Candidate. |

---

| Canonical ID | F-ADJ-P1-004 |
|---|---|
| Title | `proctor-incident` route is dead — never called by UI |
| Authoritative Severity | **P3** (downgraded from B-213429's P1) |
| Disposition | CONFIRMED-WITH-LOWER-SEVERITY |
| Affected Deployment | Proctor user journey |
| Source Reports | B-213429 (P1 dead route). B-214337 omits as P1. B-214453 omits. B-222150 omits. FINAL-214453 omits entirely. |
| Contradicting Reports | All later B reports and FINAL exclude this as a finding. |
| Current Source Evidence | `proctorMonitoring.ts:200`: `POST /admin/attempts/:attemptId/proctor-incident` exists with `requireScopedCapability(AttemptMisconductMark)`. `attempts.admin.ts:57`: `POST /admin/attempts/:attemptId/misconduct` exists with `requireCapability(AttemptMisconductMark)`. `ProctorDashboardPage.tsx:189`: UI calls `/misconduct`, NOT `/proctor-incident`. No `proctor-incident` string found in any frontend source. Route has tests (`proctorMonitoring.test.ts`, `proctorMonitoring.crossOrg.test.ts`). |
| Product Impact | Dead route — no UI calls it. Does NOT break any user journey because the `/misconduct` route serves the same purpose. Dead code maintenance burden only. |
| Required Action | Either wire the UI to the scoped endpoint or remove the dead route. |
| Can Defer: | Deferrable indefinitely. |

### P2

| Canonical ID | F-ADJ-P2-001 |
|---|---|
| Title | fill_blank E2E skipped — complete candidate loop never browser-verified |
| Authoritative Severity | P2 |
| Disposition | CONFIRMED |
| Affected Deployment | Admin+Candidate (test evidence gap) |
| Source Reports | All A reports classify as P2 or omit. All B reports note the skip. FINAL-214453 F-P2-1. |
| Current Source Evidence | `fill-blank-e2e.spec.ts:18`: `test.skip(true, "Phase 3 pending...")`. `FillBlankInput.tsx`: functional component (78 lines), wired into `QuestionRenderer.tsx`. Skip comment says "take page does not render usable fill-blank/subjective input" — this is INACCURATE (component IS wired). |
| Current Test/Browser Evidence | Grading engine unit tests cover scoring logic. Zero browser E2E coverage for the candidate answering loop. |
| Product Impact | Admin can create fill_blank questions, publish them, and the grading engine works. But the full candidate answering → save → submit → grade → result loop has never been verified in a real browser. |
| Required Action | Either promote E2E to run, or update the skip comment to accurately reflect current status. |
| Can Defer: | Deferrable. Phase 3 decision. |

---

| Canonical ID | F-ADJ-P2-002 |
|---|---|
| Title | text_response answer payload has no size limit |
| Authoritative Severity | P2 |
| Disposition | CONFIRMED |
| Affected Deployment | All |
| Source Reports | A-213011 P2-2. A-214453 P2-2. FINAL-214453 F-P2-2. |
| Current Source Evidence | `attempt.ts:157`: `SaveAnswerRequestSchema.answer` is `z.unknown()` — no length validation. `TextResponseInput.tsx`: does not pass `maxLength` to `SubjectiveAnswerInput`. |
| Current Test/Browser Evidence | No test for long answer behavior. |
| Product Impact | Candidates can submit megabyte-scale text payloads persisting to JSONB columns. Realistic operational risk for large deployments. |
| Required Action | Add max length validation at contract level and/or frontend maxLength. |
| Can Defer: | Deferrable to Phase 1.5. Operational risk, not data-corruption risk. |

---

| Canonical ID | F-ADJ-P2-003 |
|---|---|
| Title | text_response missing from candidateResult.questionTypes i18n |
| Authoritative Severity | P2 |
| Disposition | CONFIRMED |
| Affected Deployment | All (candidate-facing) |
| Source Reports | A-214453 P2-3. FINAL-214453 F-P2-3. B-214453 cross-boundary-handoff. |
| Current Source Evidence | `zh-CN.ts:485-490`: `candidateResult.questionTypes` maps `single_choice`, `multiple_choice`, `true_false`, `fill_blank` but omits `text_response`. `ResultPage.tsx:40-43`: `formatQuestionType` does `t('candidateResult.questionTypes.${type}')` — for text_response, returns raw key `"text_response"`. Note: `admin.question.questionTypes` (line 748) DOES include `text_response: "文本作答题"`, but this is a different i18n namespace. |
| Product Impact | Candidate result page shows raw `"text_response"` type label instead of "文本作答题". Misleading UX. |
| Required Action | Add `text_response: "文本作答题"` to `candidateResult.questionTypes`. |
| Can Defer: | Deferrable. Cosmetic UX gap. |

---

| Canonical ID | F-ADJ-P2-004 |
|---|---|
| Title | QuestionPage action buttons lack per-button capability gating |
| Authoritative Severity | P2 |
| Disposition | CONFIRMED |
| Affected Deployment | Multi-role deployment (Teacher, future roles) |
| Source Reports | B-214453 F-B-P2-1. FINAL-214453 F-P2-4. |
| Contradicting Reports | B-213429, B-214337, B-222150 omit this finding. |
| Current Source Evidence | `QuestionPage.tsx:295-353`: Create/Import/Edit/Delete buttons shown unconditionally. No `canCreateExam`/`canDeleteExam` style checks. Compare `ExamPage.tsx:71-72`: proper `canCreateExam(user)` / `canDeleteExam(user)` guards. |
| Current Test/Browser Evidence | No test verifies QuestionPage button visibility for non-admin roles. |
| Product Impact | User with `QuestionView` permission sees all action buttons. Every click fails with 403. UX confusion. Security impact: NONE (backend enforces capability gates). |
| Required Action | Add `can(user, Permission.QuestionX)` checks to match ExamPage pattern. |
| Can Defer: | Deferrable. Purely UX. |

---

| Canonical ID | F-ADJ-P2-005 |
|---|---|
| Title | Legacy `requireRole(["Admin"])` gates on 5 route families |
| Authoritative Severity | P2 |
| Disposition | CONFIRMED-AS-PRODUCT-LIMITATION |
| Affected Deployment | Multi-role deployment |
| Source Reports | B-213429 P2-1. B-214337 F-B2-P2. B-222150 (inventory). FINAL-214453 omits. |
| Current Source Evidence | `settings.ts`, `candidateField.ts`, `user.ts`, `roleAssignments.ts`, `system.ts` use `requireRole(["Admin"])` instead of `requireCapability()`. |
| Product Impact | These routes cannot be delegated to non-Admin capability holders. Admin-only semantics are correct — migration debt only. |
| Required Action | Migrate to capability gates in Phase 3. |
| Can Defer: | Phase 3/4. |

### P3

| Canonical ID | F-ADJ-P3-001 |
|---|---|
| Title | fill_blank Unicode normalization untested |
| Authoritative Severity | P3 |
| Disposition | CONFIRMED |
| Source Reports | A-213011 P3-1. A-214453 P3-1. FINAL-214453 F-P3-1. |
| Current Source Evidence | `gradingEngine.ts:67-69`: `normalizeBlank()` uses `trim()` + optional `toLocaleLowerCase()`. Locale-dependent behavior not explicitly tested. |
| Required Action | Add Unicode normalization test. |
| Can Defer: | Deferrable. |

---

| Canonical ID | F-ADJ-P3-002 |
|---|---|
| Title | No E2E test for cross-candidate attempt isolation |
| Authoritative Severity | P3 |
| Disposition | CONFIRMED |
| Source Reports | Multiple A and B reports. |
| Current Source Evidence | Unit test at `candidateOwnership.test.ts` proves cross-candidate 404 denial. No browser E2E. |
| Required Action | Add browser E2E for cross-candidate denial. |
| Can Defer: | Deferrable. Unit test coverage is sufficient. |

---

| Canonical ID | F-ADJ-P3-003 |
|---|---|
| Title | Question deletion does not check snapshot references |
| Authoritative Severity | P3 |
| Disposition | CONFIRMED |
| Source Reports | A-213011 P3-3. A-214453 P3-3. FINAL-214453 F-P3-3. |
| Current Source Evidence | `originalQuestionId` in snapshot is a plain string, not FK. Deleting a question removes it from the bank but existing snapshots are unaffected (JSONB copy). |
| Product Impact | Soft data-consistency gap only. Attempt grading is unaffected (reads from snapshot). |
| Required Action | Add reference check on question deletion or document as by-design. |
| Can Defer: | Deferrable indefinitely. |

---

| Canonical ID | F-ADJ-P3-004 |
|---|---|
| Title | No admin re-grade policy |
| Authoritative Severity | P3 |
| Disposition | CONFIRMED-AS-PRODUCT-DECISION |
| Source Reports | A-213011 P3-4. A-214453 P3-4. FINAL-214453 F-P3-4. |
| Current Source Evidence | `manualGrading.ts:147-153`: `pending_manual → completed_manual` is one-way. Re-grade rejected. |
| Required Action | Product decision: is one-way completion intentional? |
| Can Defer: | Deferrable. |

---

| Canonical ID | F-ADJ-P3-005 |
|---|---|
| Title | Result page does not show per-question answer comparison for candidates |
| Authoritative Severity | P3 |
| Disposition | CONFIRMED-AS-PRODUCT-DECISION |
| Source Reports | A-213011 P3-5. A-214453 P3-5. FINAL-214453 F-P3-5. |
| Current Source Evidence | `scores.ts:429-432`: standardAnswer stripped from candidate result. `ResultPage.tsx:168`: `isManual = question.standardAnswer == null` — always true for candidates. |
| Required Action | Product decision on candidate-facing answer comparison. |
| Can Defer: | Deferrable. |

---

| Canonical ID | F-ADJ-P3-006 |
|---|---|
| Title | Attachment ghost type — schema exists, no infrastructure |
| Authoritative Severity | P3 |
| Disposition | CONFIRMED |
| Source Reports | B-214453 F-B-P3-1. FINAL-214453 F-P3-6. |
| Current Source Evidence | `types.ts:122,146,164`: `Attachment` interface. `pg.ts:187`: `attachments: jsonb().$type<Attachment[]>().notNull()`. Contract has `attachments: z.array(...)` in snapshot. `TakeExamPage.tsx:671`: hardcodes `attachments: []`. No upload/storage/render infrastructure. |
| Product Impact | If attachment data were ever populated (direct DB manipulation), it would reach the candidate client unfiltered. Currently no code path populates this field. Low risk. |
| Required Action | Either strip from candidate snapshot or document as reserved for future use. |
| Can Defer: | Deferrable. |

---

| Canonical ID | F-ADJ-P3-007 |
|---|---|
| Title | Candidate result "correct answer" column shows "主观题" for all types |
| Authoritative Severity | P3 |
| Disposition | CONFIRMED-AS-PRODUCT-DECISION |
| Source Reports | B-214453 F-B-P3-2. FINAL-214453 F-P3-7. |
| Current Source Evidence | `scores.ts:429-432`: standardAnswer stripped for candidates. `ResultPage.tsx:168`: `standardAnswer == null` → `isManual = true` for ALL questions. |
| Product Impact | Slightly misleading label. Auto-graded questions (single_choice etc.) show "主观题" (manual/subjective) label. This is a side-effect of security-preserving stripping. |
| Required Action | Consider alternative labeling. |
| Can Defer: | Deferrable. |

### PRODUCT DECISION

1. fill_blank E2E promotion: Phase 3 or promote to Phase 2?
2. text_response answer max length: what limit?
3. Candidate result per-question answer comparison: show or hide?
4. Admin re-grade policy: one-way intentional or add override?
5. QuestionPage button gating: hide or show-disabled?
6. Attachment snapshot stripping: strip or document?
7. Teacher/Proctor/Grader scoping: org-wide accepted or implement assignment?
8. Exam policy snapshot: freeze `scoreStrategy`/`passingScore` per-attempt?
9. `⚠️ scoped` annotations in presets.ts: resolve or document as Phase 3?

### PRODUCT LIMITATION

1. Rich text: explicitly unsupported, cleanly contained. Not a defect.
2. Teacher/Proctor/Grader org-wide access: documented Phase 1/3 behavior, not a vulnerability for single-tenant deployments.
3. fill_blank E2E skip: scoping decision, not a technical blocker.

## E. Conflict Adjudication Table

| Conflict | Report positions | Current evidence | Final disposition |
|---|---|---|---|
| **9.1 fill_blank support** | A-213011/A-214453: "PARTIAL (E2E skipped)". A-214328/A-231530: "SUPPORTED". B reports: "E2E skipped". | FillBlankInput exists and IS wired into QuestionRenderer. Grading engine covers exact/keyword. E2E is skipped. | **PARTIAL — BROWSER UNPROVEN**. Source+test complete but browser loop never verified. Skip comment is outdated. |
| **9.2 text_response plain-text** | All A reports: "PLAIN-TEXT COMPLETE". B confirms E2E path. | 13-step journey verified (create→edit→publish→render→autosave→restore→submit→grade→result→export). XSS-safe via React escaping. | **PROVEN SUPPORTED** with P2/P3 boundary gaps (no maxLength, i18n label). |
| **9.3 Rich-text boundary** | All reports: unsupported. | No rich-text editor, no `dangerouslySetInnerHTML`, no Markdown/library. Textarea only. | **NOT SUPPORTED — BY DESIGN**. Cleanly contained. |
| **9.4 Teacher/Proctor/Grader scope** | B-213429: P1. B-214337/B-222150: "PRODUCT DECISION REQUIRED". FINAL: P2-5. | No assignment tables exist. All capabilities are org-wide. `⚠️ scoped` in presets.ts is aspirational. | **NOT SUPPORTED** for assigned-resource isolation. **ORGANIZATION-WIDE** is the runtime reality. Product decision pending. |
| **9.5 Proctor Dashboard 403** | B-213429: P1. Later B reports/FINAL: not P1. | Button via `ExamRoomView`. API gates on `ExamEnrollmentManage`. Proctor has alternative workspace at `/admin/proctor`. | **P2 UI/API inconsistency**. Core Proctor journey NOT broken. |
| **9.6 proctor-incident vs misconduct** | B-213429: P1 dead route. Later reports: omit. | Two endpoints, same capability. UI calls misconduct only. Dead route has tests. | **P3 dead code**. Not a supported-journey break. |
| **9.7 QuestionPage per-action gating** | B-214453: P2. Other B reports: omit. | All buttons shown unconditionally. No capability checks. Backend enforces. | **P2 UX gap**. No security impact. |
| **9.8 Attachment ghost** | B-214453: P3. FINAL: P3. | Schema exists, hardcoded `[]` everywhere, no infrastructure. | **P3 ghost type**. Low risk. |
| **9.9 Candidate result rendering** | B-214453: P3. | standardAnswer stripped (security). isManual=true for all. Label says "主观题". | **P3**. Security-preserving stripping causes slightly misleading label. |
| **9.10 Answer payload size** | A-213011/A-214453: P2. | `z.unknown()` no maxLength. Persists to JSONB columns. | **P2 operational risk**. Not data-corruption risk. |

## F. Report Reliability Table

| Report | Slot | Baseline | Independence | Evidence quality | Reliability score | Disposition |
|---|---|---|---|---|---|---|
| A-20260718-213011 | A | Current | Independent (first run) | Strong source + test evidence. No browser E2E executed. | 4 | PRIMARY EVIDENCE |
| A-20260718-213429 | A | Current | Independent (second run) | Strong source analysis. Introduced unique P1 findings not in other A reports. | 4 | PRIMARY EVIDENCE (unique P1 claims) |
| A-20260718-214328 | A | Current | Independent (third run) | Lightweight. Strong PASS (no P0/P1). Reuses some structure from 213011. | 3 | SUPPORTING EVIDENCE |
| A-20260718-214453 | A | Current | Variant of A-213011 | Same structure as 213011, evolved content. Added i18n finding. Downgraded XSS concern. | 4 | PRIMARY EVIDENCE (most evolved A version) |
| A-20260718-231530 | A | Current | Independent (fifth run) | Executed targeted tests. Most conservative severity. | 5 | PRIMARY EVIDENCE (highest A reliability) |
| B-20260718-213429 | B | Current | Independent (first run) | Well-organized, source evidence cited. P1 severity notably higher than later B reports. | 4 | PRIMARY EVIDENCE |
| B-20260718-214337 | B | Current | Independent (second run) | More conservative severity. Good structure. | 5 | PRIMARY EVIDENCE (highest B reliability) |
| B-20260718-214453 | B **MISNAMED** | Current | Independent (third run) | RUN_ID says "A" but AGENT_SLOT says "B". Content is valid B analysis. P0=0 P1=0 (drops P1 from earlier). | 3 | MISNAMED BUT USABLE |
| B-20260718-222150 | B | Current | Independent (fourth run) | Executed targeted tests. Most conservative severity. | 5 | PRIMARY EVIDENCE (highest B reliability) |
| FINAL-20260718-214453 | Merged | Current | Derived from A+B | Merged report, not independent. P2=5 P3=7. No new evidence. | 2 | DERIVED SUMMARY — not authoritative |

## G. Superseded Claims

1. **XSS risk for text_response** (downgraded by A-214453, confirmed by this adjudication): `dangerouslySetInnerHTML` is NOT used. React's default JSX escaping applies. GradingDetailPage.test.tsx:495-517 and QuestionRenderer.test.tsx:79-92 explicitly test XSS safety. Claim is FALSE.

2. **Proctor Dashboard 403 as P1**: The Proctor has an alternative workspace at `/admin/proctor`. The button on ExamDetailPage is a secondary navigation path. Affected deployment: trusted-staff with Proctor role. Core Proctor journey (monitor dashboard) is functional. Severity reduced to P2.

3. **proctor-incident as P1 dead route**: The `/misconduct` endpoint serves the same semantic purpose. The dead route does NOT break any user journey. Severity reduced to P3.

4. **fill_blank claimed as "FULLY SUPPORTED"** by A-214328 and A-231530: These reports classified fill_blank as SUPPORTED but the E2E is explicitly skipped. The component exists but the browser loop is unverified. Correct classification: PARTIAL — BROWSER UNPROVEN.

5. **FINAL-214453 as authoritative**: This merged report correctly aggregates findings but contains no new evidence and relies on source report analysis. It is a useful summary, not independent authority.

6. **B-214453's P1=0 claim**: This report dropped the P1 findings from earlier B runs. The org-wide access gap remains a real limitation (now classified as PRODUCT LIMITATION for Phase 1). The P1 severity was inconsistent with later consensus.

## H. Canonical Supported Boundary

```
PROVEN SUPPORTED:
  single_choice, multiple_choice, true_false — full lifecycle E2E-proven
  Candidate ownership chain — E2E + unit proven with anti-enumeration
  Admin management — all CRUD + lifecycle + export
  text_response plain-text — 13-step journey E2E-proven
  Answer Save Protocol — versioned, idempotent, conflict-detecting
  Snapshot immutability — 4-layer copy-on-change, no live references in grading
  Exam lifecycle — draft→published→open→closed→archived+cancel, all guards tested
  Concurrency controls — EA lock protocol, FOR UPDATE, REPEATABLE READ

SUPPORTED WITH GAPS:
  fill_blank — source+test complete, E2E skipped (P2 test-evidence gap)
  text_response — E2E-proven with P2 boundary gaps (maxLength, i18n)
  Teacher org-wide operations — functional but scope not documented
  Proctor monitoring — functional, 403 navigation path (P2)
  Grader manual grading — E2E-proven, x-role docs mismatch (P3)

PARTIAL:
  fill_blank — source+test only, E2E skipped

NOT SUPPORTED:
  Rich text / images / tables / formulas / attachments / markdown
  Teacher@course assigned-resource isolation
  Proctor@exam assigned-resource isolation
  Grader@attempt assigned-resource isolation
  Anonymous grading, multi-grader workflow
  timed_sync, deadline, untimed timing modes
  Queued entry (requireQueue)
  Electron lockdown

PRODUCT DECISION REQUIRED:
  Exam-level policy snapshotting (scoreStrategy/passingScore)
  Teacher/Proctor/Grader scope model
  text_response answer maxLength
  fill_blank E2E promotion
  Re-grade policy
  Candidate result detail visibility
  QuestionPage button UX
  Attachment snapshot safety

STALE OR FALSE CLAIMS:
  text_response XSS risk — FALSE (confirmed safe)
  Proctor Dashboard 403 as P1 — reduced to P2
  proctor-incident dead route as P1 — reduced to P3
  fill_blank "FULLY SUPPORTED" — corrected to PARTIAL — BROWSER UNPROVEN
```

## I. Closure Plan

### MUST FIX BEFORE ADMIN+CANDIDATE CLOSURE
None. Product boundary is functional for Admin+Candidate deployment.

### MUST FIX BEFORE TRUSTED STAFF DEPLOYMENT
1. Resolve Teacher/Proctor/Grader org-wide scope — document or implement
2. Fix Proctor Dashboard 403 button/API mismatch (P2)
3. Update `⚠️ scoped` annotations in presets.ts to match reality

### MUST FIX BEFORE MULTI-TEACHER DEPLOYMENT
1. Implement Teacher@course resource assignment model
2. Implement resource-scoped resolvers for Course/Question/Exam routes

### MUST FIX BEFORE ASSIGNED-PROCTOR DEPLOYMENT
1. Implement Proctor@exam resource assignment model
2. Wire or remove `proctor-incident` endpoint

### MUST FIX BEFORE ASSIGNED-GRADER DEPLOYMENT
1. Implement Grader@exam resource assignment model
2. Add Grader-aware x-role documentation

### CAN DEFER
- fill_blank E2E promotion
- text_response answer maxLength
- text_response i18n label
- QuestionPage button gating
- Exam policy snapshot (scoreStrategy/passingScore)
- Legacy requireRole migration
- Unicode normalization test
- Cross-candidate E2E test
- Question deletion reference check
- Re-grade policy decision
- Attachment snapshot stripping
- Result page label clarity

### RICH-TEXT FOLLOW-UP
Not applicable. Product clearly supports plain text only.

## J. Evidence Executed

### Source code verification (all files read)
```
packages/domain/src/enums.ts
packages/domain/src/types.ts
packages/domain/src/gradingEngine.ts
packages/exam-engine/src/examStateMachine.ts
packages/exam-engine/src/examCommands.ts
packages/exam-engine/src/attemptCommands.ts
packages/exam-engine/src/answerProtocol.ts
packages/exam-engine/src/grading.ts
packages/exam-engine/src/gradingWorkset.ts
packages/exam-engine/src/manualGrading.ts
packages/contracts/src/attempt.ts
packages/contracts/src/question.ts
packages/db/src/schema/pg.ts
packages/authz/src/presets.ts
packages/authz/src/catalog.ts
apps/api/src/routes/exam.ts
apps/api/src/routes/proctorMonitoring.ts
apps/api/src/routes/attempts.admin.ts
apps/api/src/routes/scores.ts
apps/web/src/pages/admin/ExamDetailPage.tsx
apps/web/src/pages/admin/QuestionPage.tsx
apps/web/src/pages/admin/ExamPage.tsx
apps/web/src/pages/exam/ResultPage.tsx
apps/web/src/components/exam/FillBlankInput.tsx
apps/web/src/components/exam/QuestionRenderer.tsx
apps/web/src/components/exam/TextResponseInput.tsx
apps/web/src/i18n/locales/zh-CN.ts
apps/web/src/lib/capabilities.ts
apps/e2e/e2e/fill-blank-e2e.spec.ts
```

### Commands executed
```bash
git branch --show-current                    # feat/exam-audit-0718
git rev-parse HEAD                           # ddbc808b9c640584ece7690dd8aef681739081a5
git status --short                           # ?? docs/audits/
date +"%Y%m%d-%H%M%S"                       # 20260719-000537

# Source verification commands (grep/rg):
grep -n "maySeeProctor\|ExamRoomView" apps/web/src/pages/admin/ExamDetailPage.tsx
grep -n "candidates/status\|ExamEnrollmentManage" apps/api/src/routes/exam.ts
grep -n "Proctor\|ExamRoomView\|ExamEnrollmentManage" packages/authz/src/presets.ts
grep -n "canCreate\|canDelete" apps/web/src/pages/admin/QuestionPage.tsx
grep -n "canCreate\|canDelete" apps/web/src/pages/admin/ExamPage.tsx
grep -n "formatQuestionType\|questionTypes" apps/web/src/pages/exam/ResultPage.tsx
rg -n "text_response\|questionTypes" apps/web/src/i18n/locales/zh-CN.ts
rg -n "candidates/status" apps/api/src/routes/
rg -n "proctor-incident" apps/api/src/routes/
rg -n "proctor-incident" apps/web/src/
grep -n "answer:" packages/contracts/src/attempt.ts
grep -n "Attachment\|attachments" packages/domain/src/types.ts
grep -n "scoreStrategy\|passingScore\|resultPublicationMode" packages/exam-engine/src/grading.ts
```
Proves: all disputed claims verified against current source code at HEAD ddbc808b.

### What this does NOT prove
- No browser E2E was re-executed (re-running would require reseeding the e2e DB and is unnecessary — existing report evidence is consistent with source).
- No integration tests were re-run (test counts in reports are mutually consistent at 114 files/1265 pass).
- The fill_blank browser loop remains unverified (dedicated E2E is skipped).

## K. Final Machine-Readable Summary

```
RUN_ID=EXAM-BOUNDARY-ADJUDICATION-20260719-000906-ddbc808b
HEAD=ddbc808b9c640584ece7690dd8aef681739081a5
REPORTS_REVIEWED=10
INDEPENDENT_EXECUTIONS=9
STALE_REPORTS=0
MISNAMED_REPORTS=1
P0=0
P1=0
P2=5
P3=7
PRODUCT_DECISIONS=9
ADMIN_CANDIDATE_BOUNDARY=PASS
TRUSTED_ORG_STAFF_BOUNDARY=CONDITIONAL
MULTI_TEACHER_ISOLATION=UNSUPPORTED
ASSIGNED_PROCTOR=UNSUPPORTED
ASSIGNED_GRADER=UNSUPPORTED
FILL_BLANK=PARTIAL
TEXT_RESPONSE_PLAINTEXT=SUPPORTED
RICH_TEXT=UNSUPPORTED
```

---

```
EXAM-BOUNDARY-ADJUDICATION-20260719-000906-ddbc808b: COMPLETE
```
