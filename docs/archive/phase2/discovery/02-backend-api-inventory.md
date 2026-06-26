# Backend API Inventory — Phase 1 Discovery

> All endpoints verified against route source code. Schema validated against contracts package.

## Legend

- **Status**: `implemented` | `partial` | `undocumented` | `doc-only` | `dead-code`
- **Auth**: `public` | `authenticate` | `requireRole([Role])`

## 1. Auth Routes (`/api/auth`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| POST | `/auth/register` | public | Returns 403 AUTH_REGISTER_DISABLED | — | — | auth.test.ts |
| POST | `/auth/login` | public (rate-limited: 10/min) | `auth.ts:32` → userRepo.findByOrganizationAndUsername, verifyPassword, signJWT | users, organizations | login.success / login.failure | auth.test.ts |
| POST | `/auth/logout` | public | `auth.ts:190` → clearCookie | — | logout | auth.test.ts |
| GET | `/auth/me` | authenticate | `auth.ts:218` → userRepo.findByOrganizationAndId | users | — | auth.test.ts |
| PATCH | `/auth/me/password` | authenticate | `auth.ts:243` → verifyPassword, hashPassword, userRepo.update | users | — | auth.test.ts |

## 2. Settings Routes (`/api`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| GET | `/settings/branding` | public | `settings.ts:16` → orgRepo.resolveBrandingTenant, settingsRepo.getPublicBranding | organizations, organization_settings | — | settings.test.ts |
| GET | `/admin/settings/branding` | Admin | `settings.ts:34` → settingsRepo.get | organization_settings | — | settings.test.ts |
| PATCH | `/admin/settings/branding` | Admin | `settings.ts:52` → settingsRepo.upsert | organization_settings | branding.update | settings.test.ts |

## 3. Candidate Field Routes (`/api`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| GET | `/candidate-fields` | Admin | `candidateField.ts:13` → repo.list | candidate_fields | — | candidateField.test.ts |
| POST | `/candidate-fields` | Admin | `candidateField.ts:29` → repo.create | candidate_fields | candidate_field.create | candidateField.test.ts |
| PATCH | `/candidate-fields/:id` | Admin | `candidateField.ts:61` → repo.update | candidate_fields | candidate_field.update | candidateField.test.ts |
| DELETE | `/candidate-fields/:id` | Admin | `candidateField.ts:105` → repo.delete | candidate_fields | candidate_field.delete | candidateField.test.ts |
| GET | `/candidate-fields/template` | Admin | `candidateField.ts:141` → repo.list | candidate_fields | — | candidateField.test.ts |

## 4. User Routes (`/api`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| GET | `/users` | Admin | `user.ts:18` → repo.listPaginatedByRoles | users | — | user.test.ts |
| POST | `/users` | Admin | `user.ts:53` → hashPassword, repo.createUnique | users | user.create | user.test.ts |
| PATCH | `/users/:id` | Admin | `user.ts:84` → repo.update (self-disable guard, last-admin guard) | users | user.update | user.test.ts |
| POST | `/users/:id/reset-password` | Admin | `user.ts:147` → hashPassword, repo.update (Candidate only) | users | candidate.password_reset | user.test.ts |
| DELETE | `/users/:id` | Admin | `user.ts:197` → repo.delete | users | user.delete | user.test.ts |

## 5. Candidate Routes (`/api`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| GET | `/candidates` | Admin | `candidate.ts:123` → repo.listPaginated + userRepo | candidate_profiles, users | — | candidate.test.ts |
| POST | `/candidates` | Admin | `candidate.ts:158` → validateCandidateFields, tx (userRepo.createUnique + candidateRepo.create) | users, candidate_profiles | candidate.create | candidate.test.ts |
| PATCH | `/candidates/:id` | Admin | `candidate.ts:243` → candidateRepo.update + userRepo.update | candidate_profiles, users | candidate.update | candidate.test.ts |
| POST | `/candidates/import` | Admin (rate-limited: 10/min) | `candidate.ts:295` → batch create/update | users, candidate_profiles | candidate.import | candidate.test.ts |

