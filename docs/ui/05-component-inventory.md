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
| EmptyState | (needs check) | Empty state placeholder | ❓ | Create if missing | J01 |
| ErrorState | (needs check) | Error state with retry | ❓ | Create if missing | J01 |
| ConfirmDialog | (needs check) | Confirmation dialog wrapper | ❓ | Create if missing | J02 |
| ConnectionIndicator | (needs check) | Connection status indicator | ❓ | Create if needed | J05 |

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
| SingleChoiceInput | `components/exam/` | Single choice answer | ✅ | Token update | J05 |
| MultipleChoiceInput | `components/exam/` | Multiple choice answer | ✅ | Token update | J05 |
| FillBlankInput | `components/exam/` | Fill blank answer | ✅ | Token update | J05 |
| TrueFalseInput | `components/exam/` | True/false answer | ✅ | Token update | J05 |
| ExamConfigForm | `components/exam/` | Exam configuration form | ✅ | Token update | J04 |

### Settings

| Component | Path | Purpose | Exists | Needs Refactor | Job |
|-----------|------|---------|--------|----------------|-----|
| PlatformSettingsForm | `components/settings/` | Platform/org display settings | ✅ | Token update | J04 |

## Components to Create (if missing)

| Component | Purpose | Job |
|-----------|---------|-----|
| EmptyState | Standardized empty state with icon, message, CTA | J01 |
| ErrorState | Error state with message and retry | J01 |
| ConfirmDialog | AlertDialog wrapper with consistent styling | J02 |
| FileUpload | Drag-and-drop file upload for imports | J04 |
| StatusBadge | Pass/fail/pending status badges | J03 |
