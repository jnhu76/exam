# Phase 1.2 Enhancement — Bug Fixes & UX Improvements

**Date:** 2026-06-02
**Status:** Pending implementation
**Branch:** TBD (branch from `phase1.2/test-enhancement`)

---

## Issues

### BUG-1: Publish exam fails with "totalScore must match question scores"

**Severity:** P0 — blocks core workflow
**Area:** Frontend + API
**Repro:**

1. Create exam, select questions with scores
2. Leave `totalScore` at default 100 (or set it to any value != sum of question scores)
3. Click "发布考试"
4. Server returns 400: `Exam totalScore must match question scores`

**Root cause:** `ExamConfigForm.tsx` renders `totalScore` as a plain number input defaulting to 100. The admin must manually ensure it equals the sum of all selected question scores. Mismatch is caught by `publishExam()` in `packages/exam-engine/src/examCommands.ts:97-103` which computes the sum from the question snapshot and compares.

**Fix:**

1. **Frontend auto-calculation:** When questions are selected, auto-sum their `score` values and populate `totalScore`. Show a read-only computed total with an override toggle for manual entry if needed. Display a validation warning when `totalScore != computed sum`.
2. **Better error feedback:** Show the validation error from the server in a more prominent way — display what the expected total is vs what was submitted.

**Files affected:**

- `apps/web/src/components/exam/ExamConfigForm.tsx` — auto-calculate totalScore from questions
- `apps/web/src/pages/admin/ExamCreatePage.tsx` — wire question selection to totalScore
- `apps/web/src/pages/admin/ExamDetailPage.tsx` — show publish validation errors clearly

---

### BUG-2: Course delete shows white/blank page before reload

**Severity:** P1 — broken UX
**Area:** Frontend
**Repro:**

1. Go to `/admin/courses`
2. Delete a course (that has no dependent questions/exams)
3. Page goes blank/white; content only appears after manual browser refresh

**Root cause hypothesis:** After `handleDelete()` calls `loadCourses()`, the state update may cause the component to unmount/remount improperly, or there's a routing/re-render issue where the loading state doesn't properly reset. The `loadCourses()` function sets `isLoading = true` then fetches, but the component may be in an inconsistent state during re-render.

**Fix:**

- Debug the re-render cycle in `CoursePage.tsx`
- Ensure `handleDelete` → `loadCourses` doesn't leave the component in a broken intermediate state
- Possibly avoid `setIsLoading(true)` in `loadCourses` when called after delete (refresh case)

**Files affected:**

- `apps/web/src/pages/admin/CoursePage.tsx` — fix delete → reload cycle

---

### ENH-3: Enrollment candidate picker doesn't scale

**Severity:** P1 — UX limitation
**Area:** Frontend
**Current behavior:** `ExamDetailPage.tsx:handleOpenAddDialog()` fetches `pageSize=100` candidates and renders them all in a scrollable dialog with checkboxes. With hundreds of candidates, this is unusable.

**Fix:**

1. Add a **search/filter** input at top of the dialog — filter by name or identity fields
2. **Pagination** — load candidates in pages with "load more" or paginated navigation
3. **Select all / deselect all** — for batch enrollment
4. **Already-enrolled indicator** — gray out or hide candidates already enrolled in this exam
5. **Import from list** — allow pasting a list of candidate identifiers for bulk enrollment (stretch goal)

**Files affected:**

- `apps/web/src/pages/admin/ExamDetailPage.tsx` — redesign enrollment dialog

---

### ENH-4: Settings page needs tabs/sections

**Severity:** P2 — UX improvement
**Area:** Frontend
**Current behavior:** `SettingsPage.tsx` shows all settings (branding + password change) in a single scrollable page. As more settings are added (timezone, candidate fields, system config), this will become unwieldy.

**Fix:**

1. Add tab navigation (e.g., shadcn Tabs component):
   - **品牌设置** — productName, productSubtitle, footerText, organizationDisplayName
   - **考试设置** — default exam duration, default control flags, default retake policy
   - **系统设置** — timezone, language, session timeout
   - **账号安全** — password change, two-factor (future)
2. Each tab is a separate section/component, not a separate route

**Files affected:**

- `apps/web/src/pages/admin/SettingsPage.tsx` — add Tabs layout
- `apps/web/src/components/settings/PlatformSettingsForm.tsx` — become one tab

---

### ENH-5: Timezone should be a selectable option

**Severity:** P2 — UX improvement
**Area:** Frontend
**Current behavior:** `PlatformSettingsForm` has a timezone text input. No validation, no common options.

**Fix:**

1. Replace timezone text input with a `<Select>` dropdown containing common IANA timezones (e.g., `Asia/Shanghai`, `UTC`, `America/New_York`, etc.)
2. Optionally use `Intl.supportedValuesOf('timeZone')` to get the browser's full timezone list
3. Default to the server's timezone or `Asia/Shanghai` for LAN deployments

**Files affected:**

- `apps/web/src/components/settings/PlatformSettingsForm.tsx` — timezone select

---

### ENH-6: Batch management operations

**Severity:** P2 — UX improvement
**Area:** Frontend (multiple pages)
**Scope:** Affects:

| Page                | Batch operations needed                          |
| ------------------- | ------------------------------------------------ |
| `/admin/candidates` | Batch delete, batch assign to exam, batch export |
| `/admin/questions`  | Batch delete, batch move to course, batch import |
| `/admin/exams`      | Batch archive, batch publish (with caution)      |
| `/admin/users`      | Batch activate/deactivate                        |
| Exam enrollment     | Batch add, batch remove                          |

**Implementation pattern:**

1. Add row-level checkboxes with "select all" header checkbox
2. Show a floating action bar when items are selected (count + action buttons)
3. Batch API endpoints where needed (some may already support arrays)

**Files affected:**

- Multiple admin pages: `CandidatesPage.tsx`, `CoursePage.tsx`, etc.
- API routes may need batch endpoints

---

### ENH-7: Notification / messaging system (TODO — do not implement)

**Severity:** Future / Phase 2
**Area:** Full stack

This is a feature request, not a bug. Documenting for roadmap planning.

**Requirements:**

- Dashboard notification inbox for all users
- Admin/Teacher can send messages to candidates (individual or broadcast)
- Notification types: exam reminder, result published, system announcement
- Optional email integration for external notifications
- Read/unread state, dismiss functionality

**Why deferred:** Requires new database schema (notifications table), new API routes, real-time delivery mechanism (WebSocket or SSE), and significant frontend work. Out of scope for Phase 1.

---

## Implementation Priority

| Priority | Issue                           | Effort | Impact                   |
| -------- | ------------------------------- | ------ | ------------------------ |
| P0       | BUG-1: totalScore auto-calc     | Small  | Unblocks core workflow   |
| P1       | BUG-2: Course delete blank page | Small  | Fixes broken UX          |
| P1       | ENH-3: Enrollment picker scale  | Medium | Essential for real usage |
| P2       | ENH-4: Settings tabs            | Small  | Better organization      |
| P2       | ENH-5: Timezone selector        | Small  | Better UX                |
| P2       | ENH-6: Batch operations         | Large  | Multi-page improvement   |
| Future   | ENH-7: Notifications            | Large  | Phase 2 feature          |

---

## Recommended Implementation Order

1. BUG-1 (totalScore) — immediate fix
2. BUG-2 (course delete) — quick fix
3. ENH-3 (enrollment picker) — medium effort
4. ENH-4 + ENH-5 (settings + timezone) — can be done together, small effort
5. ENH-6 (batch operations) — largest item, may span multiple PRs
6. ENH-7 (notifications) — deferred to Phase 2
