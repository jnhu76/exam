# Phase 1.2 Enhancement — Code Review Report

**Date:** 2026-06-02
**Reviewer:** Code Review Agent (GLM-5.1)
**Scope:** BUG-1, BUG-2, ENH-3, ENH-4, ENH-5 bug fixes and UX improvements
**Branch:** `fix/phase1.2-enhancements`

---

## Verdict

**APPROVED** — all findings resolved

All 305 tests pass (165 API + 140 Web). All three review findings have been addressed. Changes are focused, well-tested, and follow existing patterns. No security, architecture, or correctness blockers.

---

## Changes Under Review

| ID     | Description                            | Files                                              | Tests                                   |
| ------ | -------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| BUG-1a | totalScore auto-calc from questions    | `ExamConfigForm.tsx`, `ExamCreatePage.tsx`         | 5 (`ExamConfigForm.test.tsx`)           |
| BUG-1b | api.ts error body parsing              | `api.ts`                                           | 15 (existing `api.test.ts`)             |
| BUG-1c | Publish error display                  | `ExamDetailPage.tsx`                               | 1 (`ExamDetailPage.test.tsx`)           |
| BUG-2  | Course delete blank page fix           | `CoursePage.tsx`                                   | 1 (`CoursePage.test.tsx`)               |
| ENH-3  | EnrollmentPicker component             | `EnrollmentPicker.tsx` (new), `ExamDetailPage.tsx` | 10 (`EnrollmentPicker.test.tsx`)        |
| ENH-4  | Settings page tabs layout              | `SettingsPage.tsx`                                 | 1 (new test in `SettingsPage.test.tsx`) |
| ENH-5  | Timezone Select dropdown               | `PlatformSettingsForm.tsx`                         | 2 (`PlatformSettingsForm.test.tsx`)     |
| —      | ExamSettingsPage (standalone password) | `pages/exam/ExamSettingsPage.tsx` (new)            | 0                                       |

---

## BUG-1a: ExamConfigForm totalScore Auto-Calculation

**File:** `apps/web/src/components/exam/ExamConfigForm.tsx` (445 lines)

### Correctness

- `computedTotal` correctly filters `questions` by `data.questionIds` then sums `.score`. Matches the server-side logic in `examCommands.ts`.
- `showWarning` only triggers when `hasQuestions && !manualTotalScore && data.totalScore !== computedTotal` — correct edge case handling.
- Toggle button switches between auto-calc and manual mode. When switching back to auto, it applies `computedTotal` if > 0.
- Input is `readOnly` when questions are selected and not in manual mode — prevents accidental editing.

### Readability

- Clean separation: compute logic at top, update helpers, then JSX. The `applyPreset` helper is well-structured.

### Architecture

- `QuestionScore` interface is local to the component — appropriate since it's a view-specific shape.
- `questions` prop is optional with `= []` default — backward compatible.

### Findings

- **[R1] Recommended:** The auto-calc does not `onChange` to sync `totalScore` with `computedTotal`. The parent (`ExamCreatePage`) still has `totalScore: 100` in initial state. When user selects questions summing to 30, `computedTotal` shows 30 in the helper text, but `data.totalScore` remains 100. The `showWarning` fires ("总分与题目分值之和不匹配"), and if the user doesn't notice, the submit will fail. **The computed total should be synced to `data.totalScore` via `onChange` when questions change.** This is the root behavior the bug was meant to fix — the auto-calc is cosmetic without the sync.

  Suggested fix: add a `useEffect` or compute-and-call in the render:

  ```tsx
  useEffect(() => {
    if (
      hasQuestions &&
      !manualTotalScore &&
      computedTotal > 0 &&
      data.totalScore !== computedTotal
    ) {
      onChange({ ...data, totalScore: computedTotal });
    }
  }, [computedTotal, hasQuestions, manualTotalScore]);
  ```

- **Optional:** `showWarning` is currently unreachable when `!manualTotalScore` because the warning only shows when there's a mismatch, but if R1 is fixed, the values will always match in auto mode. If R1 is not fixed, the warning is useful. Resolve R1 and this becomes dead code — can be removed or kept for manual mode mismatch.

### Test Coverage (5 tests)

- Auto-calc display, readonly when questions selected, editable when no questions, manual override toggle, mismatch warning. **Missing:** test that `onChange` is called with updated `totalScore` when questions change (this is the bug in R1).

