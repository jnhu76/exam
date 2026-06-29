# OpenAPI Contract Audit — Phase 1 Discovery

> Compares OpenAPI spec (generated via `@fastify/swagger`) against actual route handlers and contract schemas.

## 1. How OpenAPI Is Generated

- **File**: `apps/api/src/openapi/swagger.ts`
- **Mechanism**: Builds a separate Fastify instance, registers all routes with mock decorators, calls `app.swagger()`
- **Config**: `apps/api/src/openapi/config.ts` — auto-injects common response schemas (401, 403, 404, 400, 204, 200) via `onRoute` hook
- **Spec version**: OpenAPI 3.0.3
- **Docs endpoint**: Registered via `registerDocs.ts` (likely `/api/docs`)

## 2. Route Coverage Analysis

### Routes registered in swagger.ts vs server.ts

| Route File | server.ts | swagger.ts | Match |
|------------|-----------|------------|-------|
| authRoutes | ✅ `/api/auth` | ✅ `/api/auth` | ✅ |
| settingsRoutes | ✅ `/api` | ✅ `/api` | ✅ |
| candidateFieldRoutes | ✅ `/api` | ✅ `/api` | ✅ |
| userRoutes | ✅ `/api` | ✅ `/api` | ✅ |
| candidateRoutes | ✅ `/api` | ✅ `/api` | ✅ |
| courseRoutes | ✅ `/api` | ✅ `/api` | ✅ |
| questionRoutes | ✅ `/api` | ✅ `/api` | ✅ |
| examRoutes | ✅ `/api` | ✅ `/api` | ✅ |
| attemptRoutes | ✅ `/api` | ✅ `/api` | ✅ |
| scoreRoutes | ✅ `/api` | ✅ `/api` | ✅ |
| exportRoutes | ✅ `/api` | ✅ `/api` | ✅ |
| systemRoutes | ✅ `/api` | ✅ `/api` | ✅ |
| auditRoutes | ✅ `/api` | ✅ `/api` | ✅ |
| healthCheck (`GET /api/health`) | ✅ | ❌ **NOT in swagger** | **MISMATCH** |

### Inline health endpoint

`server.ts:54` defines `GET /api/health` directly on the app instance — this route is NOT registered through the swagger build, so it's **missing from the OpenAPI spec**.

## 3. Schema Coverage Analysis

### Contract schemas used in routes vs OpenAPI declarations

The OpenAPI spec relies on `@fastify/swagger` auto-generation from route schemas. The `addCommonResponseSchemas` hook adds standard error responses. However:

| Issue | Detail |
|-------|--------|
| **Generic response bodies** | Most 200/201 responses use `genericSuccessSchema` (`{ type: "object" }`) — no actual response shape declared |
| **Request body schemas** | Routes use Zod schemas (`LoginRequestSchema`, `CreateExamRequestSchema`, etc.) for runtime validation, but many route handlers use `safeParse` without registering the Zod schema with Fastify's `schema.body` |
| **Missing response schemas** | The following responses have no typed OpenAPI declaration: |

### Routes with missing/incomplete response schemas

| Route | Issue |
|-------|-------|
| `POST /auth/login` | Response uses `LoginResponseSchema.parse()` at runtime but Fastify schema.response not set → OpenAPI shows generic `{}` |
| `GET /auth/me` | Same — `MeResponseSchema.parse()` runtime only |
| `PATCH /auth/me/password` | Returns `{ ok: true }` — not declared in OpenAPI |
| `GET /exams` | Complex nested response (items + stats + meta) — OpenAPI shows generic |
| `GET /exams/:id` | Complex response with participants — OpenAPI shows generic |
| `POST /exams/:id/publish` | Exam response — OpenAPI shows generic |
| `GET /candidate/exams` | Array of CandidateExamSummary — OpenAPI shows generic |
| `GET /candidate/exams/:examId` | CandidateExamDetailResponse — OpenAPI shows generic |
| `POST /attempts/:examId/start` | LoadAttemptResponse — OpenAPI shows generic |
| `POST /attempts/:attemptId/answers/:questionId` | SaveAnswer response (union type) — OpenAPI shows generic |
| `POST /attempts/:attemptId/submit` | LoadAttemptResponse — OpenAPI shows generic |
| `GET /exams/:id/scores` | ScoreListResponse (items + stats) — OpenAPI shows generic |
| `GET /scores/attempts/:attemptId` | AttemptResultResponse — OpenAPI shows generic |
| `GET /exams/:id/export/scores` | CSV binary — OpenAPI shows generic |
| `GET /system/dashboard` | DashboardResponse — OpenAPI shows generic |
| `GET /admin/audit-logs` | Paginated audit logs — OpenAPI shows generic |

