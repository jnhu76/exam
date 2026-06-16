# PR-UI-2 Acceptance Audit

**Audit date:** 2026-06-16
**Audit type:** UI correctness / semantic preservation / contract readiness (read-only)
**Scope:** PR-UI-2 Component Adoption Sweep — page migrations to shared/exam components, error banner extraction, QuestionNav→QuestionNavigator migration, QuestionNav deletion, InlineErrorBanner addition.
**Method:** Diff + source inspection + test/lint run. No code changes.

## 1. Summary

**Conclusion: pass with non-blocking debts.**

PR-UI-2 preserves all business semantics (search, filter, pagination, row-action handlers, destructive confirms, exam save/heartbeat/submit/timer/deadline, answer state machine). The QuestionNav deletion is safe (0 production/test references after migration). InlineErrorBanner is correctly presentation-only and wired into 4 pages. The not-replaced inventory is justified by genuine token/API/layout divergence.

All 483 web tests pass; `format:check`, `lint`, `lint:copy`, `lint:arch`, `typecheck` all green.

Non-blocking debts (see §7, §8) are cosmetic/dead-state and do not block documentation, visual QA, or E2E expansion.

## 2. Replacement Audit Matrix

| Page | Replaced Area | Expected Behavior | Evidence | Status | Risk |
| ---- | ------------- | ----------------- | -------- | ------ | ---- |
| UsersPage | row actions (`div.flex.gap-1` → `RowActions`) | edit + toggle handlers, disabled, destructive confirm | `ConfirmDialog destructive={user.isActive}` preserved (L216); `open`/`toggle` handlers unchanged | pass | low |
| CandidatesPage | search (`Input`+manual clear → `SearchInput`) | search query state, clear resets | `onChange={setSearch}`, `onClear`, `clearLabel="清除考生搜索"` (L306-312); `search` state drives `filteredCandidates` unchanged | pass | low |
| CandidatesPage | row actions | edit + toggle handlers, destructive confirm | `ConfirmDialog destructive={candidate.isActive}` preserved; `open`/`toggle` unchanged | pass | low |
| CoursePage | search | search query state, clear resets | `onChange={setSearch}`, `onClear` (L177-184); `trimmed`/`filteredCourses` logic unchanged | pass | low |
| CoursePage | row actions | edit + delete confirm | `openEdit`/`handleDelete` handlers unchanged; `ConfirmDialog destructive` preserved | pass | low |
| QuestionPage | toolbar → `ListToolbar` (filters/search/actions slots) | filter selects, tags input, clear-filters, loading indicator all still drive `loadQuestions` deps | all Select `onValueChange` + `setPage(1)` preserved; `hasActiveFilter`/`clearFilters` preserved; loading `<span aria-live>` moved into actions slot | pass | low |
| QuestionPage | search → `SearchInput` | current-page content filter | `onChange={setSearch}` preserved; `filtered` derivation unchanged | pass | low |
| QuestionPage | row actions | edit + delete confirm | `navigate(...edit)`/`handleDelete` preserved; `ConfirmDialog destructive` preserved | pass | low |
| QuestionPage | pagination → `DataTablePagination` | page forward/back, totals text | `onPageChange={setPage}`; new `total`/`pageSize` state fed from server `qData.total` (L110) | pass | low — see §7 D1 (dead `totalPages` state) |
| CandidateFieldsPage | row actions | up/down/edit/delete, disabled bounds | `move(field,±1)` with `disabled={index===0}/{index===fields.length-1}` preserved; `ConfirmDialog destructive` preserved | pass | low |
| CandidateFieldsPage | page-level error banner → `InlineErrorBanner` | `mutationError` visible with role=alert | `<InlineErrorBanner>{mutationError}</InlineErrorBanner>` (L222); role=alert retained | pass | low |
| SettingsPage | error banner → `InlineErrorBanner` | `saveError` visible | wired (L70) | pass | low |
| ExamCreatePage | error banner → `InlineErrorBanner` | `saveError` visible | wired (L267) | pass | low |
| QuestionEditPage | error banner → `InlineErrorBanner` | `saveError` visible | wired (L144) | pass | low |
| TakeExamPage | QuestionNav → QuestionNavigator | question selection changes current question; state colors | id↔index mapping via `findIndex` (L389-393); `setCurrentIndex(idx)` preserved | pass | low — see §3 |

## 3. TakeExamPage Semantic Audit

