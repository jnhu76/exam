# Fastify OpenAPI Read-Only Audit Report

**Date:** 2026-07-01
**Scope:** apps/api/src/openapi/*, apps/api/src/server.ts, apps/api/src/routes/*, apps/api/src/plugins/*, packages/contracts/*, apps/web/src/lib/api*

---

## 1. Executive Summary

OpenAPI infrastructure exists and works: a dedicated Fastify instance registers route plugins with mock auth stubs, runs `jsonSchemaTransform` from `fastify-type-provider-zod`, and serves Swagger UI at `/_dev/api-reference/` when `API_DOCS_ENABLED=true`. Structural tests guard ~15 priority routes.

**But the spec has no CI gate, no drift detection, and zero downstream consumers.** The frontend API client is hand-written with no type imports from contracts or the spec. Four route modules in `server.ts` are entirely absent from the swagger build. Most non-priority routes lack response schemas. CSV export routes declare `200: z.string()` but the spec labels them `application/json`.

**Biggest blocker:** no regression test or `git diff --exit-code` means the spec can silently diverge from reality on any commit.

---

## 2. Current Architecture

### Generation Chain

| Step | File | Role |
|------|------|------|
| Config | `openapi/config.ts` | OpenAPI 3.0.3 metadata, `cookieAuth` scheme, `jsonSchemaTransform` |
| Spec builder | `openapi/swagger.ts` | Throwaway Fastify app, same route plugins as server, mock auth, `app.swagger()` |
| Runtime docs | `openapi/registerDocs.ts` | Conditionally registers `@fastify/swagger` + `@fastify/swagger-ui` |
| Basic tests | `openapi/openapi.test.ts` | Generation validity, probe routes, health endpoint |
| Structural tests | `openapi/openapi.structural.test.ts` | Baseline guards for priority paths, unions, security, generic 2xx |

### Runtime Enforcement

- `zodProviderPlugin` registers `validatorCompiler` + `serializerCompiler` on the real server — response payloads are serialized against declared Zod schemas at the boundary.
- The swagger app registers the same compilers, so the spec mirrors runtime shape.
- `serializerCompiler` is present in both apps; response mismatches would produce a 500 at runtime.

### What's Missing

- No `pnpm api:openapi` or `generate-openapi` script.
- No committed `openapi.json` artifact.
- No `git diff --exit-code` drift gate in CI.
- No frontend type generation from the spec or from contracts.
- 5 route modules registered in `server.ts` are absent from the swagger build.

---

## 3. Route Coverage Diff (Section B)

### Server-registered routes (18 modules)

| # | Module | Prefix | In swagger? |
|---|--------|--------|-------------|
| 1 | `authRoutes` | `/api/auth` | Yes |
| 2 | `settingsRoutes` | `/api` | Yes |
| 3 | `candidateFieldRoutes` | `/api` | Yes |
| 4 | `userRoutes` | `/api` | Yes |
| 5 | `roleAssignmentRoutes` | `/api` | **NO** |
| 6 | `candidateRoutes` | `/api` | Yes |
| 7 | `courseRoutes` | `/api` | Yes |
| 8 | `questionRoutes` | `/api` | Yes |
| 9 | `examRoutes` | `/api` | Yes |
| 10 | `attemptRoutes` | `/api` | Yes |
| 11 | `scoreRoutes` | `/api` | Yes |
| 12 | `exportRoutes` | `/api` | Yes |
| 13 | `systemRoutes` | `/api` | Yes |
| 14 | `auditRoutes` | `/api` | Yes |
| 15 | `importLogRoutes` | `/api` | **NO** |
| 16 | `clientEventRoutes` | `/api` | **NO** |
| 17 | `proctorMonitoringRoutes` | `/api` | **NO** |
| 18 | `emailRoutes` | `/api` | **NO** |

**Inline route:** `GET /api/health` — registered in both `swagger.ts` (with typed schema) and `server.ts` (without schema). Present in spec.

### Routes in spec but not in server

None — the swagger app only registers modules that also exist in `server.ts`.

### Missing routes by module

**roleAssignmentRoutes (5 routes):**
- `GET /api/roles/assignable`
- `GET /api/users/:id/role-assignments`
- `POST /api/users/:id/role-assignments`
- `PATCH /api/role-assignments/:assignmentId`
- `DELETE /api/role-assignments/:assignmentId`

**importLogRoutes (1 route):**
- `GET /api/admin/import-logs`

**clientEventRoutes (1 route):**
- `POST /api/client-events`

**proctorMonitoringRoutes (2 routes):**
- `GET /api/admin/exams/:examId/proctor/attempts`
- `GET /api/admin/attempts/:attemptId/proctor-events`

**emailRoutes (1 route):**
- `POST /api/email/test`

**Total missing: 10 routes invisible in the spec.**

---

## 4. 2xx Response Schema Audit (Section C)

| Method | Path | Declared 2xx | Handler status | Issue | Severity |
|--------|------|-------------|----------------|-------|----------|
| GET | /api/exams/:id/export/scores | 200: z.string() | 200 + text/csv | Spec says application/json string, server sends text/csv | P0 |
| GET | /api/admin/attempts/:attemptId/export/csv | 200: z.string() | 200 + text/csv | Same mislabel; `x-content-types` is a non-standard extension ignored by swagger | P0 |
| GET | /api/admin/attempts/:attemptId/export | 200: AttemptExportResponseSchema | 200 | OK — typed JSON | — |
| POST | /api/attempts/:examId/start | 200 + 201: LoadAttemptResponseSchema | 200 or 201 | Both status codes share one schema; code-gen cannot distinguish | P1 |
| POST | /api/auth/register | 403 only | 403 | Correct — always 403, no 2xx declared | — |
| POST | /api/auth/logout | 204: z.null() | 204 | Correct — no JSON body | — |
| DELETE | /api/exams/:id | 204: z.null() | 204 | Correct | — |
| DELETE | /api/users/:id | 204: z.null() | 204 | Correct | — |
| DELETE | /api/questions/:id | 204: z.null() | 204 | Correct | — |
| DELETE | /api/courses/:id | 204: z.null() | 204 | Correct | — |
| DELETE | /api/candidate-fields/:id | 204: z.null() | 204 | Correct | — |
| DELETE | /api/exams/:examId/enrollments/:enrollmentId | 204: z.null() | 204 | Correct | — |
| DELETE | /api/role-assignments/:assignmentId | 204: z.null() | 204 | Correct | — |
| GET | /api/health | 200: {status: string} | 200 | Spec typed; server has no schema (inconsistent) | P2 |
| POST | /api/client-events | 200: {accepted: number} | 200 | Route not in swagger — invisible | P0 |
| POST | /api/email/test | 200: SendTestEmailResponseSchema | 200 | Route not in swagger — invisible | P0 |
| GET | /api/admin/import-logs | 200: ImportLogListResponseSchema | 200 | Route not in swagger — invisible | P0 |
| GET | /api/admin/grading-queue | 200: GradingQueueListResponseSchema | 200 | In swagger via attemptRoutes (gradingQueue registered there) | — |
| POST | /api/admin/attempts/:attemptId/grade-question | 200: GradeQuestionResponseSchema | 200 | In swagger | — |

### Summary counts

- Routes with correctly typed 2xx: ~50
- Routes with 204 + z.null(): 7 (all correct)
- Routes with CSV content but spec says JSON: 2 (P0)
- Routes entirely absent from spec: 10 (P0)
- Routes where both 200/201 share one schema: 1 (P1)
- Routes with untyped health probe: 1 (P2)

---

## 5. Request Schema Audit (Section D)

| Method | Path | Body/Query/Params in handler | Schema registered? | OpenAPI visible? | Issue |
|--------|------|------------------------------|--------------------|--------------------|-------|
| POST | /api/auth/login | body: LoginRequestSchema | Yes | Yes | OK |
| POST | /api/auth/register | none | Only 403 response | Yes | OK — always rejects |
| GET | /api/auth/me | none | security only | Yes | OK |
| PATCH | /api/auth/me/password | body: ChangePasswordRequestSchema | Yes | Yes | OK |
| PATCH | /api/auth/me/profile | body: UpdateProfileRequestSchema | Yes | Yes | OK |
| GET | /api/exams | querystring: PaginationParamsSchema | Yes | Yes | OK |
| POST | /api/exams | body: CreateExamRequestSchema | Yes | Yes | OK |
| GET | /api/exams/:id | params: idParamsSchema | Yes | Yes | OK |
| PATCH | /api/exams/:id | params + body | Yes | Yes | OK |
| POST | /api/exams/:id/publish | params | Yes | Yes | OK |
| POST | /api/exams/:id/close | params + body | Yes | Yes | OK |
| POST | /api/exams/:id/extend | params + body | Yes | Yes | OK |
| POST | /api/exams/:id/cancel | params + body | Yes | Yes | OK |
| POST | /api/exams/:id/archive | params | Yes | Yes | OK |
| POST | /api/exams/:id/publish-results | params | Yes | Yes | OK |
| DELETE | /api/exams/:id | params | Yes | Yes | OK |
| GET | /api/exams/:examId/enrollments | params: examIdParamsSchema | Yes | Yes | OK |
| POST | /api/exams/:examId/enrollments | params + body | Yes | Yes | OK |
| DELETE | /api/exams/:examId/enrollments/:enrollmentId | params | Yes | Yes | OK |
| GET | /api/admin/exams/:examId/candidates/status | params | Yes | Yes | OK |
| GET | /api/candidate/exams | none | Yes | Yes | OK |
| GET | /api/candidate/exams/:examId | params | Yes | Yes | OK |
| POST | /api/attempts/:examId/queue | params | Yes | Yes | OK |
| POST | /api/attempts/:examId/start | params | Yes | Yes | OK |
| GET | /api/attempts/:id | params | Yes | Yes | OK |
| POST | /api/attempts/:attemptId/answers/:questionId | params + body | Yes | Yes | OK |
| POST | /api/attempts/:attemptId/submit | params | Yes | Yes | OK |
| POST | /api/attempts/:attemptId/heartbeat | params | Yes | Yes | OK |
| POST | /api/attempts/:attemptId/restore | params | Yes | Yes | OK |
| POST | /api/admin/attempts/:attemptId/misconduct | params + body | Yes | Yes | OK |
| POST | /api/admin/attempts/:attemptId/force-submit | params + body | Yes | Yes | OK |
| POST | /api/admin/attempts/:attemptId/extend-time | params + body | Yes | Yes | OK |
| GET | /api/admin/attempts/:attemptId/timeline | params | Yes | Yes | OK |
| GET | /api/admin/attempts/:attemptId/export | params | Yes | Yes | OK |
| GET | /api/admin/attempts/:attemptId/export/csv | params | Yes | Yes | OK |
| GET | /api/scores/attempts/:attemptId | params | Yes | Yes | OK |
| GET | /api/exams/:id/scores | params + querystring | Yes | Yes | OK |
| GET | /api/exams/:id/export/scores | params | Yes | Yes | OK |
| GET | /api/users | querystring | Yes | Yes | OK |
| POST | /api/users | body | Yes | Yes | OK |
| PATCH | /api/users/:id | params + body | Yes | Yes | OK |
| POST | /api/users/:id/reset-password | params + body | Yes | Yes | OK |
| DELETE | /api/users/:id | params | Yes | Yes | OK |
| GET | /api/candidates | querystring | Yes | Yes | OK |
| POST | /api/candidates | body | Yes | Yes | OK |
| PATCH | /api/candidates/:id | params + body | Yes | Yes | OK |
| POST | /api/candidates/import | body | Yes | Yes | OK |
| GET | /api/courses | querystring | Yes | Yes | OK |
| GET | /api/courses/:id | params | Yes | Yes | OK |
| POST | /api/courses | body | Yes | Yes | OK |
| PATCH | /api/courses/:id | params + body | Yes | Yes | OK |
| DELETE | /api/courses/:id | params | Yes | Yes | OK |
| GET | /api/questions | querystring | Yes | Yes | OK |
| GET | /api/questions/:id | params | Yes | Yes | OK |
| POST | /api/questions | body | Yes | Yes | OK |
| PATCH | /api/questions/:id | params + body | Yes | Yes | OK |
| DELETE | /api/questions/:id | params | Yes | Yes | OK |
| POST | /api/questions/import | body | Yes | Yes | OK |
| GET | /api/settings/branding | querystring | Yes | Yes | OK |
| GET | /api/admin/settings | none | Yes | Yes | OK |
| GET | /api/admin/settings/branding | none | Yes | Yes | OK |
| PATCH | /api/admin/settings/branding | body | Yes | Yes | OK |
| GET | /api/candidate-fields | none | Yes | Yes | OK |
| POST | /api/candidate-fields | body | Yes | Yes | OK |
| PATCH | /api/candidate-fields/:id | params + body | Yes | Yes | OK |
| DELETE | /api/candidate-fields/:id | params | Yes | Yes | OK |
| GET | /api/candidate-fields/template | none | Yes | Yes | OK |
| GET | /api/system/info | none | Yes | Yes | OK |
| GET | /api/system/public-config | none | Yes | Yes | OK |
| GET | /api/system/health | none | Yes | Yes | OK |
| GET | /api/system/dashboard | none | Yes | Yes | OK |
| GET | /api/system/diagnostics | none | Yes | Yes | OK |
| GET | /api/admin/audit-logs | querystring | Yes | Yes | OK |
| GET | /api/admin/grading-queue | querystring | Yes | Yes | OK |
| GET | /api/admin/attempts/:attemptId/grading-details | params | Yes | Yes | OK |
| POST | /api/admin/attempts/:attemptId/grade-question | params + body | Yes | Yes | OK |

**Missing from swagger (no request schema visible):**

| Method | Path | Has schema in handler? | In swagger? |
|--------|------|----------------------|-------------|
| GET | /api/roles/assignable | No body | **NO** |
| GET | /api/users/:id/role-assignments | params | **NO** |
| POST | /api/users/:id/role-assignments | params + body | **NO** |
| PATCH | /api/role-assignments/:assignmentId | params + body | **NO** |
| DELETE | /api/role-assignments/:assignmentId | params | **NO** |
| GET | /api/admin/import-logs | querystring | **NO** |
| POST | /api/client-events | body | **NO** |
| GET | /api/admin/exams/:examId/proctor/attempts | params | **NO** |
| GET | /api/admin/attempts/:attemptId/proctor-events | params + querystring | **NO** |
| POST | /api/email/test | body | **NO** |

---

## 6. Contract Source Audit (Section E)

| Route domain | Contract schema exists? | Route uses contract? | Handler parses output? | Drift risk |
|-------------|------------------------|---------------------|----------------------|------------|
| auth (login, me, password, profile) | Yes — `LoginRequestSchema`, `LoginResponseSchema`, `MeResponseSchema`, `ChangePasswordRequestSchema`, `UpdateProfileRequestSchema` | Yes | Yes — `LoginResponseSchema.parse()`, `MeResponseSchema.parse()` | Low |
| exam (CRUD, transitions) | Yes — `CreateExamRequestSchema`, `UpdateExamRequestSchema`, `ExamSchema` | Yes | Partial — `toExamResponse()` constructs shape manually, not parsed against ExamSchema | Medium |
| attempt (candidate) | Yes — `LoadAttemptResponseSchema`, `SaveAnswerResponseSchema` (union), `HeartbeatRequestSchema`, etc. | Yes | Yes — `LoadAttemptResponseSchema.parse()`, `SaveAnswerAcceptedSchema.parse()` / `SaveAnswerRejectedSchema.parse()` | Low |
| attempt (admin) | Yes — `FlagMisconductRequestSchema`, `ForceSubmitRequestSchema`, `ExtendTimeRequestSchema`, `AttemptTimelineResponseSchema` | Yes | Yes — `AttemptExportResponseSchema.parse()` | Low |
| score | Yes — `ScoreListResponseSchema`, `AttemptResultResponseSchema`, `ScoreListQuerySchema`, `AttemptScoreParamsSchema` | Yes | Yes — `ScoreListResponseSchema.parse()`, `AttemptResultResponseSchema.parse()` | Low |
| candidate | Yes — `CreateCandidateRequestSchema`, `UpdateCandidateRequestSchema`, `CandidateImportRequestSchema` | Yes | No — handler constructs response inline without `.parse()` | Medium |
| course | Yes — `CreateCourseRequestSchema`, `UpdateCourseRequestSchema` | Yes | No — handler constructs response inline | Medium |
| question | Yes — `CreateQuestionRequestSchema`, `UpdateQuestionRequestSchema`, `QuestionSchema` | Yes | No — handler constructs response inline | Medium |
| user | Yes — `CreateUserRequestSchema`, `UpdateUserRequestSchema`, `ResetPasswordRequestSchema` | Yes | No — handler constructs response inline | Medium |
| settings | Yes — `BrandingQuerySchema`, `BrandingViewSchema`, `OrganizationSettingsSchema`, `UpdateBrandingRequestSchema` | Yes | Yes — `BrandingViewSchema.parse()`, `OrganizationSettingsSchema.parse()` | Low |
| system | Yes — `SystemHealthResponseSchema`, `DashboardResponseSchema`, `DiagnosticsResponseSchema` | Yes | No — handler returns raw object | Medium |
| audit | Yes — `AuditLogQuerySchema` | Yes | No — handler constructs response inline | Medium |
| candidateField | Yes — `CreateCandidateFieldRequestSchema`, `UpdateCandidateFieldRequestSchema` | Yes | No — handler constructs response inline | Medium |
| clientEvent | Yes — `ClientEventBatchSchema` | Yes | Yes — `ClientEventBatchSchema.parse()` | Low |
| importLog | Yes — `ImportLogListQuerySchema`, `ImportLogListResponseSchema` | Yes | No — handler constructs response inline | Medium |
| gradingQueue | Yes — `GradingQueueListQuerySchema`, `GradeQuestionRequestSchema`, etc. | Yes | No — handler constructs response inline | Medium |
| proctorMonitoring | Yes — `ProctorAttemptListResponseSchema`, `ProctorAttemptEventListResponseSchema` | Yes | No — handler returns raw object | Medium |
| email | Yes — `SendTestEmailRequestSchema`, `SendTestEmailResponseSchema` | Yes | No — handler returns inline object | Low |
| roleAssignment | Yes — `AssignRoleRequestSchema`, `PatchRoleAssignmentRequestSchema`, `UserRoleAssignmentSchema` | Yes | No — handler constructs response inline | Medium |
| export (CSV) | No dedicated schema | Uses `z.string()` | No parse — raw CSV string | Medium |

### Triple-definition drift risk

The following DTOs appear in three places: `packages/contracts`, route handler inline construction, and frontend `api.ts` (implicit via `api.get<T>()` generic):

- **ExamListItem** — `ExamSchema` in contracts, `toExamResponse()` + inline additions in handler, frontend `ExamListPage.tsx` defines its own type
- **CandidateListItem** — `candidateItemSchema` in route (not in contracts), frontend defines its own type
- **UserListItem** — `userItemSchema` in route (not in contracts), frontend defines its own type
- **CourseListItem** — `courseItemSchema` in route (not in contracts), frontend defines its own type
- **QuestionListItem** — `QuestionSchema` in contracts, handler reconstructs manually, frontend defines its own type

The frontend API client (`apps/web/src/lib/api.ts`) is completely generic — `api.get<T>(path)` — with no type imports from `@exam/contracts` or from the generated spec. Every page file defines its own response types inline.

---

## 7. Union / Conditional Response Audit (Section F)

### SaveAnswer (POST /attempts/:attemptId/answers/:questionId)

The `SaveAnswerResponseSchema` is a Zod discriminated union on `accepted: true | false`. The swagger build converts this to `anyOf` with two variants. The structural test verifies both `true` and `false` discriminator values are present. **This works correctly.**

However, `fastify-type-provider-zod` serializes Zod `const: true` as `{ enum: [true] }` for OpenAPI 3.0.3 compatibility. The structural test's `discriminatorValue()` helper accounts for this.

### AttemptResultResponse (GET /scores/attempts/:attemptId)

The `AttemptResultResponseSchema` is a Zod discriminated union on `showResultImmediately: true | false`. The structural test verifies both values. **This works correctly.**

### StartAttempt (POST /attempts/:examId/start)

Returns 201 for new attempts, 200 for restored ones, both with `LoadAttemptResponseSchema`. The spec declares both status codes with the same schema. **No union issue — the shape is identical, only the status code differs.**

### publishResults response

Uses a local `publishResultsResponseSchema` with `ok: z.literal(true)`, `resultsPublishedAt: z.string().datetime()`, `alreadyPublished: z.boolean()`. This is a flat schema, not a union. **No issue.**

---

## 8. Error Response and RBAC Audit (Section G)

### Error schema consistency

`ErrorResponseSchema` from `@exam/contracts` is used consistently across all route declarations that include error responses. The schema defines `{ requestId, error: { code, message, details? } }`.

**Routes that throw domain errors (NotFoundError, ValidationError, etc.) rely on the global error handler in `plugins/errors.ts`** to format the response. The swagger app does NOT register this error handler, so error responses in the spec come only from explicit `schema.response.4xx` declarations.

### Error status code coverage

| Status | Declared on which routes? | Actually returned? |
|--------|--------------------------|-------------------|
| 400 | Most mutating routes | Yes — via Zod validation + explicit checks |
| 401 | Only `POST /api/auth/login` | Also returned by `authenticate` preHandler on all protected routes — **not declared in spec for most routes** |
| 403 | `POST /api/auth/register`, admin attempt routes, grading queue | Yes — via `requireRole`/`requireCapability` preHandler |
| 404 | Most resource-by-ID routes | Yes — via `NotFoundError` throws |
| 409 | Exam transitions, enrollment conflicts, import conflicts | Yes |
| 429 | Rate-limited routes (login, import) | Yes — via `@fastify/rate-limit` plugin |
| 500 | Only `PATCH /admin/settings/branding` | Yes — explicit |

**P1 finding:** The `authenticate` preHandler returns 401 for unauthenticated requests on all protected routes, but only `POST /api/auth/login` declares `401` in its response schema. All other protected routes implicitly produce 401 but it's invisible in the spec.

### Security metadata

Protected routes consistently declare:
```ts
security: cookieAuth,
"x-role": ["Admin"],  // or ["Candidate"], or ["Candidate", "Admin"]
```

The structural test verifies `cookieAuth` and `x-role` on 5 sample protected routes. **This pattern is consistent across all protected routes.**

### Missing security on unprotected routes

- `GET /api/settings/branding` — correctly has no security (public)
- `GET /api/system/info` — correctly has no security (public)
- `GET /api/system/public-config` — correctly has no security (public)
- `POST /api/client-events` — has `preHandler: [fastify.authenticate]` but **no `security` in schema** (route not in swagger anyway)

### Role requirement visibility

Roles are declared via `x-role` metadata on each route. There is no centralized RBAC matrix in the spec. The `requireRole` and `requireCapability` preHandlers enforce at runtime but the swagger app stubs them as no-ops — so the spec captures the declared role from the schema, not the enforced role from the preHandler chain.

**P1 finding:** Some routes use `requireCapability(Permission.X)` instead of `requireRole(["Admin"])`. The capability-based routes (attempt admin, grading queue, proctor monitoring) still declare `"x-role": ["Admin"]` in their schema, which is correct for Phase 1 but may drift when capabilities diverge from roles in Phase 3.

---

## 9. Runtime Enforcement Audit (Section H)

### serializerCompiler

Registered in both `server.ts` (via `zodProviderPlugin`) and the swagger app. Response payloads are serialized against the declared Zod response schemas. If a handler returns a shape that doesn't match, the serializer will either strip extra fields or coerce types — it won't throw.

### Swagger app vs runtime app consistency

| Aspect | Swagger app | Runtime app | Match? |
|--------|-------------|-------------|--------|
| validatorCompiler | `validatorCompiler` from fastify-type-provider-zod | Same via zodProviderPlugin | Yes |
| serializerCompiler | `serializerCompiler` | Same | Yes |
| authenticate | No-op stub | Real JWT verification | Different (by design) |
| requireRole | No-op stub | Real RBAC enforcement | Different (by design) |
| requireCapability | No-op stub | Real capability check | Different (by design) |
| db | `null as never` | Real PostgreSQL | Different (by design) |
| Error handler | Not registered | `setupErrorHandler(app)` | **Different** — swagger app lacks global error handler |

**P2 finding:** The swagger app does not register the global error handler (`setupErrorHandler`). This means domain errors thrown in swagger app route registration (like `NotFoundError`) would produce 500s instead of structured 4xx responses. This doesn't affect the generated spec (schemas come from route options, not runtime), but it means the swagger app can't be used as a full integration test server.

### Parameter required array issue

The `jsonSchemaTransform` from `fastify-type-provider-zod` converts Zod schemas to JSON Schema. Path parameters are always required in OpenAPI. The structural test verifies that `SaveAnswer` registers params and `StartAttempt` registers the `examId` path parameter. **No known issue with `parameter.required` vs JSON Schema `required` array conflict.**

---

## 10. CI / Drift Gate Audit (Section I)

### What exists

| Check | Present? | Location |
|-------|----------|----------|
| OpenAPI generation test | Yes | `openapi/openapi.test.ts` |
| Structural baseline tests | Yes | `openapi/openapi.structural.test.ts` |
| Priority route presence | Yes | 12 paths verified |
| No generic 2xx | Yes | Scans all paths |
| Union responses (SaveAnswer, AttemptResult) | Yes | Discriminator values verified |
| Request schemas registered | Yes | 3 probe routes |
| Security + x-role metadata | Yes | 5 protected routes |
| Common error codes | Yes | 400 and 404 on sample routes |

### What's missing

| Check | Present? | Impact |
|-------|----------|--------|
| `pnpm api:openapi` script | No | No way to regenerate spec on demand |
| Committed `openapi.json` | No | No baseline to diff against |
| `git diff --exit-code` drift gate | No | Spec can silently diverge |
| All routes covered by structural tests | No — only ~15 of ~80+ routes | New routes have no regression guard |
| No generic/spurious 2xx on non-priority routes | Partial — scan covers all but only checks for `{}` | Typed-but-wrong schemas pass |
| Protected routes have security | Partial — 5 sampled | ~60+ protected routes unchecked |
| No candidate response exposes standardAnswer | Not tested | Security concern — `LoadAttemptResponseSchema` strips it, but no regression test |
| Frontend types from OpenAPI/contracts | No | Frontend types are manually defined per page |
| CSV content-type correctness | No | Spec mislabels CSV as JSON |

---

## 11. Concrete Inventory

### Routes absent from swagger build

1. `GET /api/roles/assignable`
2. `GET /api/users/:id/role-assignments`
3. `POST /api/users/:id/role-assignments`
4. `PATCH /api/role-assignments/:assignmentId`
5. `DELETE /api/role-assignments/:assignmentId`
6. `GET /api/admin/import-logs`
7. `POST /api/client-events`
8. `GET /api/admin/exams/:examId/proctor/attempts`
9. `GET /api/admin/attempts/:attemptId/proctor-events`
10. `POST /api/email/test`

### Routes with response schema mismatch

1. `GET /api/exams/:id/export/scores` — spec: `application/json` string; actual: `text/csv`
2. `GET /api/admin/attempts/:attemptId/export/csv` — same issue

### Routes where handler doesn't parse output against schema

1. `GET /api/candidates` — constructs `itemsWithUsers` inline
2. `GET /api/candidates/:id` — returns constructed object
3. `POST /api/candidates` — returns constructed object
4. `PATCH /api/candidates/:id` — returns constructed object
5. `POST /api/candidates/import` — returns constructed object
6. `GET /api/courses` — constructs items inline
7. `GET /api/courses/:id` — returns constructed object
8. `POST /api/courses` — returns constructed object
9. `PATCH /api/courses/:id` — returns constructed object
10. `GET /api/questions` — constructs items inline
11. `GET /api/questions/:id` — returns constructed object
12. `POST /api/questions` — returns constructed object
13. `PATCH /api/questions/:id` — returns constructed object
14. `GET /api/users` — constructs items inline
15. `POST /api/users` — returns constructed object
16. `PATCH /api/users/:id` — returns constructed object
17. `GET /api/system/health` — returns raw object
18. `GET /api/system/dashboard` — returns raw object
19. `GET /api/system/diagnostics` — returns raw object
20. `GET /api/admin/audit-logs` — constructs items inline
21. `GET /api/admin/grading-queue` — constructs items inline
22. `GET /api/admin/attempts/:attemptId/grading-details` — constructs response inline
23. `POST /api/admin/attempts/:attemptId/grade-question` — returns constructed object
24. `GET /api/admin/attempts/:attemptId/timeline` — constructs events inline
25. `GET /api/candidate-fields` — constructs items inline
26. `POST /api/candidate-fields` — returns constructed object
27. `PATCH /api/candidate-fields/:id` — returns constructed object
28. `GET /api/exams` — constructs items via `toExamResponse()` + inline additions
29. `GET /api/exams/:id` — returns constructed object
30. `POST /api/exams` — returns via `toExamResponse()`
31. `PATCH /api/exams/:id` — returns via `toExamResponse()`
32. All exam transition routes — return via `toExamResponse()`

---

## 12. Root Cause Analysis

### Toolchain issues
- `@fastify/swagger` with `fastify-type-provider-zod` works correctly for Zod-to-JSON-Schema conversion.
- `x-content-types` custom extension is not honored by swagger — need a post-transform hook or manual content-type override.
- OpenAPI 3.0.3 limitation: `const: X` is serialized as `{ enum: [X] }` — the structural tests account for this.

### Schema registration issues
- 5 route modules were simply never added to `swagger.ts` — straightforward omission.
- `GET /api/health` in `server.ts` lacks a schema — the swagger app adds one inline but the runtime doesn't use it.

### Route coverage issues
- The swagger app was built incrementally — early routes got schemas, later routes (roleAssignments, importLogs, clientEvents, proctorMonitoring, email) were added to `server.ts` but never to `swagger.ts`.
- No automated check ensures the two files stay in sync.

### Handler output shape issues
- Many handlers construct response objects inline without parsing against the declared response schema. The `serializerCompiler` provides a safety net at the boundary, but intermediate field additions/omissions are invisible.
- `toExamResponse()` is a manual shape mapper that could drift from `ExamSchema`.

### CI gate issues
- Structural tests exist but cover only priority routes.
- No spec export + diff test.
- No frontend type generation.

---

## 13. Recommended Fix Order

### B0 — Inventory (done)
This audit. No code changes.

### B1 — Structural tests + CI drift gate
1. Add remaining 10 missing route modules to `swagger.ts`.
2. Create `pnpm api:openapi` script that exports `openapi.json`.
3. Add a structural test: `git diff --exit-code openapi.json` after export.
4. Extend structural test coverage to all protected routes (security + x-role).
5. Add test: no candidate-facing response exposes `standardAnswer`.

### B2 — Fix spurious status codes / content types
1. Export CSV routes: replace `200: z.string()` with a proper `text/csv` content type annotation via post-transform or `x-content-type` handler.
2. `GET /api/health` in `server.ts`: add the same typed schema the swagger app uses.

### B3 — Register response schemas for runtime-critical APIs
1. Add `401` to all protected route response schemas (the authenticate preHandler produces it).
2. Ensure error handler in swagger app matches runtime (register `setupErrorHandler`).

### B4 — Register request schemas
Already done for most routes. The only gap is the 10 missing modules (covered in B1).

### B5 — RBAC / error metadata
1. Add `x-capability` metadata for routes using `requireCapability` instead of `requireRole`.
2. Consider adding a centralized RBAC matrix test that cross-references `x-role` declarations with the actual preHandler chain.

### B6 — Frontend type generation or contract alignment
1. Export `openapi.json` as a build artifact.
2. Generate TypeScript types from the spec (or from `@exam/contracts`) for the frontend.
3. Replace inline page-level type definitions with generated types.
4. Long-term: consider `openapi-typescript` or similar code-gen in the web build pipeline.

---

## 14. Non-Goals

This audit does not recommend changes to:
- Application business logic
- Database schema or migrations
- Permission semantics or RBAC enforcement behavior
- Exam state machine or attempt lifecycle
- Frontend UI behavior or routing
- Test assertions or coverage thresholds

---

## 15. Acceptance Criteria for Next Fix PR

### Must-pass checks

```bash
# 1. Export spec and verify no drift
pnpm --filter @exam/api api:openapi
git diff --exit-code apps/api/openapi.json

# 2. All structural tests pass
pnpm --filter @exam/api test -- --testPathPattern=openapi

# 3. Full verify still passes
pnpm verify

# 4. Swagger app includes all 18 route modules
grep -c "await app.register" apps/api/src/openapi/swagger.ts
# Should be >= 18 (15 route modules + swagger plugin + swagger-ui + inline health)

# 5. No generic 2xx responses
pnpm --filter @exam/api test -- --testPathPattern=openapi.structural

# 6. Protected routes have security metadata
# (covered by extended structural tests in B1)

# 7. CSV export routes declare correct content type
# (covered by B2 fix + test)
```

### Verification commands

```bash
# Run the openapi tests
pnpm --filter @exam/api test -- --testPathPattern=openapi

# Generate and inspect the spec
pnpm --filter @exam/api api:openapi
cat apps/api/openapi.json | jq '.paths | keys | length'
# Should equal the total number of registered paths

# Check no route is missing from spec
cat apps/api/openapi.json | jq '.paths | keys[]' | sort
# Compare against the full route list from server.ts
```
