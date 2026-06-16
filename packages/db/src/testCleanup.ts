import { eq } from "drizzle-orm";
import { schema } from "./schema/pg.js";
import type { Database } from "./types.js";
import { executeInTransaction } from "./types.js";

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
