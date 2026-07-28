import { eq } from "drizzle-orm";
import { schema } from "./schema/pg.js";
import type { Database } from "./types.js";
import { executeInTransaction } from "./types.js";

async function deleteOrganizationTreeOnce(
  db: Database,
  organizationId: string,
): Promise<void> {
  await executeInTransaction(db, async (tx) => {
    await deleteExamBusinessData(tx, organizationId);
    await tx
      .delete(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.organizationId, organizationId));
    await tx
      .delete(schema.candidateFields)
      .where(eq(schema.candidateFields.organizationId, organizationId));
    await tx
      .delete(schema.organizationSettings)
      .where(eq(schema.organizationSettings.organizationId, organizationId));
    // RBAC-M7: assignments deleted before users (no FK reliance on CASCADE
    // for explicit org-tree cleanup; users CASCADE would also catch this).
    await tx
      .delete(schema.userRoleAssignments)
      .where(eq(schema.userRoleAssignments.organizationId, organizationId));
    await tx
      .delete(schema.users)
      .where(eq(schema.users.organizationId, organizationId));
    await tx
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
  });
}

/**
 * Shared: delete exam-business rows (audit, attempts, enrollments, exams,
 * questions, courses) for one organization. Used by organization tree cleanup,
 * {@link cleanupOrganizationChildData}, and {@link cleanupBusinessData}.
 */
async function deleteExamBusinessData(
  tx: Database,
  organizationId: string,
): Promise<void> {
  await tx
    .delete(schema.auditLogs)
    .where(eq(schema.auditLogs.organizationId, organizationId));
  await tx
    .delete(schema.importJobLogs)
    .where(eq(schema.importJobLogs.organizationId, organizationId));
  // attemptGradingEntries has a FK → examAttempts.id (onDelete: no action);
  // must be deleted before examAttempts to avoid FK violation.
  await tx
    .delete(schema.attemptGradingEntries)
    .where(eq(schema.attemptGradingEntries.organizationId, organizationId));
  await tx
    .delete(schema.attemptInterruptionEvents)
    .where(eq(schema.attemptInterruptionEvents.organizationId, organizationId));
  await tx
    .delete(schema.attemptTimeAdjustments)
    .where(eq(schema.attemptTimeAdjustments.organizationId, organizationId));
  await tx
    .update(schema.examAttempts)
    .set({
      currentInterruptionId: null,
      interruptedAt: null,
      // The 0022 status/pointer CHECK requires non-disrupted status when
      // the pointer is null. Transition disrupted rows to voided so the
      // nulling UPDATE is accepted — the rows are about to be deleted in
      // the next step regardless of the status value.
      status: "voided",
    })
    .where(eq(schema.examAttempts.organizationId, organizationId));
  await tx
    .delete(schema.attemptInterruptions)
    .where(eq(schema.attemptInterruptions.organizationId, organizationId));
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
    .delete(schema.courses)
    .where(eq(schema.courses.organizationId, organizationId));
}

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
 *
 * QUIESCENCE PRECONDITION: stop request/background producers and drain their
 * accepted work before calling this helper. Destructive deletion is not a
 * synchronization mechanism and this helper does not retry lifecycle races.
 */
export async function cleanupOrganizationTestData(
  db: Database,
  organizationId: string,
): Promise<void> {
  await deleteOrganizationTreeOnce(db, organizationId);
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
    await deleteExamBusinessData(tx, organizationId);
    await tx
      .delete(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.organizationId, organizationId));
    await tx
      .delete(schema.candidateFields)
      .where(eq(schema.candidateFields.organizationId, organizationId));
    await tx
      .delete(schema.organizationSettings)
      .where(eq(schema.organizationSettings.organizationId, organizationId));
  });
}

/**
 * Test-only: delete exam-related business data (audit, attempts, enrollments,
 * exams, questions, courses) for a given organization while KEEPING the
 * organization, users, candidate profiles, and candidate fields intact.
 *
 * Use this to reset test state between tests that share an organization
 * (e.g. deadline scanner tests, tenant-isolation tests) without destroying
 * the org that subsequent tests depend on. Idempotent.
 *
 * DIFFERENCE FROM `cleanupOrganizationChildData`:
 * This helper is intentionally narrower — it only deletes exam-business
 * tables that accumulate across test runs and cause cross-run pollution.
 * It preserves org-level configuration (settings, candidate fields/profiles)
 * and user accounts that tests rely on for authentication.
 *
 * QUIESCENCE PRECONDITION: drain accepted background work before calling this
 * helper. A late write after cleanup violates test isolation even though the
 * retained organization prevents a foreign-key failure.
 */
export async function cleanupBusinessData(
  db: Database,
  organizationId: string,
): Promise<void> {
  await executeInTransaction(db, async (tx) => {
    await deleteExamBusinessData(tx, organizationId);
  });
}
