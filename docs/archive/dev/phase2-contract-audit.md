# Phase 2 Contract Audit

> Phase E of Phase 2 收口. Audit the API contract for stability: error codes,
> HTTP statuses, response shapes, tenant boundary, time authority, and
> idempotency. Goal: confirm the frontend, backend, and tests are not relying
> on implicit behavior. No business semantics changed.

## Summary

The Phase 2 contract is **largely stable and consistent**. There is a single
canonical error envelope (`ErrorResponseSchema`), a centralized error handler
that normalizes legacy codes, and a frontend that reads `error.code` (not
message text). One localized inconsistency exists: `course.ts` returns ad-hoc
error bodies that bypass the envelope (SHOULD FIX). Error codes are defined
once in `packages/domain/src/errors.ts` (AppError subclasses) and mirrored in
`packages/contracts/src/messageRegistry.ts` (ErrorCode union + zh-CN messages).
Tenant boundary is enforced via `ctx.organizationId` on every repo method. Time
authority is `fastify.now()` in business paths (ADR-006 guardrail active).
Submit/force-submit/archive transitions are idempotent.

## API contract matrix

(Status column: ✓ consistent, ⚠ minor divergence. Compact view — full
per-endpoint detail in phase2-scope.md §API inventory.)

| Method | Path | Success status | Success body | Error codes | Audit action | Tenant | Time source | Tests | Finding |
|---|---|---:|---|---|---|---|---|---|---|
| POST | /api/auth/login | 200 | LoginResponseSchema | AUTH_INVALID_CREDENTIALS (401) | login.* | ctx from user | — | ✓ | ✓ |
| GET | /api/auth/me | 200 | MeResponseSchema | RESOURCE_NOT_FOUND (404) | — | ctx | — | ✓ | ✓ |
| PATCH | /api/auth/me/password | 200 | {ok} | VALIDATION_ERROR, CURRENT_PASSWORD_INVALID | — | ctx | — | ✓ | ✓ |
| GET/POST | /api/users | 200/201 | userItem/List | USER_ALREADY_EXISTS (409) | user.create | ctx | — | ✓ | ✓ |
| PATCH/DELETE | /api/users/:id | 200/204 | user/null | CANNOT_DISABLE_SELF, LAST_ACTIVE_ADMIN | user.* | ctx | — | ✓ | ✓ |
| GET/POST | /api/candidates | 200/201 | candidate | CANDIDATE_IDENTITY_CONFLICT, USER_ALREADY_EXISTS | candidate.create | ctx | — | ✓ | ✓ |
| POST | /api/candidates/import | 200 | import result | per-row codes in body | candidate.import | ctx | — | ✓ | ✓ |
| GET/POST/PATCH/DELETE | /api/candidate-fields | 200/201/204 | field/null | CANDIDATE_IDENTITY_FIELD_CONFLICT, CANDIDATE_FIELD_IN_USE | candidate_field.* | ctx | — | ✓ | ✓ |
| GET/POST/PATCH/DELETE | /api/courses | 200/201/204 | course/null | **ad-hoc** NOT_FOUND/DUPLICATE/CONFLICT (no requestId) | course.* | ctx | — | ✓ | ⚠ SHOULD FIX |
| GET/POST/PATCH/DELETE | /api/questions | 200/201/204 | question/null | RESOURCE_NOT_FOUND, QUESTION_COURSE_MISMATCH | question.* | ctx | — | ✓ | ✓ |
| POST | /api/questions/import | 200 | import result | VALIDATION_ERROR | question.import | ctx | — | ✓ | ✓ |
| GET/POST/PATCH/DELETE | /api/exams | 200/201/204 | exam/null | RESOURCE_NOT_FOUND, EXAM_UPDATE_NOT_ALLOWED | exam.* | ctx | fastify.now() (reconcile) | ✓ | ✓ |
| POST | /api/exams/:id/{publish,unpublish,close,extend,cancel,archive} | 200 | ExamSchema | EXAM_*_NOT_ALLOWED (idempotent-safe) | exam.* + recon | ctx | fastify.now() | ✓ | ✓ |
| POST | /api/exams/:id/publish-results | 200 | {ok,resultsPublishedAt,alreadyPublished} | EXAM_PUBLISH_RESULTS_NOT_ALLOWED | exam.publish_results | ctx | fastify.now() | ✓ | ✓ |
| GET/POST/DELETE | /api/exams/:id/enrollments | 200/204 | enrollment/null | ENROLLMENT_NOT_REMOVABLE | enrollment.* | ctx | — | ✓ | ✓ |
| GET | /api/candidate/exams[/:id] | 200 | candidate view | NOT_FOUND | — | ctx | reconcileExamForRead (fastify.now()) | ✓ | ✓ |
| POST | /api/attempts/:examId/start | 201/200 | LoadAttempt | CONFLICT, ATTEMPT_*, MAX_ATTEMPTS, EXAM_* | attempt.start/restore | ctx | fastify.now() | ✓ | ✓ |
| POST | /api/attempts/:id/answers/:qid | 200 | accepted/rejected union | rejections in body (STALE_VERSION etc.) | attempt.saveAnswer | ctx | fastify.now() | ✓ | ✓ |
| POST | /api/attempts/:id/submit | 200 | LoadAttempt | ATTEMPT_CLOSED, ATTEMPT_SUBMIT_TOO_EARLY | attempt.submit | ctx | fastify.now() | ✓ | idempotent |
| POST | /api/attempts/:id/heartbeat | 200 | {ok,serverNow} | INVALID_STATE_TRANSITION | — | ctx | fastify.now() (serverNow) | ✓ | ✓ |
| POST | /api/attempts/:id/restore | 200 | LoadAttempt | INVALID_STATE_TRANSITION | attempt.restore | ctx | fastify.now() | ✓ | ✓ |
| POST | /api/admin/attempts/:id/force-submit | 200 | LoadAttempt | INVALID_STATE_TRANSITION (voided) | attempt.forceSubmit | ctx | fastify.now() | ✓ | idempotent |
| POST | /api/admin/attempts/:id/misconduct | 200 | FlagMisconduct | INVALID_STATE_TRANSITION | attempt.misconductFlagged | ctx | fastify.now() | ✓ | ✓ |
| POST | /api/admin/attempts/:id/extend-time | 200 | LoadAttempt | DEADLINE_EXCEEDS_EXAM_CLOSE, ATTEMPT_CLOSED | attempt.extendTime | ctx | fastify.now() | ✓ | ✓ |
| GET | /api/admin/attempts/:id/{timeline,export,export/csv} | 200 | timeline/json/csv | NOT_FOUND | attempt.exported | ctx | — | ✓ | ✓ |
| GET | /api/admin/grading-queue | 200 | list | VALIDATION_ERROR | — | ctx | — | ✓ | ✓ |
| POST | /api/admin/attempts/:id/grade-question | 200 | GradeQuestion | NOT_FOUND | grading.score_entered/finalized | ctx | fastify.now() | ✓ | ✓ |
| GET | /api/exams/:id/scores | 200 | ScoreList | EXAM_CANCELED_RESULTS_UNAVAILABLE, UNRESOLVED_ATTEMPTS_EXIST, EXAM_NOT_FINISHED | — | ctx | — | ✓ | ✓ |
| GET | /api/scores/attempts/:id | 200 | result (full or hidden) | NOT_FOUND | — | ctx | — | ✓ | gated by publication mode |
| GET | /api/exams/:id/export/scores | 200 | csv | EXAM_CANCELED_RESULTS_UNAVAILABLE, UNRESOLVED_ATTEMPTS_EXIST | export_scores | ctx | Date.now() (filename only) | ✓ | ✓ (allowlisted) |
| GET | /api/system/* | 200 | system schemas | — | — | ctx (admin) | fastify.now() (redis latency) | ✓ | ✓ |
| GET/PATCH | /api/settings/branding | 200 | branding | INTERNAL_ERROR (upsert null) | branding.update | ctx | — | ✓ | ✓ |

## Error code findings

- **Canonical source**: `packages/domain/src/errors.ts` — every business error
  is an `AppError` subclass carrying its own `code` + `statusCode`. 31 subclasses.
- **Code registry**: `packages/contracts/src/messageRegistry.ts` — `ErrorCode`
  union (40 codes) with default zh-CN messages + `getErrorMessage(code, locale)`.
- **Legacy normalization**: `apps/api/src/lib/errorResponse.ts:11` maps legacy
  codes (`NOT_FOUND`→`RESOURCE_NOT_FOUND`, `CONFLICT`→`RESOURCE_CONFLICT`, etc.)
  so clients always see the canonical code. `NotFoundError.code="NOT_FOUND"`
  therefore surfaces as `RESOURCE_NOT_FOUND` to clients — not a leak.
- **Status→code fallback** (`errorResponse.ts:32`): 401→AUTH_REQUIRED,
  403→PERMISSION_DENIED, 404→RESOURCE_NOT_FOUND, 409→RESOURCE_CONFLICT,
  429→RATE_LIMITED, other 4xx→VALIDATION_ERROR, else→INTERNAL_ERROR.
- **Consistency**: 401/403/404/409/422(400) semantics are consistent across
  routes. The only divergence is `course.ts` (ad-hoc bodies, see SHOULD FIX).
- **No ad-hoc string errors in handlers**: all non-course handlers throw
  `AppError` subclasses or rely on the zod-validation→400 path. No bare
  `throw new Error()` in business paths.
- **Frontend reads code, not text**: `api.ts:62` extracts `body.error?.code`;
  localized messages come from the registry, not the response body. Good — the
  frontend does not depend on non-contract error text.

## Response shape findings

- **Success**: uniform — each route declares a Zod response schema; Fastify
  serializes/validates. List endpoints use `PaginatedResponseSchema<T>`.
- **Error**: uniform envelope `ErrorResponseSchema { error: { code, message,
  details?, requestId } }`. `requestId` is always `request.id` (correlation),
  required (`min(1)`). Built by `buildErrorResponse(requestId, code, details)`.
- **204 semantics**: correct — `reply.code(204).send()` with schema `z.null()`
  on delete/logout endpoints. No body on 204. ✓
- **201/200**: correct — POST-create returns 201; transitions/updates return
  200. `start` returns 201 (new) or 200 (restore). ✓
- **Divergence**: `course.ts` GET/POST/PATCH/DELETE return
  `{ error: { code, message } }` ad-hoc (no `requestId`, not
  `ErrorResponseSchema`, legacy codes). This is the single shape inconsistency.

## Tenant boundary findings

- **organizationId source**: always from `ctx` (auth context), never from
  request body or query. `ctx.organizationId` is set by the auth/tenant plugin
  from the authenticated user's org.
- **No route trusts body/query organizationId**: confirmed across all route
  files — no `req.body.organizationId` or `req.query.organizationId` is read
  to scope a mutation.
- **Repo enforcement**: every repo method takes `ctx` first; tenant-scoped
  repos filter `WHERE organization_id = resolveOrganizationId(ctx)`. 10/13
  tables are tenant-scoped; `organizations` (root), `organization_settings`
  (1:1 to org), and cross-tenant `organizationRepo` are the exceptions by
  design.
- **Index support**: tenant queries are backed by unique indexes on
  `(organizationId, business-key)` for users, candidates, courses, enrollments,
  attempts, candidate-fields, settings. `questions`, `audit_logs`, and `exams`
  have **no supporting index** for org-scoped list/filter queries (SHOULD FIX
  for performance, not correctness — the WHERE clause still filters correctly).

## Time authority findings

- **Canonical source**: `fastify.now()` (plugins/now.ts), overridable for tests.
  Business paths capture `now` per request/tick and thread it through.
- **ADR-006 guardrail active**: `time-authority.structural.test.ts` scans all
  business-path source for raw `new Date()` / `Date.now()` / SQL `now()`
  outside a short allowlist. It is **green** (fixed in Phase C: system.ts Redis
  latency now uses `fastify.now()`).
- **Allowlist (legitimate non-business sites)**: now.ts (canonical),
  baseRepo/systemStatsRepo/organizationRepo/settingsRepo (storage stamps),
  export.ts (CSV filename suffix only), testHelpers (fixtures),
  answerProtocol.ts (the documented `state.now ?? new Date()` fallback, never
  reached in production).
- **No bare `new Date()` in business paths**: confirmed by the guardrail. All
  exam/attempt/enrollment/deadline/restore/force-submit/extend/score-export
  logic uses `fastify.now()` or an explicit `now: Date` param.
- **Test time control**: `fastify.setNowOverride(provider)` lets tests freeze
  time; the scanners and routes consume the override. ✓

## Idempotency findings

| Operation | Idempotent? | Evidence |
|---|---|---|
| submitAttempt | ✓ yes | attemptCommands.ts:249-256 — already-submitted/grading/graded returns the attempt as-is BEFORE any other guard |
| force-submit | ✓ yes | submitAttempt(proctor) reuses the idempotent path; voided-status guard prevents double-effect |
| restore | ✓ yes | startOrRestoreAttempt returns existing active attempt (isNew:false) if one exists |
| publish / unpublish / close / extend / cancel / archive | ✓ yes | each `Exam*NotAllowedError` is thrown on a no-op second call (no partial mutation); archive skips audit if already archived |
| publish-results | ✓ yes | returns `{ alreadyPublished: true }` on repeat |
| saveAnswer | ✓ versioned | processSaveAnswer is versioned+idempotent (clientSeq/baseVersion); STALE_VERSION rejected, last-write-wins reconciliation |
| deadline scanner auto-submit | ✓ yes | FOR UPDATE lock + idempotent submitAttempt; re-runs are no-ops |
| heartbeat | ✓ safe | updates lastActivityAt only; no state transition unless disrupt guard fires |

## MUST FIX

None. The contract is stable; the course.ts divergence is SHOULD FIX (it does
not break clients because the frontend still reads `.error.code`, but the codes
`NOT_FOUND`/`DUPLICATE`/`CONFLICT` are legacy aliases not present in the
ErrorCode union, and the body lacks `requestId`).

## SHOULD FIX

- **course.ts error envelope**: replace ad-hoc `{error:{code,message}}` with
  `buildErrorResponse(requestId, canonicalCode)` / throw `AppError` subclasses,
  so responses match `ErrorResponseSchema` (with `requestId`) and use canonical
  codes (`RESOURCE_NOT_FOUND`, `RESOURCE_CONFLICT`). Localized to course.ts.
  Low risk, mechanical.

## DEFER

- Consolidate the two audit-recording paths (fire-and-forget `recordAudit` vs
  awaited `createAuditLogRepo().create()`) for audit reliability — Phase 3 if
  audit guarantees become a requirement.
- Add indexes on `questions`, `audit_logs`, `exams` for org-scoped list/filter
  performance (correctness is unaffected; this is a perf/Phase-3 concern).

## Commands run

| Command | Result | Notes |
|---|---|---|
| grep ErrorResponseSchema | envelope = {error:{code,message,details?,requestId}} | common.ts:57 |
| grep requestId in errors.ts | always request.id | errors.ts:88-128 |
| grep frontend error.code | api.ts:62 reads body.error?.code | code-driven, not text |
| read submitAttempt idempotency | already-submitted returns as-is first | attemptCommands.ts:249-256 |
| run time-authority.structural.test.ts | PASS (2/2) | ADR-006 guardrail green after Phase C |
| grep organizationId from body/query | none found | tenant boundary enforced via ctx only |
