# Phase 1 UI Interaction Contract

**Status:** Phase 1 implemented contract
**Authority:** This document defines the user-observable interaction contract for the Phase 1 frontend (Admin + Candidate). It wins over implementation details for test and E2E purposes. Visual design tokens, pixel-level screenshots, and aesthetic rules are out of scope (see `docs/ui/` for design direction).
**Source of truth:** PR-UI-2 Component Adoption Sweep + `docs/phase1/pr-ui-2-acceptance-audit.md`.

## 1. Scope

### This document constrains

- User-observable behavior of pages and components.
- `role`, `aria-label`, `aria-current`, `aria-live`, `aria-busy` contracts.
- `loading` / `empty` / `error` state rendering obligations.
- `data-testid` assignments and E2E selector strategy.
- Component replacement boundaries (what must use a shared component vs. may stay local).

### This document does NOT constrain

- Visual aesthetics (color, spacing, shadow, typography, radius).
- Pixel-level screenshot regressions.
- Phase 2 proctor UI, exam operation panel, live status cards, random paper builder, pass-gate API UI, PDF export UI, Electron lockdown, AI grading UI, adaptive degradation UI.
- The complete design system (see `docs/ui/*` for design direction).

## 2. Shared Component Contract

| Component | Purpose | Required Behavior | Accessibility Contract | Test Contract | Notes |
| --------- | ------- | ----------------- | ---------------------- | ------------- | ----- |
| `SearchInput` | Search field with leading icon + clear (X) button. | `onChange(value)` fires on input; `onClear` fires on clear click or clears value when omitted; clear button only renders when value non-empty and not disabled. | Renders `role="searchbox"`; clear button is icon-only and MUST have `aria-label` (default `清除搜索`, overridable via `clearLabel`). | Query by `role="searchbox"` or `aria-label`; clear by `role="button"` + clearLabel. | Owns input semantics only — does NOT own query state, does NOT call API. |
| `ListToolbar` | List-page toolbar with named slots. | Renders `search`/`filters`/`actions`/`summary` slots. Does not own business state. | `role="toolbar"` with `aria-label` (default `列表工具栏`). | Query by `role="toolbar"` + aria-label; assert slot children. | Preferred for Admin list pages with search + filters. |
| `DataToolbar` | Generic toolbar (children + actions + summary). | Renders children + optional actions/summary. Does not own business state. | `role="toolbar"` with `aria-label` (default `数据工具栏`). | Query by `role="toolbar"` + aria-label. | Kept alongside ListToolbar: ListToolbar = named slots, DataToolbar = free children. Used by ExamPage. |
| `DataTablePagination` | Table pagination (totals + prev/next + page numbers). | `page`/`pageSize`/`total` are presentation inputs; `onPageChange(page)` callback. Computes `pageCount = ceil(total/pageSize)`. | `aria-label` (default `表格分页`); totals in `aria-live="polite"`; page links carry `aria-label="第 N 页"` and `aria-current="page"` when active; prev/next disabled at bounds. | Query page links by `role="link"` + `aria-label`; assert totals text; assert prev/next disabled. | Page must not hand-write duplicate pagination unless a business reason is documented. |
| `RowActions` | Row action button group container. | Renders `leading`/children/`trailing` slots; does not mutate handlers. | `role="group"` with `aria-label` (default `行操作`). | Query group by `role="group"` + `行操作`; assert child buttons by aria-label. | For standard edit/delete/detail/toggle groups. Does NOT own permission/disabled logic — callers pass through. |
| `InlineErrorBanner` | Destructive / error inline banner. | Renders children inside a styled destructive banner. | MUST render `role="alert"`. | Query by `role="alert"`; assert message text present. | Presentation-only; no business coupling; no API calls. |
| `QuestionNavigator` | Exam question navigator (numbered grid). | Pure presentation: renders `items` and calls `onSelect(id)`. Does NOT own answer state. | `<nav aria-label="题目导航">`; each button `aria-label="第 N 题，{state}，当前题?"`; `aria-current="true"` on current. | Query by `aria-label` per question; assert `aria-current`. | Replaced QuestionNav (deleted). id-based, not index-based. |
| `ConfirmDialog` | Base confirm dialog (AlertDialog-backed). | `trigger` + `title` + `description` + confirm/cancel callbacks. | AlertDialog semantics; confirm button carries `data-variant="destructive"` when `destructive`. | Query by `role="alertdialog"`; confirm/cancel by label. | Low-level primitive for confirm flows. |
| `ConfirmActionDialog` | Thin wrapper over ConfirmDialog for action-triggered confirms. | Same surface as ConfirmDialog; `disabled` maps to `confirmDisabled`. | Inherits AlertDialog semantics. | Query by `role="alertdialog"`; assert title/description. | Convenience wrapper; both it and ConfirmDialog remain valid. |