| Area | Expected Unchanged | Evidence | Status |
| ---- | ------------------ | -------- | ------ |
| `saveAnswer` | untouched | L154-225, body byte-identical to pre-migration | pass |
| `scheduleSave` / `useSubmitFlush` | untouched | L109, L169 unchanged | pass |
| `accepted:false` handling | untouched | L196-218 (STALE_VERSION branch + rejection branch) unchanged | pass |
| `setSaveRejection` / `SaveRejection` | untouched | L95, L215-218 unchanged | pass |
| heartbeat interval | untouched | L295-308 (30s `setInterval` → `/heartbeat`) unchanged | pass |
| `handleSubmit` | untouched | L227-239 unchanged; `submittingRef` guard intact | pass |
| `ExamTimer` / `deadlineAt` | untouched | L355-358 (`deadlineAt={attempt.deadlineAt} onTimeout={handleTimeout}`) unchanged | pass |
| `questionStates` mapping | no off-by-one | items built via `questionSnapshot.map((q,i) => ({..., state: questionStates[i] ?? "unanswered"}))` — same index alignment as before; `currentId` reads `questionSnapshot[currentIndex]` (L387) | pass |
| id → index mapping correctness | bijective with snapshot order | `onSelect` does `findIndex(q => q.originalQuestionId === id)` then `setCurrentIndex(idx)`; ids are unique per snapshot | pass |
| QuestionNavigator display-only | no state machine impact | component only renders + calls `onSelect`; all state writes go through `setCurrentIndex` exactly as the old `QuestionNav` did | pass |
| answer panel / save / submit state after switch | consistent | `currentQuestion`/`currentAnswer` derived from `currentIndex` (L149-152) unchanged; `saveAnswer` path unchanged | pass |

No exam-state-machine changes. The migration is purely a presentation swap with an id↔index adapter.

## 4. Deleted Component Audit

| Component | Production References | Test References | Export References | Safe to Delete? |
| --------- | --------------------- | --------------- | ----------------- | --------------- |
| `components/exam/QuestionNav.tsx` | 0 (TakeExamPage migrated to QuestionNavigator) | 0 (examComponents.test.tsx QuestionNav block removed; QuestionNavigator equivalent test already exists) | 0 (no `components/**/index.ts` barrel files exist) | **Yes** — file deleted; no import path residuals; no E2E spec references (see §6) |

