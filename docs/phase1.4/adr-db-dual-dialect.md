# ADR: DB Dual-Dialect Unified Repository

**Status**: Accepted
**Date**: 2026-06-10
**Job**: P1.4-A00 DB Reality Check Spike

## Context

All 13 repository files accept `SqliteDatabase` and use synchronous Drizzle APIs (`.get()`, `.all()`, `.run()`). PostgreSQL requires async APIs (`await ... .execute()`). We need a single repo implementation that works with both dialects.

### Current Problems

- `baseRepo.ts` uses SQLite-specific types: `AnySQLiteTable`, `AnySQLiteColumn`, `SQLiteUpdateSetSource`
- 7 `as unknown as` casts in `systemStatsRepo.ts` and `apps/api/src/plugins/db.ts`
- 4 `as any` casts in `attemptRepo.ts` for JOIN/aggregate queries
- API plugin casts PG `PostgresJsDatabase` → `SqliteDatabase` — entire type system lies
- All repo methods are synchronous — incompatible with PostgreSQL driver

### Spike Results

PoC with `courseRepo` proves both SQLite and PG work through a single repo function using:

1. `AnyDatabase = SqliteDatabase | PostgresDatabase` union type
2. `isSqlite(db)` type guard for dialect detection (checks `"all" in db`)
3. TypeScript discriminated union narrowing — no `as unknown as` needed
4. All methods `async` — SQLite sync calls work inside async functions without wrapping

```
Spike test results: 12/12 pass (6 SQLite + 6 PostgreSQL)
- create, findById, list, update, delete all pass on both dialects
- No `as any` or `as unknown as` in spike code
```

## Decision

**Adopt async-everywhere with `isSqlite(db)` branching pattern.**

### Approach

```typescript
function createUnifiedRepo(db: AnyDatabase) {
  return {
    async findById(ctx, id): Promise<Row | null> {
      const orgId = resolveOrganizationId(ctx);

      if (isSqlite(db)) {
        // db narrowed to SqliteDatabase — sync .get()
        return db.select().from(sqliteSchema.courses)
          .where(and(eq(/*...*/), eq(/*...*/)))
          .get() ?? null;
      }

      // db narrowed to PostgresDatabase — async
      const rows = await db.select().from(pgSchema.courses)
        .where(and(eq(/*...*/), eq(/*...*/)));
      return rows[0] ?? null;
    },
  };
}
```

### Key Design Points

1. **All repo methods become async** — callers add `await`
2. **`isSqlite(db)` type guard** — zero-cost runtime check, enables TypeScript narrowing
3. **Two schema objects** — `sqliteSchema` and `pgSchema` passed to correct branch
4. **No `as unknown as`** — TypeScript discriminated union handles type narrowing
5. **Table pair config** — each table is passed as `{ sqlite, pg }` pair to generic factory

### Migration Strategy for Sync → Async

| Layer | Change | Impact |
|-------|--------|--------|
| Repo methods | Add `async`/`Promise<>` return type | All callers add `await` |
| Route handlers | Add `await` to repo calls | ~80 call sites in routes |
| Seed scripts | Add `await` to repo calls | `seed.ts`, `demo-seed.ts` |
| API plugin | Remove `as unknown as SqliteDatabase` cast | Fix type decoration |
| `baseRepo.ts` | Rewrite with `AnyDatabase` + dual table config | New generic factory |

### What We Avoid

- No `as any` or `as unknown as` in new code
- No code duplication per dialect (unlike current `systemStatsRepo` pattern)
- No additional npm dependencies
- No schema file changes

## Consequences

### Positive

- PostgreSQL finally works at the type level
- Eliminates all `as unknown as` in repo layer (7 occurrences)
- Eliminates all `as any` in repo layer (4 occurrences)
- Single repo implementation per entity
- Full `pnpm typecheck` coverage for PG code paths

### Negative

- All route handlers need `await` added (~80 sites) — mechanical but broad
- SQLite sync performance benefit lost (wrapping in async adds micro-overhead)
- Each repo method has two code paths (SQLite/PG) — controlled complexity

### Neutral

- SQLite `.get()` returns single row, PG returns array — handled by branch logic
- Migration files remain separate per dialect
- Drizzle ORM does not provide a common sync+async interface by design

## Open Questions (resolved by spike)

| Question | Answer |
|----------|--------|
| Unify to async API? | **Yes.** PG driver is fundamentally async. SQLite sync works inside async functions. |
| Migration strategy for sync calls? | **Add `await` everywhere.** Mechanical change, no logic change. |
| Can we avoid `as unknown as`? | **Yes.** TypeScript discriminated union narrowing via `isSqlite(db)` type guard. |
| Can we avoid code duplication? | **Mostly.** Shared logic outside branches, only query execution differs. |

## Related

- `packages/db/src/spike/dual-dialect.test.ts` — spike test (12/12 pass)
- `docs/phase1.4/02-architecture-jobs.md` — A00, A01, A02 job cards
