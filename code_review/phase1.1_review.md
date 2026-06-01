# Phase 1.1 Stabilization + Fix Pack — Review Report

**Date:** 2026-06-01
**Reviewer:** Code Review Agent (GLM-5.1)
**Scope:** Phase 1.1 stabilization (Job01-Job06) + Fix Pack (Tasks 1-4)

---

## Verdict

**PASS_WITH_MINOR_ISSUES**

All P0 bugs are fixed, exam lifecycle闭环 works end-to-end, architecture boundaries are respected, and tests cover the critical path.

---

## Changes Under Review

### Phase 1.1 Stabilization (Job01-Job06)

| Job | Description | Files |
|-----|-------------|-------|
| Job01 | API client empty-body fix + error handler 4xx preservation | `web/src/lib/api.ts`, `api/src/plugins/errors.ts`, `api/src/plugins/security.ts` |
| Job02 | Loading/error states and toast feedback on destructive actions | `ExamDetailPage.tsx`, `ExamPage.tsx`, `CoursePage.tsx`, `ExamCreatePage.tsx` |
| Job03 | Enrollment CRUD routes + UI | `api/src/routes/exam.ts`, `ExamDetailPage.tsx` |
| Job04 | Exam route index redirect + header nav links | `ExamLayout.tsx`, `App.tsx` |
| Job05 | Password change route + forms | `api/src/routes/auth.ts`, `SettingsPage.tsx`, `ExamSettingsPage.tsx`, `contracts/src/auth.ts` |
| Job06 | Smoke test suite (8 tests) | `api/src/routes/smoke.test.ts` |

### Fix Pack (Tasks 1-4)

| Task | Description | Files |
|------|-------------|-------|
| Task 1 | Candidate profile invariant + shared test helper | `testHelpers.ts`, `candidateInvariant.test.ts`, `smoke.test.ts` |
| Task 2 | `/admin/results` route + `ResultsOverviewPage` | `App.tsx`, `routes.ts`, `ResultsOverviewPage.tsx`, `AppSidebar.tsx` |
| Task 3 | `Link` → `NavLink` with active state in ExamLayout | `ExamLayout.tsx` |
| Task 4 | CSV export integration tests | `export.test.ts` |
| Review fix | `as any` cleanup in `export.ts` | `export.ts` |

---

## P0 Bug Checklist

```
[x] publish 不再触发 empty JSON body
[x] delete course 不再触发 empty JSON body
[x] Fastify parser 400 不再被包装成 500
[x] 发布后页面状态刷新
[x] 课程删除有反馈
[x] 考试详情页能分配考生
[x] Candidate 能看到自己的考试
[x] Candidate 能开始考试
```

## Architecture Checklist

```
[x] Route 不直接访问 db                    — Bare db access only in testHelpers.ts (acceptable)
[x] Repository 接收 RequestContext          — Every repo method receives ctx as first arg
[x] 查询带 organizationId                   — All routes use ensureTargetOrg()
[x] 状态变更通过 command function            — publishExam()/archiveExam() from @exam/exam-engine
[x] 敏感操作写 AuditLog                     — export + publish write audit logs
[x] DTO 不重复定义                          — Types from @exam/domain, schemas from @exam/contracts
[x] 无 as any 滥用                         — Fixed: export.ts cleaned up (see below)
[x] 无 console.log                         — Clean across all files
```

## Exam Base Checklist

```
[x] 服务端计时仍是权威
[x] Answer Save Protocol 没被破坏
[x] submitted/graded 不允许再保存答案
[x] questionSnapshot 不被题库修改影响
[x] enrollment 和 attempt 关系清楚
```

## UI Feedback Checklist

```
[x] publish loading/success/error
[x] delete loading/success/error
[x] enrollment add/remove loading/success/error
[x] candidate start exam error reason 清楚
[x] empty state 不空白
```

## Test Checklist

```
[x] API client 空 body 回归测试              — api.test.ts: 15 tests
[x] publish 回归测试                         — smoke.test.ts
[x] enrollment 测试                          — enrollment.test.ts: 5 tests
[x] candidate my exams 测试                  — candidateInvariant.test.ts: 3 tests
[x] smoke 覆盖完整闭环                        — smoke.test.ts: 6 tests
[x] CSV export 测试                          — export.test.ts: 4 tests
```

---

## Issues Found and Fixed

### Fixed: `as any` in `export.ts`

**Severity:** Medium (non-blocking, fixed during review)

**Before:**
```typescript
// apps/api/src/routes/export.ts:21-22
const examId = (request.params as any).id;
const ctx = ensureTargetOrg(request["ctx"] as any);
```

**After:**
```typescript
const { id: examId } = request.params as { id: string };
const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
```

**Reason:** Every other route file uses typed params extraction and `as RequestContext`. The `as any` was functionally harmless but violated the "no `as any`" rule. Fixed to match project convention.

---

## Non-blocking Issues (Deferred)

### 1. `: any` in route handler signatures (Low — pre-existing)

**Files:** All route files (`exam.ts`, `auth.ts`, `course.ts`, `question.ts`, etc.)

39 occurrences of `async (request: any, reply: any) =>`. This is a systemic pre-existing issue that predates Phase 1.1. The fix requires Fastify generic type params:

```typescript
async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) =>
```

**Recommendation:** Dedicated cleanup task in a future sprint. Not blocking.

### 2. No web tests for `ResultsOverviewPage` (Low)

The new page is a thin composition of existing tested components (API client + Table + Card). Underlying API routes have full test coverage. Acceptable for Phase 1.1.

### 3. No CSV export test with actual graded data (Low)

`export.test.ts` covers empty results + auth/permission checks. The underlying `generateCSV` and `listGradedByExam` are tested separately. A data-bearing test would require a full attempt→submit→grade flow, which is valuable but not blocking.

---

## Test Results

```
API:   121 passed (18 test files)
Web:   106 passed (14 test files)
Total: 227 passed
```

## Verification

```
pnpm lint        ✅
pnpm lint:copy   ✅
pnpm lint:arch   ✅
pnpm typecheck   ✅
pnpm test        ✅ (227/227)
```

Pre-existing Prettier warnings in 10 doc/css files (not from Phase 1.1 changes).