## 4. Mismatch Table

### 4.1 OpenAPI has but code doesn't implement

| Item | Status |
|------|--------|
| None found | All OpenAPI paths correspond to real route handlers |

### 4.2 Code has but OpenAPI doesn't declare

| Item | Detail |
|------|--------|
| `GET /api/health` | Inline route in `server.ts:54`, not registered in swagger build |

### 4.3 Schema/response shape mismatches

| Route | OpenAPI Says | Actual Response Shape | Severity |
|-------|-------------|----------------------|----------|
| `POST /auth/login` | `{}` (generic) | `{ id, username, name, role, organizationId }` | medium |
| `GET /auth/me` | `{}` (generic) | `{ id, username, name, role, organizationId }` | medium |
| `GET /exams` | `{}` (generic) | `{ items: Exam[], total, page, pageSize, totalPages }` | high |
| `GET /exams/:id` | `{}` (generic) | `{ ...Exam, stats: {...}, participants: [...] }` | high |
| `POST /exams` | `{}` (generic) | Exam response object | medium |
| `GET /candidate/exams` | `{}` (generic) | `CandidateExamSummary[]` | high |
| `GET /candidate/exams/:examId` | `{}` (generic) | `CandidateExamDetailResponse` | high |
| `POST /attempts/:examId/start` | `{}` (generic) | `LoadAttemptResponse` | high |
| `POST /attempts/:attemptId/answers/:questionId` | `{}` (generic) | `SaveAnswerAcceptedSchema \| SaveAnswerRejectedSchema` (union) | high |
| `POST /attempts/:attemptId/submit` | `{}` (generic) | `LoadAttemptResponse` | high |
| `GET /exams/:id/scores` | `{}` (generic) | `{ items, stats, total, page, pageSize }` | high |
| `GET /scores/attempts/:attemptId` | `{}` (generic) | `AttemptResultResponse` (conditional shape) | high |
| `GET /system/dashboard` | `{}` (generic) | `{ totalQuestions, activeExams, totalCandidates, todayExams, recentExams }` | medium |

### 4.4 Frontend calls but OpenAPI doesn't accurately declare

| Frontend Call | OpenAPI Declaration | Issue |
|---------------|-------------------|-------|
| `api.get('/api/candidate/exams')` | Generic `{}` response | No array item schema |
| `api.post('/api/attempts/:id/answers/:qid', body)` | Generic request body | Zod schema `SaveAnswerRequestSchema` not registered as Fastify schema.body |
| `api.post('/api/attempts/:id/submit')` | Generic response | `LoadAttemptResponse` shape not declared |
| `api.post('/api/attempts/:id/heartbeat')` | Generic response | Returns `{ ok: true }` — not declared |

## 5. Auth Decorator Behavior

The swagger build uses a **no-op authenticate** and **no-op requireRole**:
```ts
const authenticate = async () => {};
Object.assign(authenticate, { _isAuthenticate: true });
app.decorate("authenticate", authenticate);
app.decorate("requireRole", () => async () => {});
```

This means:
- All routes appear as "authenticated" in OpenAPI (the `_isAuthenticate` marker triggers 401 auto-addition)
- But the actual **role requirements** are invisible in the spec — no `security` or `x-role` annotations
- The `addCommonResponseSchemas` hook adds 403 for "admin paths" based on path string matching — this is a heuristic, not authoritative

## 6. Key Gaps

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| **Response schemas are generic** | API consumers cannot generate typed clients from the spec | Register Zod schemas with Fastify `schema.response` or write explicit JSON Schema response definitions |
| **Request body schemas not in Fastify schema** | Body validation is Zod-only; OpenAPI shows empty body | Register Zod schemas as Fastify `schema.body` for auto-documentation |
| **Role-based access invisible in spec** | No way to see which roles can call which endpoints | Add `security` schemes or `x-role` extensions per route |
| **Health endpoint missing** | Minor but inconsistent | Register in swagger build |
| **Union response types** | `SaveAnswer` response is accepted/rejected union — OpenAPI can't represent well without `oneOf` | Add `oneOf` schema for save-answer response |
| **Conditional response shapes** | `AttemptResultResponse` has two shapes based on `showResultImmediately` | Use `oneOf` or document both shapes |