## 3. Page Interaction Contract

| Page | Required UI Areas | Error State | Loading/Empty State | Test Selectors | Notes |
| ---- | ----------------- | ----------- | ------------------- | -------------- | ----- |
| `UsersPage` | PageHeader (title 用户管理); user table; create/edit Dialog; row actions (edit + toggle). | API load error → `ErrorState` (role alert). | `LoadingState` (role status); empty → `EmptyState` 暂无用户. | Title by text; create by `新增用户`; edit by `aria-label="编辑用户"`; toggle confirm by `role="alertdialog"`. | Row actions use `RowActions`. Candidate role filtered out of display. |
| `CandidatesPage` | PageHeader; search (`SearchInput`); candidate table with dynamic identity fields; row actions; create/edit Dialog; ImportWizard. | API load error → `ErrorState`. | Loading/empty as above; search-no-match → `EmptyState` 未找到匹配的考生. | Search by `aria-label="搜索考生"`; edit by `aria-label="编辑考生"`. | `ImportWizard` is the canonical import UI. |
| `CoursePage` | PageHeader; search (`SearchInput`); course table; row actions; create/edit Dialog. | API error → `ErrorState`. | Loading/empty as above; search-no-match EmptyState. | Search by `aria-label="搜索课程"`; edit by `aria-label="编辑课程"`. | TruncatedCell tooltip is page-local (acceptable). |
| `QuestionPage` | PageHeader; `ListToolbar` (filters + tags + search + clear-filters + loading); question table; row actions; `DataTablePagination`. | API error → `ErrorState`. | Loading → in-toolbar `aria-live="polite"` span + `LoadingState` shell; empty/search-empty → `EmptyState`. | Filters by Select trigger; search by `aria-label="搜索当前页题目"`; pagination by `role="link"` page numbers. | Page owns `page`/`pageSize`/`total` state; pagination is presentation-only. |
| `CandidateFieldsPage` | PageHeader; field table with drag-sort; row actions (up/down/edit/delete); create/edit Dialog. | `InlineErrorBanner` for mutationError (role alert). | Loading/empty as above. | Move by `aria-label="上移"/"下移"`; delete confirm by `role="alertdialog"`. | Dialog-internal field error stays as `<p role="alert">` (form-level, not banner). |
| `SettingsPage` | PageHeader; `FormSection` 品牌设置 + 账号安全. | `InlineErrorBanner` for saveError (role alert). | Loading/empty as above. | Form section headings by text. | Uses PlatformSettingsForm + PasswordChangeForm business components. |
| `ExamCreatePage` | PageHeader; ExamConfigForm; selected-questions table; question-picker Dialog. | `InlineErrorBanner` for saveError (role alert). | Loading/empty as above. | Manual-pick button by text; question-picker dialog by `role="dialog"`. | Single remove button per row — RowActions not required. |
| `QuestionEditPage` | PageHeader; QuestionForm + QuestionPreview side-by-side; save/cancel. | `InlineErrorBanner` for saveError (role alert). | Loading/empty as above. | Cancel/save by button label. | QuestionForm/QuestionPreview are business components (not shared). |
| `TakeExamPage` | Sticky header (title + SaveIndicator + ExamTimer + 交卷); QuestionNavigator aside; question section; sticky footer (prev/next/flag/submit); submit Dialog. | Save rejection → Alert (role alert); disconnect → Alert. | Load → full-screen `LoadingState`; error → full-screen `ErrorState`. | Submit by `data-testid="take-submit-btn"`; confirm by `data-testid="confirm-submit-btn"`; question section by `data-testid="take-question-section"`. | See §8 — runtime semantics are inviolable. |

## 4. Error Display Contract

