import { eq, and } from "drizzle-orm";
import type { SqliteDatabase } from "./types.js";
import { sqliteSchema } from "./schema/sqlite.js";

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

export function verifyDemoSeed(db: SqliteDatabase, ids: DemoIds): string[] {
  const errors: string[] = [];
  const now = Date.now();

  function assert(condition: boolean, message: string): void {
    if (!condition) errors.push(message);
  }

  // 1. Organization exists
  const org = db
    .select()
    .from(sqliteSchema.organizations)
    .where(eq(sqliteSchema.organizations.id, ids.orgId))
    .get();
  assert(!!org, "Organization not found");
  assert(org?.slug === "demo", "Organization slug should be 'demo'");

  // 2. Settings exist
  const settings = db
    .select()
    .from(sqliteSchema.organizationSettings)
    .where(eq(sqliteSchema.organizationSettings.organizationId, ids.orgId))
    .get();
  assert(!!settings, "OrganizationSettings not found");
  assert(
    settings?.productName === "Exam Platform",
    "Settings productName should be 'Exam Platform'",
  );

  // 3. All users exist
  const requiredUsers = [
    "superadmin",
    "admin",
    "teacher1",
    "teacher2",
    "candidate1",
    "candidate2",
    "candidate3",
    "candidate4",
  ];
  for (const username of requiredUsers) {
    const user = db
      .select()
      .from(sqliteSchema.users)
      .where(
        and(
          eq(sqliteSchema.users.organizationId, ids.orgId),
          eq(sqliteSchema.users.username, username),
        ),
      )
      .get();
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
    const profile = db
      .select()
      .from(sqliteSchema.candidateProfiles)
      .where(
        and(
          eq(sqliteSchema.candidateProfiles.organizationId, ids.orgId),
          eq(sqliteSchema.candidateProfiles.userId, userId),
        ),
      )
      .get();
    assert(!!profile, `CandidateProfile for '${username}' not found`);
    const fields = profile?.fields as Record<string, unknown> | undefined;
    assert(
      !!fields?.employeeId,
      `CandidateProfile for '${username}' missing employeeId`,
    );
  }

  // 5. Candidate fields exist
  for (const fieldName of ["employeeId", "department", "phone"]) {
    const field = db
      .select()
      .from(sqliteSchema.candidateFields)
      .where(
        and(
          eq(sqliteSchema.candidateFields.organizationId, ids.orgId),
          eq(sqliteSchema.candidateFields.name, fieldName),
        ),
      )
      .get();
    assert(!!field, `CandidateField '${fieldName}' not found`);
  }

  // 6. Courses exist
  for (const code of ["SAFETY-101", "SKILL-201", "EMPTY-001"]) {
    const course = db
      .select()
      .from(sqliteSchema.courses)
      .where(
        and(
          eq(sqliteSchema.courses.organizationId, ids.orgId),
          eq(sqliteSchema.courses.code, code),
        ),
      )
      .get();
    assert(!!course, `Course '${code}' not found`);
  }

  // 7. Non-empty courses have questions
  const safetyCourseId = ids.courses["SAFETY-101"];
  const skillCourseId = ids.courses["SKILL-201"];
  const emptyCourseId = ids.courses["EMPTY-001"];

  if (safetyCourseId) {
    const safetyQuestions = db
      .select()
      .from(sqliteSchema.questions)
      .where(
        and(
          eq(sqliteSchema.questions.organizationId, ids.orgId),
          eq(sqliteSchema.questions.courseId, safetyCourseId),
        ),
      )
      .all();
    assert(
      safetyQuestions.length >= 6,
      `SAFETY-101 should have >= 6 questions, found ${safetyQuestions.length}`,
    );
  }

  if (skillCourseId) {
    const skillQuestions = db
      .select()
      .from(sqliteSchema.questions)
      .where(
        and(
          eq(sqliteSchema.questions.organizationId, ids.orgId),
          eq(sqliteSchema.questions.courseId, skillCourseId),
        ),
      )
      .all();
    assert(
      skillQuestions.length >= 4,
      `SKILL-201 should have >= 4 questions, found ${skillQuestions.length}`,
    );
  }

  if (emptyCourseId) {
    const emptyQuestions = db
      .select()
      .from(sqliteSchema.questions)
      .where(
        and(
          eq(sqliteSchema.questions.organizationId, ids.orgId),
          eq(sqliteSchema.questions.courseId, emptyCourseId),
        ),
      )
      .all();
    assert(
      emptyQuestions.length === 0,
      `EMPTY-001 should have 0 questions, found ${emptyQuestions.length}`,
    );
  }

  // 8. Question type coverage
  const allQuestions = db
    .select()
    .from(sqliteSchema.questions)
    .where(eq(sqliteSchema.questions.organizationId, ids.orgId))
    .all();
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
    strict: "open",
  };

  for (const [key, expectedStatus] of Object.entries(examStatusMap)) {
    const examId = ids.exams[key];
    if (!examId) {
      errors.push(`Exam '${key}' ID not found`);
      continue;
    }
    const exam = db
      .select()
      .from(sqliteSchema.exams)
      .where(eq(sqliteSchema.exams.id, examId))
      .get();
    assert(!!exam, `Exam '${key}' not found`);
    assert(
      exam?.status === expectedStatus,
      `Exam '${key}' should be '${expectedStatus}', got '${exam?.status}'`,
    );
  }

  // 10. Published/open/closed exams have question snapshots
  for (const key of ["open", "published", "closed", "strict"]) {
    const examId = ids.exams[key];
    if (!examId) continue;
    const exam = db
      .select()
      .from(sqliteSchema.exams)
      .where(eq(sqliteSchema.exams.id, examId))
      .get();
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
      const exam = db
        .select()
        .from(sqliteSchema.exams)
        .where(eq(sqliteSchema.exams.id, draftExamId))
        .get();
      const snapshot = exam?.questionSnapshot as Array<unknown> | undefined;
      assert(
        Array.isArray(snapshot) && snapshot.length === 0,
        `Draft exam should have empty questionSnapshot`,
      );
    }
  }

  // 12. Exam totalScore = snapshot score sum
  for (const key of ["open", "published", "closed", "strict"]) {
    const examId = ids.exams[key];
    if (!examId) continue;
    const exam = db
      .select()
      .from(sqliteSchema.exams)
      .where(eq(sqliteSchema.exams.id, examId))
      .get();
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
    const openExam = db
      .select()
      .from(sqliteSchema.exams)
      .where(eq(sqliteSchema.exams.id, ids.exams["open"] ?? ""))
      .get();
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

    const closedExam = db
      .select()
      .from(sqliteSchema.exams)
      .where(eq(sqliteSchema.exams.id, ids.exams["closed"] ?? ""))
      .get();
    if (closedExam) {
      assert(
        closedExam.closeAt.getTime() < now,
        `Closed exam closeAt should be < now`,
      );
    }

    const publishedExam = db
      .select()
      .from(sqliteSchema.exams)
      .where(eq(sqliteSchema.exams.id, ids.exams["published"] ?? ""))
      .get();
    if (publishedExam) {
      assert(
        publishedExam.openAt.getTime() > now,
        `Future published exam openAt should be > now`,
      );
    }
  }

  // 14. Enrollments belong only to Candidate users
  const allEnrollments = db
    .select()
    .from(sqliteSchema.examEnrollments)
    .where(eq(sqliteSchema.examEnrollments.organizationId, ids.orgId))
    .all();

  for (const enrollment of allEnrollments) {
    const profile = db
      .select()
      .from(sqliteSchema.candidateProfiles)
      .where(eq(sqliteSchema.candidateProfiles.id, enrollment.candidateId))
      .get();
    if (profile) {
      const user = db
        .select()
        .from(sqliteSchema.users)
        .where(eq(sqliteSchema.users.id, profile.userId))
        .get();
      assert(
        user?.role === "Candidate",
        `Enrollment ${enrollment.id} belongs to non-Candidate user '${user?.username}' (role: ${user?.role})`,
      );
    }
  }

  // 15. Graded attempts have grading detail
  const gradedAttempts = db
    .select()
    .from(sqliteSchema.examAttempts)
    .where(
      and(
        eq(sqliteSchema.examAttempts.organizationId, ids.orgId),
        eq(sqliteSchema.examAttempts.status, "graded"),
      ),
    )
    .all();

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
      const attempt = db
        .select()
        .from(sqliteSchema.examAttempts)
        .where(eq(sqliteSchema.examAttempts.id, ipAttemptId))
        .get();
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
        attempt?.deadlineAt !== null && attempt!.deadlineAt!.getTime() > now,
        `In-progress attempt deadlineAt should be in the future`,
      );
    }
  }

  // 17. Disrupted attempt exists
  {
    const disruptedId = ids.attempts["open-c3-disrupted"];
    if (disruptedId) {
      const attempt = db
        .select()
        .from(sqliteSchema.examAttempts)
        .where(eq(sqliteSchema.examAttempts.id, disruptedId))
        .get();
      assert(
        attempt?.status === "disrupted",
        `Disrupted attempt should be 'disrupted', got '${attempt?.status}'`,
      );
    }
  }

  // 18. Enrollment finalScore consistency (highest strategy)
  {
    const closedExamId = ids.exams["closed"];
    const c1ProfileId = db
      .select()
      .from(sqliteSchema.candidateProfiles)
      .where(
        and(
          eq(sqliteSchema.candidateProfiles.organizationId, ids.orgId),
          eq(
            sqliteSchema.candidateProfiles.userId,
            ids.users["candidate1"] ?? "",
          ),
        ),
      )
      .get()?.id;

    if (closedExamId && c1ProfileId) {
      const enrollment = db
        .select()
        .from(sqliteSchema.examEnrollments)
        .where(
          and(
            eq(sqliteSchema.examEnrollments.organizationId, ids.orgId),
            eq(sqliteSchema.examEnrollments.examId, closedExamId),
            eq(sqliteSchema.examEnrollments.candidateId, c1ProfileId),
          ),
        )
        .get();

      if (enrollment) {
        const gradedForC1 = db
          .select()
          .from(sqliteSchema.examAttempts)
          .where(
            and(
              eq(sqliteSchema.examAttempts.organizationId, ids.orgId),
              eq(sqliteSchema.examAttempts.enrollmentId, enrollment.id),
              eq(sqliteSchema.examAttempts.status, "graded"),
            ),
          )
          .all();

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