## 6. Course Routes (`/api`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| GET | `/courses` | Admin | `course.ts:14` → repo.listPaginated | courses | — | course.test.ts |
| GET | `/courses/:id` | Admin | `course.ts:43` → repo.findById | courses | — | course.test.ts |
| POST | `/courses` | Admin | `course.ts:70` → repo.create (duplicate code check) | courses | course.create | course.test.ts |
| PATCH | `/courses/:id` | Admin | `course.ts:108` → repo.update | courses | course.update | course.test.ts |
| DELETE | `/courses/:id` | Admin | `course.ts:141` → repo.delete (questions-exist guard) | courses, questions | course.delete | course.test.ts |

## 7. Question Routes (`/api`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| GET | `/questions` | Admin | `question.ts:19` → repo.list + filter (courseId/type/difficulty/tags) + paginate | questions | — | question.test.ts |
| GET | `/questions/:id` | Admin | `question.ts:82` → repo.findById | questions | — | question.test.ts |
| POST | `/questions` | Admin | `question.ts:116` → repo.create (courseId validation) | questions | question.create | question.test.ts |
| PATCH | `/questions/:id` | Admin | `question.ts:189` → repo.update | questions | question.update | question.test.ts |
| DELETE | `/questions/:id` | Admin | `question.ts:259` → repo.delete | questions | question.delete | question.test.ts |
| POST | `/questions/import` | Admin (rate-limited: 5/min) | `question.ts:279` → batch validate + create | questions | question.import | question.test.ts |

## 8. Exam Routes (`/api`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| GET | `/exams` | Admin | `exam.ts:174` → repo.listPaginated + participants + graded count | exams, exam_enrollments, candidate_profiles, users, exam_attempts | — | exam.test.ts |
| GET | `/exams/:id` | Admin | `exam.ts:219` → repo.findById + participants + stats | exams, exam_enrollments, candidate_profiles, users | — | exam.test.ts |
| POST | `/exams` | Admin | `exam.ts:251` → repo.create (course/question validation) | exams | exam.create | exam.test.ts |
| PATCH | `/exams/:id` | Admin | `exam.ts:326` → repo.update (draft-only guard) | exams | exam.update | exam.test.ts |
| POST | `/exams/:id/publish` | Admin | `exam.ts:389` → publishExam (state machine + snapshot) | exams | exam.publish | examStateMachine.test.ts |
| POST | `/exams/:id/archive` | Admin | `exam.ts:427` → archiveExam (state machine) | exams | exam.archive | exam.test.ts |
| DELETE | `/exams/:id` | Admin | `exam.ts:443` → repo.delete (draft-only guard) | exams | exam.delete | exam.test.ts |
| GET | `/exams/:examId/enrollments` | Admin | `exam.ts:470` → enrollmentRepo.list + candidateRepo + userRepo | exam_enrollments, candidate_profiles, users | — | enrollment.test.ts |
| POST | `/exams/:examId/enrollments` | Admin | `exam.ts:521` → enrollmentRepo.create (batch) | exam_enrollments | enrollment.add | enrollment.test.ts |
| DELETE | `/exams/:examId/enrollments/:enrollmentId` | Admin | `exam.ts:603` → enrollmentRepo.delete (assigned-only guard) | exam_enrollments | enrollment.remove | enrollment.test.ts |

