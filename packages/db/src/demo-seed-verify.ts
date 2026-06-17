import { eq, and } from "drizzle-orm";
import type { Database } from "./types.js";
import { schema } from "./schema/pg.js";

/** Shape of demo seed IDs used for verification lookups. */
interface DemoIds {
  orgId: string;
  settingsId: string;
  users: Record<string, string>;
  candidateFields: Record<string, string>;
  courses: Record<string, string>;
  questions: Record<string, string>;
  exams: Record<string, string>;
  enrollments: Record<string, string>;
  attempts: Record<string, string>;
}

/**
 * Verifies the demo seed data integrity by checking organizations, users,
 * candidate profiles, courses, questions, exams, enrollments, and attempts.
 * @returns An array of error messages; empty array means verification passed.
 */
export async function verifyDemoSeed(
  db: Database,
  ids: DemoIds,
): Promise<string[]> {
  const errors: string[] = [];
  const now = Date.now();

  /** Appends a message to the error list when a condition is false. */
  function assert(condition: boolean, message: string): void {
    if (!condition) errors.push(message);
  }

  // 1. Organization exists
  const orgRows = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, ids.orgId));
  const org = orgRows[0];
  assert(!!org, "Organization not found");
  assert(org?.slug === "default", "Organization slug should be 'default'");

  // 2. Settings exist
  const settingsRows = await db
    .select()
    .from(schema.organizationSettings)
    .where(eq(schema.organizationSettings.organizationId, ids.orgId));
  const settings = settingsRows[0];
  assert(!!settings, "OrganizationSettings not found");
  assert(
    settings?.productName === "考试平台",
    "Settings productName should be '考试平台'",
  );

  // 3. All users exist
  const requiredUsers = [
    "admin",
    "candidate1",
    "candidate2",
    "candidate3",
    "candidate4",
  ];
  for (const username of requiredUsers) {
    const rows = await db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.organizationId, ids.orgId),
          eq(schema.users.username, username),
        ),
      );
    const user = rows[0];
    assert(!!user, `User '${username}' not found`);
    assert(user?.isActive === true, `User '${username}' should be active`);
  }

  // 4. Candidate profiles exist for candidate users
  for (const username of [
    "candidate1",
    "candidate2",
    "candidate3",
    "candidate4",
  ]) {
    const userId = ids.users[username];
    if (!userId) {
      errors.push(`No user ID for '${username}'`);
      continue;
    }
    const rows = await db
      .select()
      .from(schema.candidateProfiles)
      .where(
        and(
          eq(schema.candidateProfiles.organizationId, ids.orgId),
          eq(schema.candidateProfiles.userId, userId),
        ),
      );
    const profile = rows[0];
    assert(!!profile, `CandidateProfile for '${username}' not found`);
    const fields = profile?.fields as Record<string, unknown> | undefined;
    assert(
      !!fields?.candidateNo,
      `CandidateProfile for '${username}' missing candidateNo`,
    );
  }

  // 5. Candidate fields exist
  for (const fieldName of ["candidateNo", "department"]) {
    const rows = await db
      .select()
      .from(schema.candidateFields)
      .where(
        and(
          eq(schema.candidateFields.organizationId, ids.orgId),
          eq(schema.candidateFields.name, fieldName),
        ),
      );
    assert(rows.length > 0, `CandidateField '${fieldName}' not found`);
  }

  // 6. Courses exist
  for (const code of ["SAFETY-101", "SKILL-201", "EMPTY-001"]) {
    const rows = await db
      .select()
      .from(schema.courses)
      .where(
        and(
          eq(schema.courses.organizationId, ids.orgId),
          eq(schema.courses.code, code),
        ),
      );
    assert(rows.length > 0, `Course '${code}' not found`);
  }

  // 7. Non-empty courses have questions
  const safetyCourseId = ids.courses["SAFETY-101"];
  const skillCourseId = ids.courses["SKILL-201"];
  const emptyCourseId = ids.courses["EMPTY-001"];

  if (safetyCourseId) {
    const safetyQuestions = await db
      .select()
      .from(schema.questions)
      .where(
        and(
          eq(schema.questions.organizationId, ids.orgId),
          eq(schema.questions.courseId, safetyCourseId),
        ),
      );
    assert(
      safetyQuestions.length >= 6,
      `SAFETY-101 should have >= 6 questions, found ${safetyQuestions.length}`,
    );
  }

  if (skillCourseId) {
    const skillQuestions = await db
      .select()
      .from(schema.questions)
      .where(
        and(
          eq(schema.questions.organizationId, ids.orgId),
          eq(schema.questions.courseId, skillCourseId),
        ),
      );
    assert(
      skillQuestions.length >= 4,
      `SKILL-201 should have >= 4 questions, found ${skillQuestions.length}`,
    );
  }

  if (emptyCourseId) {
    const emptyQuestions = await db
      .select()
      .from(schema.questions)
      .where(
        and(
          eq(schema.questions.organizationId, ids.orgId),
          eq(schema.questions.courseId, emptyCourseId),
        ),
      );
    assert(
      emptyQuestions.length === 0,
      `EMPTY-001 should have 0 questions, found ${emptyQuestions.length}`,
    );
  }

  // 8. Question type coverage
  const allQuestions = await db
    .select()
    .from(schema.questions)
    .where(eq(schema.questions.organizationId, ids.orgId));
  const types = new Set(allQuestions.map((q) => q.type));
  assert(types.has("single_choice"), "Missing single_choice question type");
  assert(types.has("multiple_choice"), "Missing multiple_choice question type");
  assert(types.has("true_false"), "Missing true_false question type");
  assert(types.has("fill_blank"), "Missing fill_blank question type");

  // 9. Exams exist with correct statuses
  const examStatusMap: Record<string, string> = {
    open: "open",
    draft: "draft",
    published: "published",
    closed: "closed",
  };

  for (const [key, expectedStatus] of Object.entries(examStatusMap)) {
    const examId = ids.exams[key];
    if (!examId) {
      errors.push(`Exam '${key}' ID not found`);
      continue;
    }
    const rows = await db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, examId));
    const exam = rows[0];
    assert(!!exam, `Exam '${key}' not found`);
    assert(
      exam?.status === expectedStatus,
      `Exam '${key}' should be '${expectedStatus}', got '${exam?.status}'`,
    );
  }

  // 10. Published/open/closed exams have question snapshots
  for (const key of ["open", "published", "closed"]) {
    const examId = ids.exams[key];
    if (!examId) continue;
    const rows = await db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, examId));
    const exam = rows[0];
    const snapshot = exam?.questionSnapshot as Array<unknown> | undefined;
    assert(
      Array.isArray(snapshot) && snapshot.length > 0,
      `Exam '${key}' (${exam?.title}) has no question snapshots`,
    );
  }

  // 11. Draft exam has empty snapshot
  {
    const draftExamId = ids.exams["draft"];
    if (draftExamId) {
      const rows = await db
        .select()
        .from(schema.exams)
        .where(eq(schema.exams.id, draftExamId));
      const exam = rows[0];
      const snapshot = exam?.questionSnapshot as Array<unknown> | undefined;
      assert(
        Array.isArray(snapshot) && snapshot.length === 0,
        `Draft exam should have empty questionSnapshot`,
      );
    }
  }

  // 12. Exam totalScore = snapshot score sum
  for (const key of ["open", "published", "closed"]) {
    const examId = ids.exams[key];
    if (!examId) continue;
    const rows = await db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, examId));
    const exam = rows[0];
    if (!exam) continue;
    const snapshot = exam.questionSnapshot as Array<{ score: number }>;
    if (snapshot && snapshot.length > 0) {
      const sum = snapshot.reduce((s, q) => s + q.score, 0);
      assert(
        exam.totalScore === sum,
        `Exam '${key}' totalScore (${exam.totalScore}) != snapshot sum (${sum})`,
      );
    }
  }

  // 13. Time window checks
  {
    const openExamRows = await db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, ids.exams["open"] ?? ""));
    const openExam = openExamRows[0];
    if (openExam) {
      assert(
        openExam.openAt.getTime() <= now,
        `Open exam openAt should be <= now`,
      );
      assert(
        openExam.closeAt.getTime() > now,
        `Open exam closeAt should be > now`,
      );
    }

    const closedExamRows = await db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, ids.exams["closed"] ?? ""));
    const closedExam = closedExamRows[0];
    if (closedExam) {
      assert(
        closedExam.closeAt.getTime() < now,
        `Closed exam closeAt should be < now`,
      );
    }

    const publishedExamRows = await db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, ids.exams["published"] ?? ""));
    const publishedExam = publishedExamRows[0];
    if (publishedExam) {
      assert(
        publishedExam.openAt.getTime() > now,
        `Future published exam openAt should be > now`,
      );
    }
  }

  // 14. Enrollments belong only to Candidate users
  const allEnrollments = await db
    .select()
    .from(schema.examEnrollments)
    .where(eq(schema.examEnrollments.organizationId, ids.orgId));

  for (const enrollment of allEnrollments) {
    const profileRows = await db
      .select()
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.id, enrollment.candidateId));
    const profile = profileRows[0];
    assert(
      profile !== undefined,
      `Enrollment ${enrollment.id} references missing candidateProfile for candidateId='${enrollment.candidateId}'`,
    );
    if (profile) {
      const userRows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, profile.userId));
      const user = userRows[0];
      assert(
        user?.role === "Candidate",
        `Enrollment ${enrollment.id} belongs to non-Candidate user '${user?.username}' (role: ${user?.role})`,
      );
    }
  }

  // 15. Graded attempts have grading detail
  const gradedAttempts = await db
    .select()
    .from(schema.examAttempts)
    .where(
      and(
        eq(schema.examAttempts.organizationId, ids.orgId),
        eq(schema.examAttempts.status, "graded"),
      ),
    );

  for (const attempt of gradedAttempts) {
    assert(
      attempt.score !== null && attempt.score !== undefined,
      `Graded attempt ${attempt.id} has no score`,
    );
    assert(
      attempt.passed !== null && attempt.passed !== undefined,
      `Graded attempt ${attempt.id} has no passed flag`,
    );
    assert(
      attempt.gradedAt !== null,
      `Graded attempt ${attempt.id} has no gradedAt`,
    );
    const gradingResult = attempt.gradingResult as Array<unknown> | undefined;
    assert(
      Array.isArray(gradingResult) && gradingResult.length > 0,
      `Graded attempt ${attempt.id} has no gradingResult`,
    );
  }

  // 16. In-progress attempt has valid snapshot and deadline
  {
    const ipAttemptId = ids.attempts["open-c1-inprogress"];
    if (ipAttemptId) {
      const rows = await db
        .select()
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.id, ipAttemptId));
      const attempt = rows[0];
      assert(
        attempt?.status === "in_progress",
        `In-progress attempt should be 'in_progress', got '${attempt?.status}'`,
      );
      const snapshot = attempt?.questionSnapshot as Array<unknown> | undefined;
      assert(
        Array.isArray(snapshot) && snapshot.length > 0,
        `In-progress attempt has no questionSnapshot`,
      );
      assert(
        attempt != null &&
          attempt.deadlineAt != null &&
          attempt.deadlineAt.getTime() > now,
        `In-progress attempt deadlineAt should be in the future`,
      );
    }
  }

  // 17. Disrupted attempt exists
  {
    const disruptedId = ids.attempts["open-c3-disrupted"];
    if (disruptedId) {
      const rows = await db
        .select()
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.id, disruptedId));
      const attempt = rows[0];
      assert(
        attempt?.status === "disrupted",
        `Disrupted attempt should be 'disrupted', got '${attempt?.status}'`,
      );
    }
  }

  // 18. Enrollment finalScore consistency (highest strategy)
  {
    const closedExamId = ids.exams["closed"];
    const c1ProfileRows = await db
      .select()
      .from(schema.candidateProfiles)
      .where(
        and(
          eq(schema.candidateProfiles.organizationId, ids.orgId),
          eq(schema.candidateProfiles.userId, ids.users["candidate1"] ?? ""),
        ),
      );
    const c1ProfileId = c1ProfileRows[0]?.id;

    if (closedExamId && c1ProfileId) {
      const enrollmentRows = await db
        .select()
        .from(schema.examEnrollments)
        .where(
          and(
            eq(schema.examEnrollments.organizationId, ids.orgId),
            eq(schema.examEnrollments.examId, closedExamId),
            eq(schema.examEnrollments.candidateId, c1ProfileId),
          ),
        );
      const enrollment = enrollmentRows[0];

      if (enrollment) {
        const gradedForC1 = await db
          .select()
          .from(schema.examAttempts)
          .where(
            and(
              eq(schema.examAttempts.organizationId, ids.orgId),
              eq(schema.examAttempts.enrollmentId, enrollment.id),
              eq(schema.examAttempts.status, "graded"),
            ),
          );

        if (gradedForC1.length >= 2) {
          const highestScore = Math.max(
            ...gradedForC1.map((a) => a.score ?? 0),
          );
          assert(
            enrollment.finalScore === highestScore,
            `Closed exam candidate1 enrollment finalScore (${enrollment.finalScore}) != highest graded score (${highestScore})`,
          );
        }
      }
    }
  }

  return errors;
}
