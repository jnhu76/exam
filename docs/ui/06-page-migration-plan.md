# Page Migration Plan

## Migration Priority

Pages are ordered by visual impact and dependency: high-traffic pages first, admin pages by complexity.

## Page Status

### Tier 1: Foundation (J01-J03)

| Page | Route | Current Status | UI Issues | Job | Migration |
|------|-------|---------------|-----------|-----|-----------|
| Dashboard | `/admin/dashboard` | Built | Default blue, no visual hierarchy | J03 | todo |
| Candidate Management | `/admin/candidates` | Built | Generic table, no spacing standard | J03 | todo |
| Candidate Import | dialog | Built | Functional, needs token update | J03 | todo |

### Tier 2: Core Admin (J04)

| Page | Route | Current Status | UI Issues | Job | Migration |
|------|-------|---------------|-----------|-----|-----------|
| Exam Management | `/admin/exams` | Built | Default component look | J04 | todo |
| Exam Create | `/admin/exams/new` | Built | Long form, needs section styling | J04 | todo |
| Exam Detail | `/admin/exams/:id` | Built | Token update | J04 | todo |
| Question Management | `/admin/questions` | Built | Table + filter styling | J04 | todo |
| Question Create/Edit | `/admin/questions/new`, `/:id/edit` | Built | Form + preview layout | J04 | todo |
| Score Management | `/admin/exams/:id/scores` | Built | Dynamic columns, stats bar | J04 | todo |
| User Management | `/admin/users` | Built | Simple CRUD table | J04 | todo |
| Organization Management | `/admin/organizations` | Built | SuperAdmin only, simple CRUD | J04 | todo |
| Platform Settings | `/admin/settings` | Built | Form layout | J04 | todo |
| Candidate Fields | `/admin/candidate-fields` | Built | Table with drag-sort | J04 | todo |
| System Health | `/admin/system` | Built | Stats cards | J04 | todo |

### Tier 3: Candidate-Facing (J05)

| Page | Route | Current Status | UI Issues | Job | Migration |
|------|-------|---------------|-----------|-----|-----------|
| Exam List | `/exam/list` | Built | Card layout, status indicators | J05 | todo |
| Exam Start | `/exam/:id/start` | Built | Info summary, queue UI | J05 | todo |
| Exam Take | `/exam/:id/take` | Built | Question nav, timer, save status | J05 | todo |
| Exam Result | `/exam/:id/result` | Built | Score display, answer review | J05 | todo |

### Tier 4: QA (J06)

No separate pages. J06 verifies all pages pass local-first and accessibility checks.

## Per-Page Migration Checklist

For each page migration:

1. Apply design tokens (colors, spacing, typography)
2. Use `PageHeader` component for title + actions
3. Handle loading/empty/error states
4. Verify responsive behavior (min 1024px)
5. Verify keyboard navigation
6. Verify Chinese text rendering
7. No hardcoded strings (use settings/config)
