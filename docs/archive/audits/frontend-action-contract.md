# Frontend Action Contract Audit

**Date:** 2026-06-15  
**Scope:** PR10 — Button behavior, action semantics, state machine contracts  
**Purpose:** Define expected behavior for every user-facing action and identify gaps

---

## 1. Action Contract Definition

Every user-facing action must satisfy these contracts:

### C1: Loading State
- Button must show loading indicator and be disabled during async operation
- Prevents double-submit
- User receives immediate feedback that action is in progress

### C2: Success Feedback
- After successful operation, user must see confirmation (toast, inline message, or navigation)
- Data must be refreshed to reflect changes
- Dialog must close if operation was from a dialog

### C3: Error Feedback
- After failed operation, user must see specific error message (not generic fallback)
- Error message must come from `ApiError.message` (resolved via `@exam/contracts`)
- Form data must be preserved so user can retry without re-entering

### C4: Destructive Confirmation
- Any destructive action (delete, disable, archive, submit) must have confirmation dialog
- Confirmation text must mention the specific entity being affected

### C5: Accessibility
- Icon buttons must have `aria-label`
- Loading states must be announced to screen readers
- Focus must be managed correctly (dialog open → focus trap, dialog close → focus restore)

---

## 2. Action Contract by Page

### LoginPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| Login submit | C1, C2, C3 | ✅ Loading state, error display, redirect on success | None |

### DashboardPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "创建考试" click | C1 | ✅ Navigation (sync) | None |
| "导入题目" click | C1 | ✅ Navigation (sync) | None |
| "查看考试" icon click | C1 | ✅ Navigation (sync) | None |

### UsersPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "新增用户" click | C1 | ✅ Opens dialog | None |
| "保存" (create/edit) | C1, C2, C3 | ❌ **No loading state; generic error** | **Missing C1 (loading), C3 (specific error)** |
| "编辑" icon click | C1 | ✅ Opens dialog | None |
| "禁用/启用" toggle | C1, C2, C3, C4 | ❌ **No confirmation; no loading; generic error** | **Missing C4 (confirmation), C1 (loading)** |

### CandidatesPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "新增考生" click | C1 | ✅ Opens dialog | None |
| "导入" click | C1 | ✅ Opens wizard | None |
| "保存" (create/edit) | C1, C2, C3 | ❌ **No loading state; discards server error** | **Missing C1 (loading), C3 (error message lost)** |
| "编辑" icon click | C1 | ✅ Opens dialog | None |
| "禁用/启用" toggle | C1, C2, C3, C4 | ❌ **No confirmation; no loading; generic error** | **Missing C4 (confirmation), C1 (loading)** |
| Search input | — | ❌ **No clear/reset mechanism** | **Missing UX contract: searchable list must have reset path** |

### CandidateFieldsPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "添加字段" click | C1 | ✅ Opens dialog | None |
| "下载模板" click | C1 | ✅ Downloads file | None |
| "保存" (create/edit) | C1, C2, C3 | ❌ **No loading; no error handling** | **Missing C1 (loading), C2 (success feedback), C3 (error handling)** |
| "上移"/"下移" click | C1, C2, C3 | ❌ **No loading; no error handling** | **Missing C1, C2, C3** |
| "编辑字段" click | C1 | ✅ Opens dialog | None |
| "删除字段" click | C1, C2, C3, C4 | ✅ ConfirmDialog + error handling (via unhandled rejection) | **Missing C3 (error handling — currently crashes)** |
| Drag-drop reorder | C1, C2, C3 | ❌ **No loading; no error handling; no visual feedback** | **Missing C1, C2, C3, visual feedback** |

### CoursePage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "新增课程" click | C1 | ✅ Opens dialog | None |
| "保存" (create/edit) | C1, C2, C3 | ✅ Loading state, toast success, generic error toast | **C3 partially met — error is generic** |
| "编辑" icon click | C1 | ✅ Opens dialog | None |
| "删除" click | C1, C2, C3, C4 | ✅ ConfirmDialog, toast success, toast error | None |
| Search input | — | ❌ **No clear/reset mechanism** | **Missing UX contract** |

### QuestionPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "新增题目" click | C1 | ✅ Navigation | None |
| "导入题目" click | C1 | ✅ Navigation | None |
| "清空筛选" click | C1 | ✅ Resets all filters | None |
| "编辑" icon click | C1 | ✅ Navigation | None |
| "删除" click | C1, C2, C3, C4 | ✅ ConfirmDialog, toast error | **C2 partial — no success toast on delete** |
| Pagination | — | ✅ Prev/next with disabled states | None |

### QuestionEditPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "保存" click | C1, C2, C3 | ✅ Loading state, navigates on success | **C3 missing — catch block empty, errors silently swallowed** |
| "取消" click | C1 | ✅ Navigation | None |

### QuestionImportPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "下载模板" click | C1 | ✅ Downloads CSV | None |
| "校验导入数据" click | C1, C2, C3 | ✅ Loading state, shows results | **C3 partial — error state set but not cleared** |
| "确认导入" click | C1, C2, C3 | ✅ Loading state, shows summary | None |
| "返回题目列表" click | C1 | ✅ Navigation | None |
| "继续导入" click | C1 | ✅ Resets state | None |

### ExamPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "创建考试" click | C1 | ✅ Navigation | None |
| "查看详情" click | C1 | ✅ Navigation | None |
| "删除考试" click | C1, C2, C3, C4 | ✅ ConfirmDialog (when canDelete), tooltip (when disabled) | None |

### ExamCreatePage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "保存/创建" click | C1, C2, C3 | ❌ **Empty catch block — errors silently swallowed** | **Missing C2 (success feedback unclear), C3 (error handling)** |

### ExamDetailPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "发布考试" click | C1, C2, C3, C4 | ✅ Loading state, toast success, inline error, confirm implied by draft state | None |
| "归档" click | C1, C2, C3 | ✅ Loading state, toast success, toast error | **C4 missing — no confirmation dialog** |
| "返回列表" click | C1 | ✅ Navigation | None |
| "添加考生" click | C1 | ✅ Opens dialog | None |
| "添加 (N)" (dialog) | C1, C2, C3 | ✅ Loading state, toast success/error | None |
| "移除考生" click | C1, C2, C3, C4 | ✅ ConfirmDialog, toast success/error | None |
| Tab switch | — | ✅ Tabs component | None |

### ScoreListPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "导出CSV" click | C1 | ❌ **Opens raw URL without auth** | **Broken — CSV export may fail or require separate auth** |
| "返回考试详情" click | C1 | ✅ Navigation | None |
| Pass filter tabs | — | ✅ URL-synced | None |
| "查看详情" click | C1 | ✅ Navigation | None |
| Search input | — | ❌ **Non-functional — no onChange** | **Dead UI element** |

### ResultsOverviewPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "查看成绩" click | C1 | ✅ Navigation (when enabled) | None |
| Tooltip on disabled | — | ✅ Shows reason | None |

### AttemptDetailPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "返回" click | C1 | ✅ `navigate(-1)` | **May navigate to wrong page if user arrived via direct link** |

### SettingsPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| Branding save | C1, C2, C3 | ✅ Loading state in form, dispatches refresh event | None |
| Password change | C1, C2, C3 | ✅ Loading state in form, toast feedback | None |

### SystemHealthPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "刷新" click | C1 | ✅ Reloads data | None |
| Auto-refresh | — | ✅ 10s interval | None |

### ExamListPage (Candidate)

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "开始考试" click | C1 | ✅ Navigation | None |
| "查看结果" click | C1 | ✅ Navigation | None |

### StartExamPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "开始考试" click | C1, C2, C3 | ✅ Loading state, error handling with specific codes, toast | None |
| Queue polling | — | ✅ Progress bar, status display | None |

### TakeExamPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| Answer save | C1, C2, C3 | ✅ Save indicator, rejection display, disconnect alert | None |
| "交卷" click | C1, C4 | ✅ Opens dialog with flush status | None |
| "确认交卷" click | C1, C2, C3 | ✅ Loading state, navigates to result | None |
| "仍然提交" click | C1, C2, C3 | ✅ Destructive variant, loading state | None |
| "上一题"/"下一题" click | C1 | ✅ Navigation with disabled state | None |
| "标记" click | C1 | ✅ Toggles flag state | None |
| Heartbeat | — | ✅ 30s interval | None |

### ResultPage

| Action | Contract | Current Status | Gap |
|---|---|---|---|
| "返回考试列表" click | C1 | ✅ Navigation | None |

---

## 3. Action Contract Violations Summary

### Severity: Critical

| # | Page | Action | Violation | Impact |
|---|---|---|---|---|
| 1 | CandidatesPage | Search | No clear/reset mechanism | User trapped in search state |
| 2 | ScoreListPage | Search input | Non-functional (no onChange) | Dead UI element |
| 3 | CandidateFieldsPage | save/remove/move/drop | Zero error handling | Unhandled promise rejections |
| 4 | QuestionEditPage | Save | Empty catch block | Errors silently lost |
| 5 | ExamCreatePage | Save | Empty catch block | Errors silently lost |
| 6 | ScoreListPage | Export CSV | Raw URL without auth | Export may fail |
| 7 | CandidatesPage | Save | Discards ApiError.message | Server-specific errors lost |
| 8 | CandidateFieldsPage | Save button | No loading state | Double-submit possible |

### Severity: High

