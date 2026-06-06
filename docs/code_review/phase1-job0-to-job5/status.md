# Phase 1 Job 0-5 Fix Status

| Finding | Status          | Evidence                                                                                                                                                                                   |
| ------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF-001  | fixed           | Login resolves tenant slug and performs scoped username lookup.                                                                                                                            |
| RF-002  | fixed           | Login and cookie authentication reject disabled users.                                                                                                                                     |
| RF-003  | fixed           | Added admin settings GET, public branding fetch, and runtime refresh event.                                                                                                                |
| RF-004  | fixed           | Backend validates configured identity fields, duplicates, updates, template headers, and one unique identity field. UI supports dynamic CRUD, disable, template download, and CSV preview. |
| RF-005  | fixed           | Create and PATCH both enforce complete per-type question validation.                                                                                                                       |
| RF-006  | fixed           | Question and exam routes validate tenant-scoped course and question relations.                                                                                                             |
| RF-007  | fixed           | Create/update contracts and publish command restrict Phase 1 modes.                                                                                                                        |
| RF-008  | fixed           | Archive route delegates to `archiveExam()`.                                                                                                                                                |
| RF-009  | partially_fixed | Root lint and architecture checks are executable; API coverage is real. Existing route handler `any` annotations remain for later cleanup.                                                 |
| RF-010  | fixed           | Added unified Fastify handler for Zod, domain, constraint, and unknown errors.                                                                                                             |
| RF-011  | fixed           | Job 4 organization, user, candidate-field, and candidate pages expose usable create/edit and relevant delete, disable, reorder, and import actions.                                        |
| RF-012  | fixed           | Import endpoints support preview/confirm, max rows, and validation. Web flows use shared file upload and preview-confirm components.                                                       |
| RF-013  | fixed           | Added login-specific `10/min` limit.                                                                                                                                                       |
| RF-014  | fixed           | Production startup paths require `JWT_SECRET`.                                                                                                                                             |
| RF-015  | fixed           | Audit records cover branding, imports, publish/archive, and sensitive organization, user, candidate-field, candidate, course, question, and exam CRUD mutations.                           |
| RF-016  | fixed           | Bootstrap registration requires configured token and an explicit tenant.                                                                                                                   |
| RF-017  | fixed           | Web restores `/me` sessions and guards admin/candidate layouts by role.                                                                                                                    |
| RF-018  | fixed           | Added SQLite unique indexes and migration `0003_wild_argent.sql`.                                                                                                                          |
| RF-019  | fixed           | Added question filters and pagination, exam participant counts and detail statistics, participant rows, and exam-control presets.                                                          |
| RF-020  | fixed           | Question import is limited to 500 rows and `5/min`.                                                                                                                                        |
| RF-021  | fixed           | Course deletion returns conflict while questions remain.                                                                                                                                   |
| RF-022  | fixed           | Integration command now assembles API route tests and DB tests.                                                                                                                            |
| RF-023  | fixed           | Publish validates window, Phase 1 modes, course consistency, total, and passing score.                                                                                                     |
| RF-024  | fixed           | Added the required domain error classes.                                                                                                                                                   |

## Verification

- `pnpm verify`: passed
- `pnpm test:integration`: passed
- API tests: `60/60`
- DB integration tests: `10/10`
- Web tests: `91/91`
- Exam engine tests: `16/16`
- API coverage: statements `76.09%`, lines `76.75%`
- Web coverage: statements `55.78%`, lines `55.80%`
- DB coverage: statements and lines `71.20%`