No public UI contract document declared QuestionNav as public API (docs/ui/* use QuestionNavigator naming).

## 5. InlineErrorBanner Audit

| Requirement | Status | Evidence |
| ----------- | ------ | -------- |
| Presentation-only (no business fields) | pass | props are `{children, className}` only |
| No business fields dependency | pass | no domain/entity imports |
| No API calls | pass | pure render |
| `role="alert"` | pass | `InlineErrorBanner.tsx:15` |
| Supports className extension | pass | `cn(..., className)` |
| Supports children/message | pass | `{children}` slot |
| No hardcoded business copy | pass | `lint:copy` green; no literal business strings |
| 4-page error semantics consistent | pass | all 4 callers render their existing `{saveError}`/`{mutationError}` string inside the banner; visible + role=alert preserved |
| test covers role=alert | pass | `shared.test.tsx` "renders message with role alert" |

## 6. Not-Replaced Inventory Decision Review

| File | Reason Given | Accept / Reject | Notes |
| ---- | ------------ | --------------- | ----- |
| ExamPage row actions | Tooltip-wrapped disabled delete with `deleteDisabledReason` | Accept | `RowActions` could host the group, but the Tooltip-around-disabled-button pattern would be awkward; keeping local is reasonable. Non-blocking: a future enhancement could still wrap in RowActions |
| ExamDetailPage stat cards | Card grid with `StatusBadge` inside CardContent | Accept | `StatsCard` API (label/value/icon) doesn't fit status-badge-as-value; layout is business-specific |
| ExamDetailPage publishError banner | business-specific | Accept — **but note token divergence**: uses `border-destructive bg-destructive/10` (full-opaque border + /10 bg), NOT the `border-destructive/30 bg-destructive-soft` of InlineErrorBanner. Genuine token mismatch, so not replacing avoids silent restyle. Debt: error-banner visual consistency is now partial across pages (4 unified, 2 divergent) |
| ExamCreatePage question-pick single button | single-button cell, no action group | Accept | RowActions adds nothing for a lone "添加" button |
| ExamListPage ExamCard grid | candidate-facing exam card layout | Accept | not an admin CRUD table |
| StartExamPage info card + warning | conditional primary/destructive dual-tone banner | Accept — uses `border-primary/30 bg-primary/10` OR `border-destructive/30 bg-destructive/10`; InlineErrorBanner is destructive-only, cannot replace the primary-tone branch |
| ResultPage result/detail cards | business-specific result layout | Accept |
| TakeExamPage header | ExamTopbar lacks submit button slot | Accept — current header inlines `<Button>交卷</Button>` with `data-testid="take-submit-btn`; ExamTopbar has no action slot; replacing would drop the testid + submit affordance |
| TakeExamPage footer | RuntimeActionBar lacks summary slot + last-question branch | Accept — footer renders "已答/未答/标记/共" summary + conditional 提交/下一题 branch; RuntimeActionBar has no summary slot and no last-question handling |
| TakeExamPage submit Dialog | SubmitConfirmDialog lacks flush/override/retry semantics | Accept — current Dialog has `flushResult`/`requiresSubmitOverride`/`重试`/`仍然提交` logic that SubmitConfirmDialog cannot express |

No "should-have-been-replaced-but-missed" duplications found.

## 7. Test Gap List

| Gap | Risk | Blocking? | Suggested Test |
| --- | ---- | --------- | -------------- |
| `QuestionPage` `totalPages` state now dead (set from server but `DataTablePagination` recomputes from `total/pageSize`) | low — if server ever returns `totalPages` inconsistent with `ceil(total/pageSize)`, next-button enablement diverges from server intent | no | add a QuestionPage test asserting next-page disabled when on last computed page; OR remove the dead `totalPages` state (minor cleanup) |
| InlineErrorBanner has only 1 test (role alert + text) | low — component is presentation-only | no | optional: test custom className merges |
| No component test asserting RowActions preserves button order (leading/children/trailing) | low — covered indirectly by page tests | no | optional RowActions ordering test |
| QuestionPage pagination assertion changed `"第 1 / 2 页"` → `"共 21 条"` | none — assertion legitimately tracks new component's a11y text; mock data total corrected from 1→21 to be consistent with `totalPages:2` | no | n/a (not a test-bypass; both old and new assertions verify reload-shell behavior) |
| DataTablePagination page/total semantics | none — already has 3 component tests (totals+onPageChange, aria-current, non-positive pageSize) | no | n/a |

## 8. Required Fixes Before E2E

**None blocking.** The following are optional hardening (non-blocking):

1. (optional) Remove dead `totalPages` state in `QuestionPage.tsx` (L77, L111) since `DataTablePagination` no longer consumes it — avoids future confusion. Or keep and add the §7 test.
2. (optional) Consider unifying ExamDetailPage `publishError` + StartExamPage banners to a token-aware banner variant in a follow-up PR — out of scope for PR-UI-2's "match-only" replacement rule.

## 9. Accessibility / E2E Contract Readiness

| Contract | Status | Evidence |
| -------- | ------ | -------- |
| search inputs have `aria-label` | pass | all 3 SearchInput callers pass `aria-label` (CoursePage 搜索课程, CandidatesPage 搜索考生, QuestionPage 搜索当前页题目) |
| icon buttons have `aria-label` | pass | all edit/delete/toggle icon buttons retain explicit `aria-label` (UsersPage 编辑用户, CoursePage 删除课程, etc.) |
| `role="alert"` present on error banners | pass | InlineErrorBanner + remaining `role="alert"` in ExamDetailPage/LoginPage/CandidateFieldsPage-dialog |
| RowActions group label | pass | `role="group" aria-label="行操作"` |
| QuestionNavigator stable selectors | pass | `<nav aria-label="题目导航">` + per-button `aria-label="第 N 题，{state}，当前题"` + `aria-current="true"` — usable by E2E without DOM/class coupling |
| TakeExamPage testids preserved | pass | `take-submit-btn`, `take-question-section`, `confirm-submit-btn` unchanged |
| DataTablePagination a11y | pass | `aria-label="表格分页"`, page links with `aria-label="第 N 页"` + `aria-current` |

No E2E selector currently depends on the deleted QuestionNav class structure (no E2E spec files reference it). E2E expansion is unblocked.

## 10. Final Decision

**PR-UI-2 can proceed to:**

- ✅ **documentation update** — component inventory, not-replaced rationale, and InlineErrorBanner addition should be recorded in the UI component docs.
- ✅ **visual QA** — in dev server, per the migration plan's per-page checklist. Functional tests pass; visual deltas are expected to be minimal (RowActions/ListToolbar/ContentCard/InlineErrorBanner produce DOM equivalent to the prior hand-written styles).
- ✅ **E2E expansion** — stable aria-label/role/testid contracts are in place; no removed selector breaks existing or future E2E.

The non-blocking debts (dead `totalPages` state, partial banner-token unification) do not gate any of the three follow-up tracks.