- **`InlineErrorBanner`** is the canonical destructive/error inline banner for shared use. It MUST render `role="alert"`.
- Hardcoded business copy is forbidden inside shared components. Shared error components accept the message via children/props.
- **API error (load failure):** page renders `ErrorState` (full-area) — not `InlineErrorBanner`.
- **API error (mutation/publish/save):** page renders `InlineErrorBanner` (inline, persistent until next attempt) — e.g. SettingsPage saveError, ExamCreatePage saveError, QuestionEditPage saveError, CandidateFieldsPage mutationError.
- **Validation error (form field):** rendered via `FieldError` inside `Field` — `<p>` with destructive text, not a banner.
- **Permission / expected API error:** surfaces via toast (`sonner`) for transient action feedback; blocking permission errors use `ErrorState` or `InlineErrorBanner` depending on context.
- **Token divergence exception:** `ExamDetailPage.publishError` and `StartExamPage` banners use a different tone token (`bg-destructive/10` / dual primary+destructive). These are documented deliberate exceptions, not violations — they must still render `role="alert"`.

## 5. Row Action Contract

- **`RowActions`** is for standard edit / delete / detail / toggle button groups in table rows. It renders `role="group" aria-label="行操作"` and does not own permission or disabled logic.
- **Complex tooltip / disabled destructive actions** may remain page-local. Example: `ExamPage` row delete wraps a disabled button in a `Tooltip` showing `deleteDisabledReason` — this stays local because the tooltip-around-disabled pattern does not fit `RowActions`.
- **Destructive actions** MUST either (a) open a confirm dialog (`ConfirmDialog`/`ConfirmActionDialog` with `destructive`), or (b) render a clearly disabled control with an accessible disabled reason (tooltip + `aria-label`).
- Callers pass through `disabled`, `loading`, `destructive`, and handler props verbatim — `RowActions` must not silently drop or hide them.

## 6. Toolbar / Search Contract

- **`SearchInput`** owns the input semantics (value, clear, aria-label) only. It does NOT own the query state and does NOT call the API. Callers wire `onChange` to their own state and derive filtering themselves.
- **`ListToolbar`** is the preferred toolbar for Admin list pages with a clear search + filters + actions layout (named slots). Used by QuestionPage.
- **`DataToolbar`** is the free-children toolbar (children + actions + summary). Used by ExamPage. Both remain valid; their boundary is slot API, not deprecation.
- **Clear-filter / reset:** when a page exposes filters, it MUST provide a visible reset affordance when any filter is active (e.g. 清空筛选 button), with `aria-label`.
- **Loading state inside toolbar:** a loading indicator inside a toolbar MUST use `aria-live="polite"` so assistive tech announces it. It must not replace the toolbar's filter controls.
- **Disabled state:** filter/select controls may disable when logically invalid, but the disabled reason should be conveyed (label/help text), not silently grayed out.

## 7. Pagination Contract

- **`DataTablePagination`** is the canonical pagination for server-paginated tables. It displays total count ("共 N 条，显示 X-Y 条") plus prev/next and page-number links.
- **Semantics:** `page` (1-based current), `pageSize`, `total` are inputs; `onPageChange(page)` is the only callback. The component computes `pageCount = ceil(total/pageSize)`.
- **Disabled:** prev disabled when `page <= 1`; next disabled when `page >= pageCount`. Disabled buttons must remain in the DOM (for screen-reader order) with `disabled` attribute.
- **No duplicate hand-written pagination** unless a page documents a business reason (e.g. exam runtime uses no pagination). Pages migrated in PR-UI-2 (QuestionPage) must not re-introduce hand-written pagination.
- **Server `totalPages` divergence:** if the server reports `totalPages` inconsistent with `ceil(total/pageSize)`, `DataTablePagination` follows the computed value. Pages should not keep a parallel `totalPages` state that disagrees with the component (QuestionPage `totalPages` state was removed in the post-audit cleanup as dead code).

## 8. Exam Runtime UI Contract

The exam runtime (`TakeExamPage` and `/exam/*` routes) is inviolable: presentation swaps must not alter business semantics.

