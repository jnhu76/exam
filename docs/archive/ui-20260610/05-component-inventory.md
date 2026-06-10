# Component Inventory

## shadcn/ui Components (24 installed)

All in `apps/web/src/components/ui/`. Do not hand-edit.

| Component | Status |
|-----------|--------|
| alert | ✅ installed |
| alert-dialog | ✅ installed |
| avatar | ✅ installed |
| badge | ✅ installed |
| button | ✅ installed |
| card | ✅ installed |
| checkbox | ✅ installed |
| dialog | ✅ installed |
| dropdown-menu | ✅ installed |
| form | ✅ installed |
| input | ✅ installed |
| label | ✅ installed |
| pagination | ✅ installed |
| radio-group | ✅ installed |
| select | ✅ installed |
| separator | ✅ installed |
| sheet | ✅ installed |
| skeleton | ✅ installed |
| sonner | ✅ installed |
| switch | ✅ installed |
| table | ✅ installed |
| tabs | ✅ installed |
| textarea | ✅ installed |
| tooltip | ✅ installed |

## Custom Business Components

### Layout

| Component | Path | Purpose | Exists | Needs Refactor | Job |
|-----------|------|---------|--------|----------------|-----|
| BrandProvider | `components/layout/BrandProvider.tsx` | Platform/org branding context | ✅ | Minor token update | J02 |
| BrandHeader | `components/layout/BrandHeader.tsx` | Brand display in login/sidebar/candidate | ✅ | Token update | J02 |
| AppSidebar | `components/layout/AppSidebar.tsx` | Admin sidebar navigation | ✅ | Active state, icons, grouping | J02 |
| AdminLayout | `components/layout/AdminLayout.tsx` | Sidebar + topbar + main | ✅ | Spacing, topbar rules | J02 |
| ExamLayout | `components/layout/ExamLayout.tsx` | Candidate minimal layout | ✅ | Token update | J02 |

### Shared

| Component | Path | Purpose | Exists | Needs Refactor | Job |
|-----------|------|---------|--------|----------------|-----|
| ImportWizard | `components/shared/ImportWizard.tsx` | Generic import dialog (upload→preview→confirm) | ✅ | Token update | J03 |
| PageHeader | `components/shared/PageHeader.tsx` | Page title + action area | ✅ | Verify tokens | J02 |
| StatsCard | `components/shared/StatsCard.tsx` | Dashboard statistics card | ✅ | Token update | J03 |
| EmptyState | `components/shared/EmptyState.tsx` | Empty state placeholder with icon, title, description | ✅ | Token update (border-dashed, spacing) | J01 |
| ErrorState | `components/shared/ErrorState.tsx` | Error state with retry button | ✅ | Token update | J01 |
| LoadingState | `components/shared/LoadingState.tsx` | Spinner with label, aria-busy | ✅ | Token update | J01 |
| ConfirmDialog | `components/shared/ConfirmDialog.tsx` | AlertDialog wrapper with destructive variant | ✅ | Token update | J02 |
| ConnectionIndicator | `components/shared/ConnectionIndicator.tsx` | Connection status dot + label (connected/degraded/offline) | ✅ | Use success/warning/destructive tokens instead of hardcoded colors | J05 |
| FileUpload | `components/shared/FileUpload.tsx` | CSV file upload button (hidden input trigger) | ✅ | Token update | J03 |

### Question

| Component | Path | Purpose | Exists | Needs Refactor | Job |
|-----------|------|---------|--------|----------------|-----|
| QuestionForm | `components/question/` | Question create/edit form | ✅ | Token update | J04 |
| QuestionPreview | `components/question/` | Question preview (candidate view) | ✅ | Token update | J04 |

### Exam

| Component | Path | Purpose | Exists | Needs Refactor | Job |
|-----------|------|---------|--------|----------------|-----|
| QuestionNav | `components/exam/QuestionNav.tsx` | Answer page left panel question navigation | ✅ | State colors, layout | J05 |
| ExamTimer | `components/exam/ExamTimer.tsx` | Countdown display | ✅ | Color for <5min | J05 |
| SaveIndicator | `components/exam/SaveIndicator.tsx` | Answer save status | ✅ | Token update | J05 |
| SingleChoiceInput | `components/exam/SingleChoiceInput.tsx` | Single choice answer | ✅ | Token update | J05 |
| MultipleChoiceInput | `components/exam/MultipleChoiceInput.tsx` | Multiple choice answer | ✅ | Token update | J05 |
| FillBlankInput | `components/exam/FillBlankInput.tsx` | Fill blank answer | ✅ | Token update | J05 |
| TrueFalseInput | `components/exam/TrueFalseInput.tsx` | True/false answer | ✅ | Token update | J05 |
| ExamConfigForm | `components/exam/ExamConfigForm.tsx` | Exam configuration form | ✅ | Token update | J04 |
| QuestionRenderer | `components/exam/QuestionRenderer.tsx` | Renders question by type during exam | ✅ | Token update | J05 |
| EnrollmentPicker | `components/exam/EnrollmentPicker.tsx` | Exam enrollment candidate picker | ✅ | Token update | J04 |

### Settings

| Component | Path | Purpose | Exists | Needs Refactor | Job |
|-----------|------|---------|--------|----------------|-----|
| PlatformSettingsForm | `components/settings/` | Platform/org display settings | ✅ | Token update | J04 |

## Components to Create (if missing)

| Component | Purpose | Job |
|-----------|---------|-----|
| StatusBadge | Pass/fail/pending status badges with semantic colors | J03 |
