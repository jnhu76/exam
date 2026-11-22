import type { Database } from "../types.js";
import {
  candidateProfiles,
  examEnrollments,
  exams,
  users,
} from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, count, eq, exists, inArray, sql } from "drizzle-orm";

/** Filter options for listing candidates with DB-level filtering. */
export interface CandidateListFilters {
  /**
   * Case-insensitive substring search over the candidate user's `name` and
   * `username` (EXISTS, SQL-side, applied BEFORE limit/offset and the total
   * count). The stored term is trimmed; an empty term after trim filters
   * nothing (legacy listing semantics).
   */
  search?: string;
  /**
   * Restrict the listing to candidates with an ENROLLMENT whose exam's course
   * is one of `courseIds` (LIST scope filter). Applied in SQL BEFORE
   * limit/offset and the total count. An EMPTY array yields
   * `{ items: [], total: 0 }` by contract (never unfiltered).
   */
  courseIds?: string[];
}

/** Creates a tenant-scoped CRUD repository for `candidateProfiles` with user lookup. */
export function createCandidateRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, candidateProfiles);

  /**
   * Batch-loads candidate profiles by id, scoped to the tenant. Empty input
   * returns []. Used by the result_published recipient composition to
   * resolve candidateProfile -> userId without an N+1.
   */
  async function findByIds(
    ctx: TenantContext | RequestContext,
    candidateIds: string[],
  ) {
    if (candidateIds.length === 0) return [];
    const orgId = resolveOptionalOrganizationId(ctx);
    const rows = await db
      .select()
      .from(candidateProfiles)
      .where(
        and(
          eq(candidateProfiles.organizationId, orgId),
          inArray(candidateProfiles.id, candidateIds),
        ),
      );
    return rows as (typeof candidateProfiles.$inferSelect)[];
  }

  return {
    ...repo,
    findByIds,
    /**
     * Finds a candidate profile by the associated user ID, scoped to the tenant.
     */
    async findByUserId(ctx: TenantContext | RequestContext, userId: string) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(candidateProfiles)
        .where(
          and(
            eq(candidateProfiles.organizationId, orgId),
            eq(candidateProfiles.userId, userId),
          ),
        );
      return (
        (rows[0] as typeof candidateProfiles.$inferSelect | undefined) ?? null
      );
    },
    /**
     * Targeted identity lookup: the first candidate profile in this
     * organization whose `fields -> fieldName` equals the given JSON scalar
     * (jsonb VALUE equality — never a `->>` text projection).
     *
     * INVARIANT: jsonb value equality mirrors the JS strict-equality
     * semantics of the former in-memory identity scan for JSON scalars:
     * `"42"` (string) never equals `42`, while numeric canonical forms are
     * equal (`42` = `42.0`). A missing field yields SQL NULL and never
     * matches.
     *
     * PROTOCOL: the value is bound as a pre-encoded JSON text parameter cast
     * `::jsonb`. The drizzle postgres-js driver installs identity
     * serializers for json/jsonb parameters, so `JSON.stringify` here is the
     * single encode the server-side cast parses.
     *
     * OWNERSHIP: the CALLER owns the empty-value early exits of the identity
     * protocol — `undefined`/`null`/`""` must never be probed (a bound JSON
     * `null` would match a stored JSON `null`, and `""` is a no-match value
     * by route contract, not an empty-string lookup). Non-scalar values are
     * rejected by the type: across a serialization boundary JS strict
     * equality can never match them, so they are unprobeable by contract.
     */
    async findByIdentityValue(
      ctx: TenantContext | RequestContext,
      fieldName: string,
      value: string | number | boolean,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(candidateProfiles)
        .where(
          and(
            eq(candidateProfiles.organizationId, orgId),
            sql`${candidateProfiles.fields} -> ${fieldName} = ${JSON.stringify(value)}::jsonb`,
          ),
        )
        .limit(1);
      return (
        (rows[0] as typeof candidateProfiles.$inferSelect | undefined) ?? null
      );
    },
    /**
     * Candidates under the given filters with pagination. Filtering (user
     * name/username search, course-scope enrollment EXISTS) happens in SQL
     * BEFORE limit/offset and BEFORE the total count — never post-pagination;
     * `items` and `total` share one WHERE. EXISTS predicates cannot multiply
     * rows, so multi-enrollment candidates stay single entries. An EMPTY
     * course-id set yields `{ items: [], total: 0 }` by contract.
     * Ordering matches the generic listPaginated (createdAt, id).
     */
    async listFiltered(
      ctx: TenantContext | RequestContext,
      filters: CandidateListFilters,
      pagination: { page: number; pageSize: number },
    ): Promise<{
      items: (typeof candidateProfiles.$inferSelect)[];
      total: number;
    }> {
      if (filters.courseIds && filters.courseIds.length === 0) {
        return { items: [], total: 0 };
      }
      const orgId = resolveOptionalOrganizationId(ctx);
      const conditions = [eq(candidateProfiles.organizationId, orgId)];
      if (filters.search && filters.search.trim()) {
        const term = filters.search.trim();
        conditions.push(
          exists(
            db
              .select({ id: users.id })
              .from(users)
              .where(
                and(
                  eq(users.organizationId, orgId),
                  eq(users.id, candidateProfiles.userId),
                  sql`(position(lower(${term}) in lower(${users.name})) > 0 or position(lower(${term}) in lower(${users.username})) > 0)`,
                ),
              ),
          ),
        );
      }
      if (filters.courseIds) {
        conditions.push(
          exists(
            db
              .select({ id: examEnrollments.id })
              .from(examEnrollments)
              .innerJoin(exams, eq(examEnrollments.examId, exams.id))
              .where(
                and(
                  eq(examEnrollments.organizationId, orgId),
                  eq(exams.organizationId, orgId),
                  eq(examEnrollments.candidateId, candidateProfiles.id),
                  inArray(exams.courseId, filters.courseIds),
                ),
              ),
          ),
        );
      }
      const where = and(...conditions)!;
      const offset = (pagination.page - 1) * pagination.pageSize;
      const [items, totalRows] = await Promise.all([
        db
          .select()
          .from(candidateProfiles)
          .where(where)
          .orderBy(candidateProfiles.createdAt, candidateProfiles.id)
          .limit(pagination.pageSize)
          .offset(offset),
        db.select({ value: count() }).from(candidateProfiles).where(where),
      ]);
      return {
        items: items as (typeof candidateProfiles.$inferSelect)[],
        total: Number(totalRows[0]?.value ?? 0),
      };
    },
  };
}