## 9. Attempt Routes (`/api`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| GET | `/candidate/exams` | Candidate | `attempts.ts:397` → deriveCandidateExamState per enrollment | exam_enrollments, exams, exam_attempts, candidate_profiles | — | attempts.test.ts |
| GET | `/candidate/exams/:examId` | Candidate | `attempts.ts:508` → buildCandidateExamDetail | exams, exam_enrollments, exam_attempts, candidate_profiles | — | attempts.test.ts |
| POST | `/attempts/:examId/queue` | Candidate | `attempts.ts:567` → getQueueStatus (in-memory) | exams | — | — |
| POST | `/attempts/:examId/start` | Candidate | `attempts.ts:590` → startAttempt / restoreAttempt | exams, exam_enrollments, exam_attempts | attempt.start / attempt.restore | attempts.test.ts, examStateMachine.test.ts |
| GET | `/attempts/:id` | Candidate | `attempts.ts:695` → repo.findByIdAndCandidate | exam_attempts | — | attempts.test.ts |
| POST | `/attempts/:attemptId/answers/:questionId` | Candidate | `attempts.ts:713` → tx: findByIdForUpdate + processSaveAnswer + update | exam_attempts | attempt.saveAnswer | attempts.test.ts |
| POST | `/attempts/:attemptId/submit` | Candidate | `attempts.ts:853` → tx: submitAttempt + readGradingSnapshot + computeGradingResult + finalizeGrading | exam_attempts, exam_enrollments | attempt.submit | attempts.test.ts |
| POST | `/attempts/:attemptId/heartbeat` | Candidate | `attempts.ts:969` → repo.update(lastActivityAt) | exam_attempts | — | heartbeat.test.ts |
| POST | `/attempts/:attemptId/restore` | Candidate | `attempts.ts:997` → restoreAttempt | exam_attempts | attempt.restore | attempts.test.ts |

## 10. Score Routes (`/api`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| GET | `/exams/:id/scores` | Admin | `scores.ts:120` → attemptRepo.listGradedByExam + getGradedStats | exam_attempts, candidate_profiles, users, exams | — | scores.test.ts |
| GET | `/scores/attempts/:attemptId` | Candidate or Admin | `scores.ts:194` → findVisibleAttempt + exam check (showResultImmediately) | exam_attempts, exams, candidate_profiles | — | scores.test.ts |

## 11. Export Routes (`/api`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| GET | `/exams/:id/export/scores` | Admin | `export.ts:11` → attemptRepo.listGradedByExam + candidateFieldRepo + generateCSV | exam_attempts, candidate_fields, candidate_profiles, users | export_scores (via auditLogRepo) | export.test.ts |

## 12. System Routes (`/api`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| GET | `/system/info` | public | `system.ts:40` → process.uptime | — | — | system.test.ts |
| GET | `/system/public-config` | public | `system.ts:47` → buildPublicConfig | — | — | — |
| GET | `/system/health` | Admin | `system.ts:51` → os.cpus, os.freemem, statsRepo.pingDb | — (DB ping) | — | system.test.ts |
| GET | `/system/dashboard` | Admin | `system.ts:66` → statsRepo.getDashboardStats + getRecentExams | questions, exams, candidate_profiles, exam_attempts | — | system.test.ts |
| GET (builtin) | `/api/health` | public | `server.ts:54` → `{ status: "ok" }` | — | — | smoke.test.ts |

## 13. Audit Routes (`/api`)

| Method | Path | Auth | Handler | DB Tables | Audit | Tests |
|--------|------|------|---------|-----------|-------|-------|
| GET | `/admin/audit-logs` | Admin | `audit.ts:53` → repo.listPaginatedFiltered | audit_logs | — | audit.test.ts |

## 14. Plugins (Cross-cutting)

| Plugin | File | Purpose |
|--------|------|---------|
| auth | `plugins/auth.ts` | JWT verify, ctx injection, requireRole, requirePermission |
| tenant | `plugins/tenant.ts` | Organization data boundary |
| db | `plugins/db.ts` | Database connection injection |
| now | `plugins/now.ts` | Server time injection (`fastify.now()`) |
| heartbeat | `plugins/heartbeat.ts` | setInterval scan for stale attempts → markDisrupted |
| rateLimit | `plugins/rateLimit.ts` | Per-route rate limiting |
| security | `plugins/security.ts` | Security headers |
| cors | `plugins/cors.ts` | CORS configuration |
| errors | `plugins/errors.ts` | Global error handler → domain error mapping |

