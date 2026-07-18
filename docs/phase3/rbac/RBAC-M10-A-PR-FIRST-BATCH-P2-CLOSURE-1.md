# RBAC-M10-A-PR-FIRST-BATCH-P2-CLOSURE-1

## A. Verdict

```
RBAC-M10-A-PR-FIRST-BATCH-P2-CLOSURE-1:
PASS — AUTHOR SELF-ASSESSMENT
```

## B. Starting state

- **Branch**: `fix/rbac-m10-a-review-corrective-1`
- **Starting HEAD**: `c3a75ac9573fd96f307da30fc0c42ea76c038aeb`
- **Worktree**: 1 untracked file (independent re-review report)

## C. Dirty-worktree classification

| Path | Change purpose | First-batch closure? | Architecture batch? | CI fix? | Action |
|------|----------------|------------------|-----------------|------|--------|
| docs/phase3/rbac/RBAC-M10-A-PR-REVIEW-CORRECTIVE-1-INDEPENDENT-RE-REVIEW-1.md | Independent re-review report | YES | NO | NO | commit |
| apps/api/src/openapi/swagger.ts | Swagger type safety fix (remove `as never` from auth decorators) | YES | NO | NO | commit |

## D. Preserved unrelated/architecture work

No unrelated or architecture work was present in the worktree. Nothing was stashed or moved.

## E. Swagger type-safety correction

### Changes to `apps/api/src/openapi/swagger.ts`:
1. Imported `PermissionKey` from `@exam/authz` for type safety
2. Updated `requireCandidateContext` signature to accept `permission: PermissionKey`
3. Updated `requireExamEligibility` signature to accept `permission: PermissionKey, resourceIdKey: string`
4. Updated `requireOwnAttempt` signature to accept `permission: PermissionKey, resourceIdKey: string`
5. Removed all `as never` casts from the authorization metadata objects
6. Added explanatory comments for the remaining bootstrap placeholder casts (db, ctx, swaggerPlugin)

### Before:
```typescript
app.decorate("requireCandidateContext", (permission: string) => {
  const h: AuthzPreHandler = async () => {};
  h.authz = { kind: "candidate_context", permission: permission as never };
  return h;
});
```

### After:
```typescript
app.decorate("requireCandidateContext", (permission: PermissionKey) => {
  const h: AuthzPreHandler = async () => {};
  h.authz = { kind: "candidate_context", permission };
  return h;
});
```

## F. Swagger metadata verification

The stubs preserve all metadata correctly:

| Route | Kind | Permission | Resource key |
|-------|------|------------|--------------|
| `GET /candidate/exams` | `candidate_context` | `exam.take` | none |
| `GET /candidate/exams/:examId` | `exam_eligibility` | `exam.take` | `examId` |
| `POST /attempts/:examId/queue` | `exam_eligibility` | `attempt.start` | `examId` |
| `POST /attempts/:examId/start` | `exam_eligibility` | `attempt.start` | `examId` |
| `GET /attempts/:id` | `own_attempt` | `attempt.view_own` | `id` |
| Other own-attempt routes | `own_attempt` | Route permission | `attemptId` |

## G. Files changed

1. `apps/api/src/openapi/swagger.ts`: Type safety fixes for authorization decorator stubs
2. `docs/phase3/rbac/RBAC-M10-A-PR-REVIEW-CORRECTIVE-1-INDEPENDENT-RE-REVIEW-1.md`: Updated with P2 closure addendum
3. `docs/phase3/rbac/RBAC-M10-A-PR-FIRST-BATCH-P2-CLOSURE-1.md`: This closure record

## H. Test commands and results

```bash
# OpenAPI check
$ pnpm --filter @exam/api api:openapi:check
openapi.json is up to date.

# Type check
$ pnpm typecheck
Tasks: 17 successful, 17 total

# Lint
$ pnpm lint
# (passes, output omitted)

# Lint arch
$ pnpm lint:arch
# (passes, output omitted)

# Lint copy
$ pnpm lint:copy
# (passes, output omitted)

# Format check
$ pnpm format:check
# (passes, output omitted)

# Focused authz tests
$ pnpm --filter @exam/api exec vitest run src/authz/routeRegistryConformance.test.ts
# 15/15 PASS

$ pnpm --filter @exam/api exec vitest run src/routes/attempts/m10a.candidateRuntime.test.ts
# 7/7 PASS
```

## I. Commit SHA

Closure commit: `58aa3243012aeb522682aaa5dbf2bb608aa8c345`

## J. Final worktree state

Final worktree after commit: CLEAN

## K. Next-step authorization

```
FIRST-BATCH PR CORRECTIVE:
VERIFIED

P2-1 DIRTY WORKTREE:
CLOSED

P2-2 SWAGGER AS-NEVER:
CLOSED

FIRST-BATCH FINDINGS:
0 OPEN

DEFERRED ARCHITECTURE FINDINGS:
4 OPEN

RBAC-M10-A-PR-ARCHITECTURE-CORRECTIVE-2:
AUTHORIZED
```