- **MUST NOT be altered by UI component adoption:**
  - `saveAnswer` / `scheduleSave` / answer-save protocol (versioned, idempotent, `clientSeq`).
  - `accepted:false` handling, including `STALE_VERSION` conflict resolution and rejection display.
  - Heartbeat interval (30s `/heartbeat`) and disconnect detection.
  - `handleSubmit` / `submittingRef` guard.
  - `ExamTimer` and `deadlineAt` (server is time authority).
  - `questionStates` mapping and answer state machine.
- **`QuestionNavigator`** is a pure presentation/navigation component. It receives `items` + `currentId` and calls `onSelect(id)`. It owns NO answer state. `TakeExamPage` adapts id↔index via `findIndex`; this adapter must be preserved on any future refactor.
- **Exam runtime header / footer / submit dialog remain page-local** in Phase 1:
  - Header inlines `<Button>交卷</Button>` with `data-testid="take-submit-btn"` — `ExamTopbar` has no action slot, so it is NOT the current runtime contract.
  - Footer renders a summary line ("已答/未答/标记/共") + last-question branch — `RuntimeActionBar` has no summary slot, so it is NOT the current runtime contract.
  - Submit dialog carries `flushResult` / `requiresSubmitOverride` / 重试 / 仍然提交 semantics — `SubmitConfirmDialog` cannot express these, so it is NOT the current runtime contract.
- **Reserved-but-not-active components:** `ExamTopbar`, `RuntimeActionBar`, `QuestionHeader`, `AnswerPanel`, `QuestionWorkspace`, `SubmitConfirmDialog`, `SubjectiveAnswerInput` are reserved for future runtime refactors / subjective-question support. They are NOT part of the current TakeExamPage contract and must not be treated as such.

## 9. Not-Replaced Inventory

These are deliberate exceptions from PR-UI-2, not gaps:

| File | Pattern | Decision | Reason | Future Action |
| ---- | ------- | -------- | ------ | ------------- |
| `ExamPage` | Row actions with Tooltip-wrapped disabled delete | Keep local | Tooltip-around-disabled-button pattern does not fit RowActions; `deleteDisabledReason` needs accessible surfacing | Optionally wrap group in RowActions while keeping Tooltip locally |
| `ExamDetailPage` | Stat-card grid + `publishError` banner | Keep local | Stat cards render `StatusBadge` as value (StatsCard API mismatch); banner uses `border-destructive bg-destructive/10` token (diverges from InlineErrorBanner) | Consider a token-aware banner variant in a follow-up |
| `ExamCreatePage` | Question-pick single button per row | Keep local | Lone "添加" button — RowActions adds nothing | none |
| `ExamListPage` | ExamCard grid | Keep local | Candidate-facing exam card layout, not admin CRUD | none |
| `StartExamPage` | Info card + dual-tone warning banner | Keep local | Banner conditionally uses primary OR destructive tone; InlineErrorBanner is destructive-only | Consider a tone-aware banner in a follow-up |
| `ResultPage` | Result card + answer-detail table | Keep local | Business-specific result layout | none |
| `TakeExamPage` | header / footer / submit Dialog | Keep local | See §8 — ExamTopbar/RuntimeActionBar/SubmitConfirmDialog lack required slots/semantics | Future runtime refactor PR |

## 10. E2E Selector Policy

Selector priority (highest to lowest):

1. **`getByRole` / `getByLabelText`** — preferred for all user-observable controls. Examples: `role="button"` + `aria-label="编辑用户"`, `role="alertdialog"`, `role="searchbox"`.
2. **`getByTestId`** — for controls without a stable role/label or where role is ambiguous. Currently assigned: `take-submit-btn`, `confirm-submit-btn`, `take-question-section`, `exam-start-btn`, `exam-card-*`.
3. **Visible text** — acceptable for unambiguous labels (page titles, button text).
4. **CSS selector** — last resort only.

### Forbidden selectors

- Tailwind class names (e.g. `.flex.gap-1`).
- DOM hierarchy / nth-child coupling.
- Pure SVG buttons without `aria-label` (icon-only buttons MUST carry `aria-label`).
- `placeholder` as the sole contract (use `aria-label`; placeholder is supplementary).
- Structural coupling to shared component internal DOM (e.g. asserting `RowActions` renders a specific nested div order).

### Required labels for icon-only controls

Every icon-only button MUST carry an `aria-label`. This is enforced by the shared components (`SearchInput` clear button, `RowActions` group) and by convention in pages (edit/delete/toggle buttons).
