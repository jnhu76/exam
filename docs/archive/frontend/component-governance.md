# Frontend Component Governance

> **Authority document.** This freezes the exam-platform web UI stack and the
> rules for adding UI components. It is the reference reviewers and agents must
> consult before adding or modifying any frontend component. It supersedes
> ad-hoc decisions; conflicts with code are resolved in favor of this document.

## 1. Current UI stack

| Layer | Tech |
| --- | --- |
| Styling | **TailwindCSS v4** (utility classes only; no CSS-in-JS) |
| Primitive interaction | **shadcn/ui** built on **Radix UI** primitives + **react-day-picker v10** for calendars |
| Icons | `lucide-react` |
| Class composition | `cn()` from `@/lib/utils` (clsx + tailwind-merge) |
| Path alias | `@/` → `apps/web/src/` |

This stack is **frozen**. Do not introduce Ant Design, MUI, Chakra, Headless UI,
or any other component framework. Do not replace Tailwind with another styling
system.

## 2. Component layering

Four layers, in dependency order (a higher layer may import a lower one; never
the reverse):

```
┌─────────────────────────────────────────────────────────┐
│ 4. Page component         pages/**                         │  route-level
├─────────────────────────────────────────────────────────┤
│ 3. Business component     components/shared, components/exam│  domain-shaped
├─────────────────────────────────────────────────────────┤
│ 2. Project-level wrapper  components/shared/<Wrapper>       │  thin shadcn adapter
├─────────────────────────────────────────────────────────┤
│ 1. UI primitive           components/ui/                    │  shadcn / Radix / DayPicker
└─────────────────────────────────────────────────────────┘
```

- **UI primitive** (`components/ui/`): shadcn-generated, Radix/DayPicker-backed.
  `dialog`, `alert-dialog`, `popover`, `select`, `dropdown-menu`, `tooltip`,
  `tabs`, `calendar`, `sheet`, `table`, `button`, `badge`, `input`, etc.
  These are the **only** place complex interaction state machines may live.
- **Project-level wrapper** (`components/shared/`): a thin adapter that composes
  one or more UI primitives into a project convention. Example:
  `components/shared/DatePicker.tsx` composes `Popover` + `Calendar` into a
  single controlled `<DatePicker value onChange aria-label />`. The page never
  sees the popover/calendar internals.
- **Business component** (`components/shared/`, `components/exam/`): domain-
  shaped composition built from wrappers + primitives. Examples:
  `ConfirmDialog`, `ConfirmActionDialog`, `PageHeader`, `EmptyState`,
  `LoadingState`, `StatusBadge`, `ImportWizard`, `DataToolbar`.
- **Page component** (`pages/admin/**`, `pages/exam/**`): route-level. Composes
  business components, wrappers, and primitives. **Never** hand-writes an
  interaction state machine.

## 3. Components you MAY build yourself

These are **business / layout** components — encouraged, not gated:

- `PageHeader`, `PageSection`, `AdminPageHeader`
- `StatusBadge`, `EmptyState`, `LoadingState`, `ErrorState`
- `ContentCard`, `StatsCard`, `FieldGroup`, `FormSection`, `FormStack`
- Business table containers (`DataTableShell`, `DataTablePagination`)
- Business filter regions (`DataToolbar`, `SearchInput`, `ListToolbar`)
- Business form compositions (`ExamConfigForm`, `EnrollmentPicker`)
- Row expand / collapse toggles (a `useState` boolean driving a row's
  `aria-expanded` is a legitimate business interaction — see §6)
- File upload, import wizards, confirm dialogs (built on `AlertDialog`)

## 4. Components you MUST NOT hand-build

These are **complex interaction primitives**. They must come from shadcn /
Radix / DayPicker. Hand-writing any of the following is **forbidden**:

- DatePicker / DateRangePicker / Calendar
- Dialog / Modal (use `Dialog` or `AlertDialog`)
- Select (use `Select`)
- Combobox (use `Popover` + `Command` or `Select`)
- DropdownMenu (use `DropdownMenu`)
- Popover (use `Popover`)
- Tooltip (use `Tooltip`)
- Tabs (use `Tabs`)
- Accordion (use Radix `Accordion` via shadcn add)
- FocusTrap (Radix handles this inside Dialog/Popover; never hand-roll)
- Toast / Notification primitive (we use `sonner`)

Why: these primitives own accessibility (focus management, escape handling,
`aria-*`, keyboard nav, outside-click, portal stacking). Hand-rolled versions
get this wrong and are the historical source of act warnings and flaky tests.

## 5. Adding a shadcn primitive

When the project lacks a needed primitive:

1. **Check first**: scan `components/ui/` and the shadcn registry. A primitive
   likely already exists.
2. **Add via the project convention**: place the file in `components/ui/`,
   keep the `cn()` utility, the `@/components/ui/button` import alias, and the
   Tailwind class style of sibling files. Match `components.json`.
3. **Do not duplicate**: if `components/shared/DatePicker.tsx` already wraps
   Popover+Calendar, do not add a second `DatePicker2` with different
   behavior. Extend the existing wrapper.
4. **One primitive per file**, named to match the Radix/shadcn convention.

## 6. Page-component boundary

A page component **must not**:

