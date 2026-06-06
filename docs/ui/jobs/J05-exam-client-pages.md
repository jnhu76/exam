# Job ID: J05
# Branch: feat/ui-exam-client-pages
# Status: todo
# Owner:
# Last Updated: 2026-06-07

## Goal

Refactor all candidate-facing pages: exam list, start exam, answer page, and result page. These pages have unique layout requirements (fullscreen, question nav, timer) and must feel focused and low-distraction.

## Scope

### Exam List (`/exam/list`)

- Card layout for available exams
- Status indicators: upcoming / in-progress / completed / passed
- Action buttons: 开始考试 / 查看结果
- Passed exams show ✅ + score

### Start Exam (`/exam/:id/start`)

- Exam configuration summary card
- Warning messages (timer starts immediately, keep network connected)
- Queue UI (if requireQueue): wait count, progress, auto-redirect
- [返回列表] and [确认开始] buttons

### Answer Page (`/exam/:id/take`)

- Fullscreen layout (no sidebar, no standard nav)
- Top toolbar: exam name + timer + progress + submit button
- Left panel: QuestionNav with state colors (○ unanswered, ● answered green, ◉ flagged yellow)
- Right area: question content + answer input
- Bottom: prev/next navigation + flag button + save status indicator
- Timer turns red when < 5 minutes
- Auto-save status: 保存中 → 已保存 / 保存失败

### Result Page (`/exam/:id/result`)

- Variant A (immediate results): score card + answer review table
- Variant B (waiting): confirmation only, no score or answers
- Pass/fail with icon + color (not color alone)

## Non-goals

- Do not modify admin pages
- Do not modify API answer save protocol logic
- Do not add new exam features

## Files to Read First

- `docs/ui/02-design-tokens.md`
- `apps/web/src/pages/exam/ExamListPage.tsx`
- `apps/web/src/pages/exam/StartExamPage.tsx`
- `apps/web/src/pages/exam/TakeExamPage.tsx`
- `apps/web/src/pages/exam/ResultPage.tsx`
- `apps/web/src/components/exam/QuestionNav.tsx`
- `apps/web/src/components/exam/ExamTimer.tsx`
- `apps/web/src/components/exam/SaveIndicator.tsx`

## Files Allowed to Modify

- `apps/web/src/pages/exam/*`
- `apps/web/src/components/exam/*`
- `apps/web/src/components/layout/ExamLayout.tsx` (minor adjustments only)

## Files Forbidden to Modify

- `apps/web/src/pages/admin/*`
- `apps/web/src/components/layout/AdminLayout.tsx`
- `apps/web/src/components/layout/AppSidebar.tsx`
- `apps/web/src/components/ui/*`
- `apps/api/*`
- `packages/*`

## Implementation Steps

1. Refactor ExamListPage: cards, status, actions
2. Refactor StartExamPage: summary card, warnings, queue UI
3. Refactor TakeExamPage:
   - Fullscreen layout
   - QuestionNav state colors
   - Timer red warning
   - Save indicator
   - Bottom navigation
4. Refactor ResultPage: both variants
5. Update ExamLayout if needed for fullscreen mode
6. Test keyboard shortcuts work
7. Run `pnpm verify`

## Acceptance Criteria

- [ ] Exam list shows cards with proper status
- [ ] Start exam shows configuration summary
- [ ] Answer page is fullscreen with no sidebar
- [ ] QuestionNav has 3 state colors (gray/green/yellow)
- [ ] Timer turns red at < 5min
- [ ] Save indicator shows saving/saved/failed
- [ ] Result page handles both variants
- [ ] Keyboard shortcuts work (arrows, space, numbers)
- [ ] All existing tests pass
- [ ] `pnpm verify` passes

## Verification Commands

```bash
pnpm --filter web typecheck
pnpm test
pnpm verify
```

## Risks

- Answer page is the most complex page — careful with layout changes
- Timer logic is server-authoritative — do not change timing behavior
- Keyboard shortcuts may conflict with browser defaults

## Notes

The answer page is the core exam experience. Test it thoroughly with actual exam data. Verify the auto-save protocol still works correctly after UI changes.
