import { eq } from "drizzle-orm";
import { schema } from "./schema/pg.js";
import type { Database } from "./types.js";
import { executeInTransaction } from "./types.js";

/**
 * PostgreSQL SQLSTATE for foreign key violation. Drizzle/postgres.js surfaces
 * this on the thrown error as `.code`.
 */
const FK_VIOLATION_CODE = "23503";

/**
 * Maximum number of attempts when deleting an organization that is being
 * targeted by a still-pending fire-and-forget audit-log insert. Each retry
 * re-runs the full delete transaction; a pending insert that lands between the
 * `audit_logs` delete and the `organizations` delete is picked up on the next
 * attempt's `audit_logs` delete.
 */
const MAX_CLEANUP_ATTEMPTS = 5;
const CLEANUP_RETRY_DELAY_MS = 50;

export function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === FK_VIOLATION_CODE
  );
}

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * RACE RESILIENCE: production route handlers write audit logs via the
 * fire-and-forget `recordAudit()` helper (the insert is NOT awaited by the
 * request). When a test tears down its org in a `finally` block immediately
 * after such a request, the pending audit insert can commit between this
 * helper's `audit_logs` delete and its `organizations` delete, causing an
 * `audit_logs_organization_id_organizations_id_fk` violation. To tolerate that
 * timing window, the full delete transaction is retried a bounded number of
 * times on a foreign-key violation; the next attempt's `audit_logs` delete
 * removes the late-landing insert and the org delete then succeeds.
 */
export async function cleanupOrganizationTestData(
  db: Database,
  organizationId: string,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_CLEANUP_ATTEMPTS; attempt++) {
    try {
      await deleteOrganizationTreeOnce(db, organizationId);
      return;
    } catch (err) {
      lastErr = err;
      if (!isForeignKeyViolation(err)) throw err;
      // Org still referenced by a late-landing fire-and-forget audit insert;
      // give it a moment to commit, then retry the whole delete tree.
      if (attempt < MAX_CLEANUP_ATTEMPTS) {
        await delay(CLEANUP_RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
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
 * NOTE: Because the organization row is preserved, a late fire-and-forget
 * audit insert after this transaction will NOT cause a foreign-key violation
 * (the org still exists). The orphan audit row will be cleaned up by the
 * next call or by `cleanupOrganizationTestData` at suite teardown. This is
 * acceptable for test-state isolation purposes.
 */
export async function cleanupBusinessData(
  db: Database,
  organizationId: string,
): Promise<void> {
  await executeInTransaction(db, async (tx) => {
    await deleteExamBusinessData(tx, organizationId);
  });
}
