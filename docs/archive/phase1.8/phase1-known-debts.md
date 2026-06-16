# Phase 1 Known UI Debts

**Status:** Living document of acknowledged Phase 1 frontend debts.
**Scope:** UI/interaction debts only. Backend, API, DB, and Phase 2 feature debts are tracked elsewhere.
**Source:** PR-UI-2 Component Adoption Sweep + acceptance audit (`docs/phase1/pr-ui-2-acceptance-audit.md`).

## 1. Deliberate exceptions (not-replaced inventory)

These are pages/patterns intentionally NOT migrated to shared components in PR-UI-2. They are not regressions.

| File | Pattern | Debt type | Reason | Future action |
| ---- | ------- | --------- | ------ | ------------- |
| `ExamPage` | Tooltip-wrapped disabled delete | Deliberate exception | Tooltip-around-disabled pattern does not fit RowActions; `deleteDisabledReason` needs accessible surfacing | Optional: wrap group in RowActions while keeping Tooltip locally |
| `ExamDetailPage` | Stat-card grid | Deliberate exception | Cards render `StatusBadge` as value — StatsCard API (label/value/icon) does not match | none (business layout) |
| `ExamDetailPage` | `publishError` banner | Token divergence | Uses `border-destructive bg-destructive/10` (full-opaque border + /10 bg), not InlineErrorBanner's `border-destructive/30 bg-destructive-soft` | Optional: token-aware banner variant in a follow-up |
| `ExamCreatePage` | Question-pick single button | Deliberate exception | Lone button — RowActions adds nothing | none |
| `ExamListPage` | ExamCard grid | Deliberate exception | Candidate-facing card layout | none |
| `StartExamPage` | Info card + warning banner | Deliberate exception + token divergence | Banner is dual-tone (primary OR destructive); InlineErrorBanner is destructive-only | Optional: tone-aware banner variant |
| `ResultPage` | Result card + detail table | Deliberate exception | Business-specific result layout | none |
| `TakeExamPage` | header / footer / submit Dialog | Deliberate exception | ExamTopbar/RuntimeActionBar/SubmitConfirmDialog lack required slots/semantics (submit slot, summary slot, flush/override/retry) | Future runtime refactor PR |

### Error-banner token consistency debt

After PR-UI-2, error banners are only partially unified:
- **Unified (InlineErrorBanner, `border-destructive/30 bg-destructive-soft`):** SettingsPage, ExamCreatePage, QuestionEditPage, CandidateFieldsPage (page-level).
- **Divergent (kept local):** ExamDetailPage `publishError` (`border-destructive bg-destructive/10`), StartExamPage (dual-tone), LoginPage (form-inline `<p>`), CandidateFieldsPage dialog-internal (`<p role="alert">`).

All divergent banners still render `role="alert"`. Unifying them requires a tone/variant-aware banner component, out of scope for PR-UI-2's match-only replacement rule.

## 2. Reserved components (not active contract)

These components exist in `components/exam/` but are NOT consumed by the current TakeExamPage runtime. They are reserved for future refactors / subjective-question support. They must NOT be treated as current runtime contracts.

| Component | Reserved for | Why not active |
| --------- | ------------ | -------------- |
| `ExamTopbar` | Future exam runtime header refactor | No submit-button slot; current header inlines `交卷` button with `data-testid="take-submit-btn"` |
| `RuntimeActionBar` | Future exam runtime footer refactor | No summary slot; no last-question branch |
| `SubmitConfirmDialog` | Future simplified submit flow | Cannot express `flushResult` / `requiresSubmitOverride` / 重试 / 仍然提交 |
| `QuestionHeader` | Future question-section refactor | TakeExamPage question header is page-local layout |
| `AnswerPanel` | Future answer-area refactor | TakeExamPage uses QuestionRenderer inline |
| `QuestionWorkspace` | Future workspace layout | Not consumed by current runtime |
| `SubjectiveAnswerInput` | Future subjective-question support | Phase 1 has no subjective question rendering in runtime |

These components have component-level tests (in `examComponents.test.tsx`) but are not exercised by page/E2E tests. Promoting any of them to an active contract requires a runtime refactor PR that migrates TakeExamPage and updates this document.

## 3. E2E coverage gaps (UI main flows)

The following UI main flows are NOT yet covered by blocking E2E. Functional correctness is currently backed by component + page unit/integration tests (483 passing).

| Flow | Status | Blocking risk |
| ---- | ------ | ------------- |
| Admin login → Users CRUD | Unit tested, not E2E | low |
| Admin Candidates list + search + import | Unit tested (ImportWizard), not E2E | medium (import is high-value) |
| Admin Question list + filters + pagination | Unit tested, not E2E | low |
| Admin Exam create + publish + detail | Unit tested, not E2E | medium |
| Candidate exam list → start → take → submit → result | E2E happy-path exists (resumes/submit-flush); not all branches | high (core exam path) |
| Candidate resume after disconnect | Not E2E | high |
| Submit with failed-save override (`仍然提交`) | Not E2E | high |

E2E re-enablement for happy path / resume / submit-flush is the next roadmap item after PR-UI-2. Selector contracts in §10 of `docs/frontend/ui-interaction-contract.md` are E2E-ready (role/label/testid stable).

## 4. Visual QA still requiring manual completion

CI cannot cover visual rendering. The following require manual dev-server verification per migrated page before sign-off:

| Page | Manual QA checklist |
| ---- | ------------------- |
| UsersPage | RowActions group renders, edit/toggle buttons accessible, destructive confirm styling |
| CandidatesPage | SearchInput clear button, RowActions, ImportWizard dialog |
| CoursePage | SearchInput, RowActions, truncated tooltip |
| QuestionPage | ListToolbar layout (filters/search/actions), DataTablePagination totals + disabled bounds, RowActions |
| CandidateFieldsPage | RowActions (up/down/edit/delete), InlineErrorBanner visibility, drag-sort |
| SettingsPage | FormSection, InlineErrorBanner on save error |
| ExamCreatePage | ExamConfigForm, InlineErrorBanner, question-picker dialog |
| QuestionEditPage | QuestionForm + preview, InlineErrorBanner |
| TakeExamPage | QuestionNavigator state colors (answered/flagged/current), no Admin sidebar, save/timer/submit unchanged |

Visual deltas are expected to be minimal — RowActions/ListToolbar/DataTablePagination/InlineErrorBanner produce DOM equivalent to prior hand-written styles. Any visual regression found in QA should be filed against the component, not the page.

## 5. Dead-code cleanup (resolved)

| Item | Resolution |
| ---- | ---------- |
| QuestionPage `totalPages` state (set from server but unread after DataTablePagination adoption) | **Removed** in post-audit cleanup — `DataTablePagination` recomputes `pageCount` from `total/pageSize` |
| `QuestionNav` duplicate of `QuestionNavigator` | **Deleted** in PR-UI-2 — 0 production/test/E2E/doc-contract references |

## 6. Non-blocking cleanup candidates (optional)

These are optional hardening, not required for Phase 1 release:

- Add a QuestionPage test asserting next-page disabled when on last computed page (documents the `total/pageSize` recomputation contract).
- Unify ExamDetailPage `publishError` and StartExamPage banners via a tone/variant-aware banner component.
- Add an optional RowActions ordering test (leading/children/trailing).