| # | Page | Action | Violation | Impact |
|---|---|---|---|---|
| 9 | UsersPage | Save button | No loading state | Double-submit possible |
| 10 | CandidatesPage | Save button | No loading state | Double-submit possible |
| 11 | UsersPage | Disable/Enable | No confirmation | Destructive action without guard |
| 12 | CandidatesPage | Disable/Enable | No confirmation | Destructive action without guard |
| 13 | CoursePage | Search | No clear/reset mechanism | User trapped in search state |
| 14 | VALIDATION_ERROR | All forms | fieldErrors not mapped to fields | Generic message shown |
| 15 | AttemptDetailPage | Back button | `navigate(-1)` unreliable | May go to wrong page |

### Severity: Medium

| # | Page | Action | Violation | Impact |
|---|---|---|---|---|
| 16 | ExamDetailPage | Archive | No confirmation dialog | Destructive without guard |
| 17 | QuestionImportPage | Error state | Not cleared on retry | Stale error shown |
| 18 | TakeExamPage | Flag button | Duplicated in header and footer | Confusing UX |
| 19 | All tables | Mobile view | No responsive strategy | Overflow on small screens |

---

## 4. Recommended Action Contract Patterns

### Pattern A: Save with Loading + Error (for all dialog forms)

```tsx
const [saving, setSaving] = useState(false);

async function handleSave() {
  if (!validate()) return;
  setSaving(true);
  try {
    await api.post("/api/...", payload);
    toast.success("操作成功");
    setDialogOpen(false);
    await load();
  } catch (err) {
    const message = err instanceof Error ? err.message : "操作失败，请重试";
    toast.error(message);
  } finally {
    setSaving(false);
  }
}

// Button
<Button onClick={() => void handleSave()} disabled={saving}>
  {saving ? "保存中..." : "保存"}
</Button>
```

### Pattern B: Searchable List with Reset (for all list pages)

```tsx
const [search, setSearch] = useState("");

{/* Search input with clear button */}
<div className="relative flex-1">
  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
  <Input
    placeholder="搜索..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    className="pl-9"
  />
  {search && (
    <Button
      variant="ghost"
      size="icon"
      className="absolute right-1 top-1/2 -translate-y-1/2"
      onClick={() => setSearch("")}
      aria-label="清除搜索"
    >
      <X className="size-4" />
    </Button>
  )}
</div>

{/* Empty state with reset action */}
{filtered.length === 0 && search ? (
  <EmptyState
    icon={<Search className="size-8" />}
    title="未找到匹配结果"
    description={`没有符合「${search}」的记录`}
    action={
      <Button variant="outline" onClick={() => setSearch("")}>
        清除搜索
      </Button>
    }
  />
) : filtered.length === 0 ? (
  <EmptyState ... />
) : (
  <Table>...</Table>
)}
```

### Pattern C: Destructive Toggle with Confirmation

```tsx
<ConfirmDialog
  trigger={
    <Button size="sm" variant="outline">
      {item.isActive ? "禁用" : "启用"}
    </Button>
  }
  title={`确认${item.isActive ? "禁用" : "启用"}`}
  description={`确定要${item.isActive ? "禁用" : "启用"}「${item.name}」吗？`}
  destructive={item.isActive}
  onConfirm={() => void toggle(item)}
/>
```

### Pattern D: Error Handling with Server Message Preservation

```tsx
async function handleSave() {
  setSaving(true);
  try {
    await api.post("/api/...", payload);
    toast.success("操作成功");
    setDialogOpen(false);
    await load();
  } catch (err) {
    // Preserve server error message
    const message = resolveErrorMessage(err);
    toast.error(message);
    // For form-level errors, also set inline error
    setFormError(message);
  } finally {
    setSaving(false);
  }
}
```

---

## 5. Files Requiring Changes

### Critical (PR11 target)

| File | Changes Needed |
|---|---|
| `pages/admin/CandidatesPage.tsx` | Add search clear button; preserve server error in save(); add loading state to save button; add confirmation to toggle |
| `pages/admin/ScoreListPage.tsx` | Fix search input onChange; fix CSV export to use authenticated fetch |
| `pages/admin/CandidateFieldsPage.tsx` | Add error handling to save/remove/move/drop; add loading state to save button |
| `pages/admin/QuestionEditPage.tsx` | Add error handling in catch block |
| `pages/admin/ExamCreatePage.tsx` | Add error handling in catch block |

### High (PR11 target)

| File | Changes Needed |
|---|---|
| `pages/admin/UsersPage.tsx` | Add loading state to save button; add confirmation to toggle |
| `pages/admin/CoursePage.tsx` | Add search clear button |
| `pages/admin/ExamDetailPage.tsx` | Add confirmation dialog for archive action |
| `pages/admin/AttemptDetailPage.tsx` | Replace `navigate(-1)` with explicit back navigation |

### Medium (PR12 target)

| File | Changes Needed |
|---|---|
| `pages/exam/TakeExamPage.tsx` | Deduplicate flag button (header vs footer) |
| All table pages | Add responsive table strategy (horizontal scroll wrapper) |
| `pages/admin/QuestionImportPage.tsx` | Clear error state on retry |
| `index.css` | Standardize card shadows, heading hierarchy, button variants |