- Open/close a `Dialog`/`Popover`/`Select`/`DropdownMenu` by manipulating
  portal DOM or focus directly — use the primitive's `open` / `onOpenChange`
  (controlled) or a trigger element (uncontrolled).
- Hand-write a calendar grid, day-cell, or month navigator.
- Implement its own focus trap, escape-key handler for modals, or outside-click
  layer. Radix owns these.
- Reimplement a `Select` with a `<div>` + `useState(open)` + filtered list.

A page component **may**:

- Hold a `useState<boolean>` for whether a `Dialog` is open and pass
  `open`/`onOpenChange` to the shadcn `Dialog`.
- Compose `<DatePicker value={x} onChange={setX} />` without knowing how the
  calendar renders.
- Use a row-expander `useState` that toggles a row's `aria-expanded` for
  inline detail disclosure (this is business state, not a popover primitive).

### Approved pattern: shared DatePicker wrapper

`components/shared/DatePicker.tsx` is the **approved** project-level wrapper
around shadcn `Popover` + `Calendar` (react-day-picker v10). Pages consume it
as a controlled component:

```tsx
<DatePicker
  value={from}
  onChange={setFrom}
  aria-label="开始日期"
  placeholder="选择开始日期"
/>
```

Pages never import `Popover`/`Calendar` directly for date selection. For a
date **range**, compose two `DatePicker` instances (from / to) or add a
`DateRangePicker` wrapper that follows the same shape
(`value: {from,to}`, `onChange`). Do not hand-build a calendar range picker.

## 7. Testing rules

### Page tests test business behavior, not primitive internals

- Query by **role, label, placeholder, visible text, or `data-testid`**.
- **Never** query by `className`, by internal DOM structure, or by CSS class of
  a Radix portal. If a test needs to assert a Radix internal, the test belongs
  on the **wrapper**, not the page.
- Page tests assert user-visible outcomes and API call payloads.

### userEvent

- Every `user.click` / `user.type` / `user.selectOptions` **must be `await`ed**.
- For non-keyboard-critical inputs (e.g. a plain title text field), prefer
  `fireEvent.change` to avoid per-keystroke delay; reserve `userEvent` for
  genuine interactions (button clicks, opening dialogs, real typing semantics).

### Fake timers

- If a test uses `vi.useFakeTimers()`, **and** also uses `userEvent`, configure
  `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.
- All `vi.advanceTimersByTime` / `runOnlyPendingTimers` calls **must** be inside
  `act(async () => { ... })`.
- Avoid `vi.runAllTimersAsync()` when the component has an infinite
  `setInterval` (e.g. a 60s tick) — it loops. Drain microtasks with an empty
  `await act(async () => {})` instead, then assert with a sync query.

### Polling / debounce

- Pages that poll (e.g. `ExamMonitoringPage`, `SystemDiagnosticsPage`) must
  clean up their `setInterval` in `useEffect` return.
- Tests must drive polling with **fake timers + `act`**, never by waiting real
  wall-clock for the poll interval.
- `setup.ts` afterEach already calls `cleanup()`, `vi.clearAllMocks()`, and
  `vi.useRealTimers()` — do not duplicate, but per-test `afterEach` may add an
  explicit `vi.useRealTimers()` for clarity when a test switches to fake timers.

### waitFor

- Put only the final stable assertion inside `waitFor`. Do not assert call
  counts inside `waitFor` unless the call count is itself a business contract.
- Keep `waitFor` conditions narrow (a specific text or role), not broad.

## 8. AI-generated code rules

When an agent (or human using an AI tool) adds frontend code:

- **Forbidden**: `div` + `useState` to simulate `Select` / `Dialog` /
  `DropdownMenu` / `DatePicker`. Always use the shadcn primitive.
- **Forbidden**: copy-pasting a "temporary" DatePicker / Dialog / Select from
  another project or a chat answer.
- **Forbidden**: hand-writing a popover, calendar grid, or focus trap inside a
  page component.
- **Required before generating**: check `components/ui/` for an existing
  primitive, and `components/shared/` for an existing wrapper. Reuse first.
- **Required**: any new interaction primitive goes in `components/ui/` (Radix
  / DayPicker backed) or `components/shared/` (wrapper). Never inline in a page.

## 9. Review checklist

Before approving a frontend change, confirm:

- [ ] Does it bypass shadcn/Radix for a complex interaction (Dialog, Select,
      Popover, DatePicker, DropdownMenu, Tooltip, Tabs)?
- [ ] Does it hand-write an interaction state machine inside a page?
- [ ] Does a page test query by `className` or Radix internal DOM?
- [ ] Does it introduce a new UI framework (Ant Design, MUI, …)?
- [ ] Does it break a business API contract, route, or permission?
- [ ] Are all `userEvent` calls `await`ed?
- [ ] Are fake timers paired with `userEvent.setup({ advanceTimers })` and
      wrapped in `act`?
- [ ] Does any test wait real wall-clock for a poll/debounce interval?

If any answer is "yes" and not explicitly justified, request changes.

## 10. Optional enforcement

`scripts/check-frontend-primitives.mjs` is an optional, low-false-positive
scanner that flags suspected handwritten primitives outside `components/ui/`.
It is **not** wired into CI by default; run it manually during review. It must
not flag legitimate business components such as row expanders (a
`useState`-driven `aria-expanded` on a `<tr>` is allowed). See the script
header for its allow-list.
