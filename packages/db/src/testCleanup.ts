import { eq } from "drizzle-orm";
import { schema } from "./schema/pg.js";
import type { Database } from "./types.js";
import { executeInTransaction } from "./types.js";

/**
 * Test-only: remove every org-scoped child row for one organization, then the
 * organization row itself. Scoped to a single organizationId, idempotent.
 *
 * OWNERSHIP INVARIANT (do not violate — was the root cause of past CI flakes):
 *
 *   cleanupOrganizationTestData DELETES the organization row. It may only be
 *   called for an organization that the current test EXCLUSIVELY OWNS, or from
 *   `afterAll` once every test sharing that organization has finished. It must
 *   NOT be called in `afterEach` against a `beforeAll`/shared ctx organization,
 *   and must not be called for an organization any later test still references
 *   (FKs such as users.organizationId / audit_logs.organizationId will then
 *   fail, and tokens issued for the deleted users/org stop authenticating).
 *
 * Correct patterns:
 *   - shared ctx created in `beforeAll`  -> call this only in `afterAll`
 *   - per-test ctx created in `beforeEach` -> call in `afterEach` is safe
 *   - a temporary org created inside one test -> call it in that test's
 *     try/finally (never reuse the org across tests)
 *
 * For cleaning org-scoped child rows WITHOUT removing the organization (e.g.
 * between tests that share one organization), use
 * {@link cleanupOrganizationChildData} instead.
 */
export async function cleanupOrganizationTestData(
  db: Database,
  organizationId: string,
): Promise<void> {
  await executeInTransaction(db, async (tx) => {
    await tx
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, organizationId));
    await tx
      .delete(schema.examAttempts)
      .where(eq(schema.examAttempts.organizationId, organizationId));
    await tx
      .delete(schema.examEnrollments)
      .where(eq(schema.examEnrollments.organizationId, organizationId));
    await tx
      .delete(schema.exams)
      .where(eq(schema.exams.organizationId, organizationId));
    await tx
      .delete(schema.questions)
      .where(eq(schema.questions.organizationId, organizationId));
    await tx
      .delete(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.organizationId, organizationId));
    await tx
      .delete(schema.candidateFields)
      .where(eq(schema.candidateFields.organizationId, organizationId));
    await tx
      .delete(schema.organizationSettings)
      .where(eq(schema.organizationSettings.organizationId, organizationId));
    await tx
      .delete(schema.courses)
      .where(eq(schema.courses.organizationId, organizationId));
    await tx
      .delete(schema.users)
      .where(eq(schema.users.organizationId, organizationId));
    await tx
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
  });
}

/**
 * Test-only: remove org-scoped child rows for one organization while KEEPING the
 * organization and its users intact. Use this between tests that SHARE one
 * organization created in a shared `beforeAll` ctx, where a full
 * {@link cleanupOrganizationTestData} would delete the org that later tests in
 * the same file still depend on. Idempotent and scoped to a single
 * organizationId.
 */
export async function cleanupOrganizationChildData(
  db: Database,
  organizationId: string,
): Promise<void> {
  await executeInTransaction(db, async (tx) => {
    await tx
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, organizationId));
    await tx
      .delete(schema.examAttempts)
      .where(eq(schema.examAttempts.organizationId, organizationId));
    await tx
      .delete(schema.examEnrollments)
      .where(eq(schema.examEnrollments.organizationId, organizationId));
    await tx
      .delete(schema.exams)
      .where(eq(schema.exams.organizationId, organizationId));
    await tx
      .delete(schema.questions)
      .where(eq(schema.questions.organizationId, organizationId));
    await tx
      .delete(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.organizationId, organizationId));
    await tx
      .delete(schema.candidateFields)
      .where(eq(schema.candidateFields.organizationId, organizationId));
    await tx
      .delete(schema.organizationSettings)
      .where(eq(schema.organizationSettings.organizationId, organizationId));
    await tx
      .delete(schema.courses)
      .where(eq(schema.courses.organizationId, organizationId));
  });
}