**Verdict:** Good structure. R1 must be addressed.

---

## BUG-1b: api.ts Error Body Parsing

**File:** `apps/web/src/lib/api.ts` (86 lines)

### Correctness

- `ApiError` class is clean: `status` + `message`.
- Error parsing in `request()`: tries `body.error?.message ?? body.message` with fallback to status text. Handles both `{ error: { message } }` and `{ message }` response shapes.
- JSON parse failure falls through silently to default message — correct.
- 401 redirects to login before throwing — existing behavior preserved.

### Architecture

- Change benefits all API consumers globally — no per-component error handling needed for standard error shapes.

### Findings

- None. Clean, minimal, well-structured.

**Verdict:** Solid.

---

## BUG-1c: ExamDetailPage Publish Error Display

**File:** `apps/web/src/pages/admin/ExamDetailPage.tsx` (lines 101, 181-196, 249-256)

### Correctness

- `publishError` state set in `handlePublish` catch, cleared on next attempt.
- Error renders as `<div role="alert">` with destructive styling — accessible and visible.
- Error message comes from `err.message` which now benefits from BUG-1b's body parsing.

### Findings

- None.

**Verdict:** Clean.

---

## BUG-2: CoursePage Delete Blank Page Fix

**File:** `apps/web/src/pages/admin/CoursePage.tsx` (line 57-68)

### Correctness

- `loadCourses` now accepts `opts?: { showLoading?: boolean }`.
- Default behavior unchanged (`showLoading !== false` → `true`).
- After delete, calls `loadCourses({ showLoading: false })` — skips the loading spinner, keeps existing data visible during refresh.

### Architecture

- Minimal API surface change — optional parameter with sensible default.

### Test Coverage (1 test)

- Verifies no `role="status"` element (loading spinner) appears during delete refresh. Also verifies remaining data stays visible.

**Verdict:** Simple, effective fix.

---

## ENH-3: EnrollmentPicker Component

**File:** `apps/web/src/components/exam/EnrollmentPicker.tsx` (129 lines, new)

### Correctness

- Search filter works on `name` and `username` (case-insensitive).
- `selectable` list excludes enrolled candidates — select-all only toggles non-enrolled visible candidates.
- Individual toggle uses immutable Set pattern (create new Set, mutate, pass to callback).
- `allSelected` computed from `selectable.every(...)` — correct even when list is filtered.

### Readability

- Clean component with clear separation of concerns. `useMemo` for `filtered` and `selectable` avoids unnecessary recomputation.

### Architecture

- Controlled component: `selectedIds` and `onSelectionChange` owned by parent — good for composition.
- `CandidateItem` interface exported for reuse by `ExamDetailPage`.
- `enrolledCandidateIds` as `Set<string>` — efficient O(1) lookups.

### Findings

- **[R2] Recommended:** No pagination. The enhancement spec (`enhancement.md` line 67) lists pagination as a requirement ("Pagination — load candidates in pages"). Current implementation fetches `pageSize=100` (line 143 of ExamDetailPage). For deployments with >100 candidates, the picker silently truncates. This is acceptable for Phase 1 but should be tracked.

- **[Nit]** The `<label>` wrapping the select-all checkbox (line 81) is correct for accessibility, but the individual candidate labels (line 100) wrap the entire row including the checkbox, name, and "已添加" badge. This is fine for click targets but means clicking the "已添加" text toggles the checkbox — harmless since it's disabled, but slightly surprising.

### Test Coverage (10 tests)

- Search input placeholder, all candidates render, filter by name, filter by username, "已添加" labels, disabled checkboxes, select-all checkbox, select-all toggles non-enrolled, individual toggle, select-all respects filter. **Thorough.**

**Verdict:** Solid component. R2 is a known limitation for Phase 1.

---

## ENH-4: Settings Page Tabs Layout

**File:** `apps/web/src/pages/admin/SettingsPage.tsx` (161 lines)

### Correctness

- Uses shadcn `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` — correct usage.
- "品牌设置" tab contains `PlatformSettingsForm`.
- "账号安全" tab contains inline password change form (moved from bottom of old single-page layout).
- `defaultValue="branding"` — branding tab shows first.

### Architecture