## 15. DB Tables (from `packages/db/src/schema/pg.ts`)

| Table | Key Columns | Indexes |
|-------|-------------|---------|
| organizations | id, name, displayName, slug | slug_unique |
| organization_settings | id, orgId, productName, productSubtitle, footerText, orgDisplayName, timezone | org_unique |
| candidate_fields | id, orgId, name, label, fieldType, required, unique, sortOrder | org_name_unique |
| users | id, orgId, username, passwordHash, name, role, isActive | org_username_unique |
| candidate_profiles | id, orgId, userId, fields (JSONB) | org_user_unique |
| courses | id, orgId, name, code, description | org_code_unique |
| questions | id, orgId, courseId, type, content, options (JSONB), standardAnswer (JSONB), attachments (JSONB), score, difficulty, tags (JSONB), gradingRule (JSONB) | — |
| exams | id, orgId, title, description, courseId, status, timingMode, durationMinutes, openAt, closeAt, passingScore, totalScore, questionSelectionMode, questionIds (JSONB), questionSnapshot (JSONB), controlFlags (JSONB), retakePolicy, scoreStrategy, maxAttempts | — |
| exam_enrollments | id, orgId, examId, candidateId, status, attemptCount, finalScore, finalPassed, finalAttemptId | org_exam_candidate_unique |
| exam_attempts | id, orgId, examId, enrollmentId, candidateId, attemptNo, status, questionSnapshot (JSONB), answers (JSONB), gradingResult (JSONB), score, passed, startedAt, deadlineAt, submittedAt, gradedAt, lastActivityAt | org_enrollment_attempt_unique |
| audit_logs | id, orgId, actorId, action, targetType, targetId, metadata (JSONB), ipAddress, userAgent | — |

## 16. Transactions / Locking

| Location | Mechanism | Purpose |
|----------|-----------|---------|
| `attempts.ts:734` saveAnswer | `executeInTransaction` + `findByIdForUpdate` | Prevent concurrent answer corruption |
| `attempts.ts:866` submit | `executeInTransaction` + `findByIdForUpdate` | Prevent double-submit |
| `attempts.ts:937` finalizeGrading | `executeInTransaction` + `findByIdForUpdate` | Atomic grading + enrollment update |
| `candidate.ts:184` createCandidate | `executeInTransaction` | Atomic user + candidate profile creation |
| `heartbeat.ts` scan | No transaction (individual markDisrupted) | Batch scan without atomicity |

## 17. API Count Summary

- **Total unique endpoints**: 42
- **Public endpoints**: 5 (`/auth/login`, `/auth/logout`, `/settings/branding`, `/system/info`, `/system/public-config`, `/api/health`)
- **Admin endpoints**: 29
- **Candidate endpoints**: 8
- **Dual-role endpoints**: 1 (`GET /scores/attempts/:attemptId`)

## 18. Audit Actions Logged

| Action | Trigger |
|--------|---------|
| login.success / login.failure | POST /auth/login |
| logout | POST /auth/logout |
| user.create / user.update / user.delete | User CRUD |
| candidate.create / candidate.update / candidate.import | Candidate CRUD |
| candidate.password_reset | POST /users/:id/reset-password |
| candidate_field.create / .update / .delete | CandidateField CRUD |
| course.create / course.update / course.delete | Course CRUD |
| question.create / question.update / question.delete / question.import | Question CRUD |
| exam.create / exam.update / exam.publish / exam.archive / exam.delete | Exam lifecycle |
| enrollment.add / enrollment.remove | Enrollment management |
| attempt.start / attempt.restore / attempt.saveAnswer / attempt.submit | Attempt lifecycle |
| branding.update | Settings update |
| export_scores | CSV export |