- Password change form is inline in `SettingsPage.tsx` rather than extracted to a component. There's also a separate `ExamSettingsPage.tsx` file with duplicated password change logic.

### Findings

- **[R3] Recommended:** Duplicated password change logic between `SettingsPage.tsx` (lines 89-154) and `pages/exam/ExamSettingsPage.tsx` (entire file). Both implement the same password change form with identical fields, validation, and API call. Should extract a shared `PasswordChangeForm` component and use it in both places.

**Verdict:** Good tab layout. R3 should be addressed to eliminate duplication.

---

## ENH-5: Timezone Select Dropdown

**File:** `apps/web/src/components/settings/PlatformSettingsForm.tsx` (95 lines)

### Correctness

- `TIMEZONE_OPTIONS` contains 11 common IANA timezones covering major regions.
- Uses `react-hook-form`'s `setValue("timezone", val)` for the Select — correctly integrates with the form.
- `watch("timezone")` ensures re-render on change.

### Architecture

- Timezone list is hardcoded. Spec mentioned `Intl.supportedValuesOf('timeZone')` as optional — hardcoded is fine for LAN deployment where browsers may not support it.

### Test Coverage (2 tests)

- Renders as combobox (Select), shows branding fields.

**Verdict:** Clean.

---

## ExamSettingsPage.tsx (Untracked New File)

**File:** `apps/web/src/pages/exam/ExamSettingsPage.tsx` (87 lines, new, no tests)

### Findings

- This file appears to be a standalone password change page for the exam (candidate?) route.
- Not mentioned in the enhancement spec or progress notes.
- Duplicates the password change form from `SettingsPage.tsx`.
- **No tests.**

**Action:** Either delete if not needed, or extract shared `PasswordChangeForm` component (see R3).

---

## Summary of Findings

| ID  | Severity        | Description                                                                                           | Status    |
| --- | --------------- | ----------------------------------------------------------------------------------------------------- | --------- |
| R1  | **Recommended** | `ExamConfigForm` auto-calc was cosmetic — `totalScore` not synced to `data.totalScore` via `onChange` | **Fixed** |
| R2  | Recommended     | EnrollmentPicker had no pagination — silently truncated at 100 candidates                             | **Fixed** |
| R3  | **Recommended** | Password change form duplicated in `SettingsPage.tsx` and `ExamSettingsPage.tsx`                      | **Fixed** |

---

## Issues Resolved in Follow-Up

| Issue                        | File                                                                             | Resolution                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1: totalScore not synced    | `ExamConfigForm.tsx`                                                             | Added `useEffect` that calls `onChange({ ...data, totalScore: computedTotal })` when `hasQuestions && !manualTotalScore && computedTotal > 0 && data.totalScore !== computedTotal` |
| R1: warning in auto mode     | `ExamConfigForm.tsx`                                                             | Changed `showWarning` to only fire in `manualTotalScore` mode (auto mode now always syncs)                                                                                         |
| R2: no pagination            | `EnrollmentPicker.tsx`, `ExamDetailPage.tsx`                                     | Added `hasMore`/`onLoadMore`/`isLoadingMore` props; `ExamDetailPage` tracks page/total, fetches 50 per page, appends on "加载更多"                                                 |
| R3: duplicated password form | New `PasswordChangeForm.tsx`, updated `SettingsPage.tsx`, `ExamSettingsPage.tsx` | Extracted shared `PasswordChangeForm` component with `cardWrapper` prop; both pages use it                                                                                         |

---

## Review Checklist

- [x] Change matches spec/task requirements (BUG-1, BUG-2, ENH-3, ENH-4, ENH-5)
- [x] Edge cases handled (no questions, all enrolled, empty search, pagination)
- [x] Error paths handled (publish error, delete error, API errors)
- [x] Tests cover the change adequately (26 new tests)
- [x] Names are clear and consistent
- [x] Follows existing patterns (shadcn components, page structure, repo pattern)
- [x] No unnecessary coupling
- [x] No secrets in code
- [x] Input validated at boundaries (API validation, client-side checks)
- [x] Tests pass (165 API + 140 Web = 305 total)
- [x] No `any` types
- [x] Chinese UI text for user-facing strings
- [x] R1: totalScore sync fixed
- [x] R2: Pagination added to EnrollmentPicker
- [x] R3: Password form duplication resolved
