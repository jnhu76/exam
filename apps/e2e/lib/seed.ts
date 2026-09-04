import type { APIRequestContext } from "@playwright/test";

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin123";

export interface SeededExam {
  examId: string;
  questionId: string;
  courseId: string;
  examTitle: string;
  candidateIds: string[];
  candidate: SeededCandidate;
  /** Subjective (manual-graded) question ids, when `subjectiveQuestions` was set. */
  subjectiveQuestionIds: string[];
  /** text_response question ids, when `textResponseQuestions` was set (P3-MOD-P0-4). */
  textResponseQuestionIds: string[];
}

/** A subjective (manual-graded) question to seed: fill_blank with null answer. */
export interface SubjectiveQuestionSeed {
  /** Score weight for this question. */
  score: number;
  /** Content must include a `____` placeholder for the fill_blank input. */
  content?: string;
}

/**
 * A text_response question to seed (P3-MOD-P0-4). Per the approved protocol
 * (`docs/architecture/exam-runtime.md` §1.1) text_response is an independent
 * QuestionType — NOT a fill_blank variant. The renderer dispatches it to a
 * textarea via `TextResponseInput`. standardAnswer is optional; rubric is
 * required at publish time (the API enforces this).
 */
export interface TextResponseQuestionSeed {
  /** Score weight for this question. */
  score: number;
  /** Question prompt content. */
  content?: string;
  /** Optional reference answer; null is valid for text_response. */
  standardAnswer?: string | null;
  /** Scoring rubric — required for text_response at publish time. */
  rubric?: string;
}

async function adminLogin(request: APIRequestContext, baseURL: string) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await request.post(`${baseURL}/api/auth/login`, {
      data: {
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
      },
    });
    if (res.status() === 429) {
      if (attempt === 5) {
        throw new Error(`admin login rate-limited after 5 attempts`);
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    if (!res.ok()) {
      throw new Error(
        `admin login failed: ${res.status()} ${await res.text()}`,
      );
    }
    const setCookie = res.headers()["set-cookie"];
    if (!setCookie) {
      throw new Error("admin login did not return auth-token cookie");
    }
    const token = setCookie.match(/auth-token=([^;]+)/)?.[1];
    if (!token) {
      throw new Error("auth-token cookie not found in set-cookie header");
    }
    return token;
  }
  throw new Error("admin login exhausted retries");
}

async function adminPost(
  request: APIRequestContext,
  baseURL: string,
  token: string,
  path: string,
  data: unknown,
) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await request.post(`${baseURL}${path}`, {
      data,
      headers: { Cookie: `auth-token=${token}` },
    });
    if (res.status() === 429) {
      if (attempt === maxAttempts) {
        throw new Error(
          `admin POST ${path} rate-limited after ${maxAttempts} attempts`,
        );
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    if (!res.ok()) {
      throw new Error(
        `admin POST ${path} failed: ${res.status()} ${await res.text()}`,
      );
    }
    return res.json();
  }
  throw new Error(`admin POST ${path} exhausted retries`);
}

/**
 * Creates an active Proctor-to-Exam assignment via the production Admin API
 * (M11-I1C, ADR-015 §16). `POST /api/admin/exams/:examId/proctors` runs the
 * real `assignProctorToExam` domain command (validation, idempotency receipt,
 * audit, operation recovery) — so E2E exercises the genuine write path, not a
 * parallel test channel. Each call gets a fresh idempotency `operationId`.
 */
export async function createProctorAssignmentFixture(
  request: APIRequestContext,
  adminToken: string,
  examId: string,
  proctorUserId: string,
): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const res = await request.post(
    `${baseURL}/api/admin/exams/${examId}/proctors`,
    {
      headers: { Cookie: `auth-token=${adminToken}` },
      data: {
        operationId: crypto.randomUUID(),
        proctorUserId,
      },
    },
  );
  if (!res.ok()) {
    throw new Error(
      `proctor-assignment failed: ${res.status()} ${await res.text()}`,
    );
  }
}

export interface SeededCandidate {
  profileId: string;
  userId: string;
  username: string;
  /** Display name (user.name). Surfaced because admin surfaces show this. */
  name: string;
  password: string;
  token?: string;
}

async function createCandidate(
  request: APIRequestContext,
  baseURL: string,
  token: string,
  unique: string,
): Promise<SeededCandidate> {
  const stamp = Date.now();
  const username = `e2e-${unique}-${stamp}`;
  const password = "candidate123";
  // Demo seed registers `candidateNo` as required+unique on the default org.
  // Always supply a unique value here so tests work whether or not the demo
  // seed has been applied (canonical seed:e2e in Docker E2E always applies it).
  // `name` is made unique (carries the stamp) because several admin surfaces
  // (e.g. the grading-queue row) display the user `name`, not the `username`;
  // a unique name lets specs match the displayed text deterministically.
  const candidateName = `E2E Candidate ${unique} ${stamp}`;
  const body = await adminPost(request, baseURL, token, "/api/candidates", {
    username,
    password,
    name: candidateName,
    fields: { candidateNo: `E2E-${unique}-${stamp}` },
  });
  return {
    profileId: body.id as string,
    userId: body.userId as string,
    username,
    name: candidateName,
    password,
  };
}

export async function seedExam(
  request: APIRequestContext,
  unique: string,
  opts: {
    questionAnswer?: boolean;
    questionScore?: number;
    durationMinutes?: number;
    passingScore?: number;
    totalScore?: number;
    resultPublicationMode?: "immediate" | "after_grading" | "manual";
    /**
     * Timing mode of the seeded exam (#291 Phase A). Defaults to
     * "timed_window". "deadline"/"untimed" seed the mode-legal field shapes
     * (deadline: null duration + explicit closeAt; untimed: null duration +
     * null closeAt); "timed_sync" is rejected by the canonical policy
     * validator and is deliberately not accepted here.
     */
    timingMode?: "timed_window" | "deadline" | "untimed";
    /** Availability-window start. Defaults to 1 hour ago. */
    openAt?: Date;
    /**
     * Availability-window end (the hard deadline for "deadline" exams).
     * Defaults to 24 hours from now; ignored (forced null) for "untimed".
     */
    closeAt?: Date;
    /**
     * Interruption time-policy frozen into started attempts. Defaults to
     * "strict". Operator time-grant (POST /time-grants) requires an exam seeded
     * with "operator_incident"; pass that value for grant-focused scenarios.
     *
     * Note: `bounded_grace` is intentionally NOT accepted here — seeding a
     * bounded_grace exam requires per-incident / per-attempt grace caps that
     * this helper does not supply. bounded_grace scenarios use their own
     * dedicated seed path (see candidate-save-submit / disconnect-restore).
     */
    interruptionTimePolicy?: "strict" | "operator_incident";
    /** Optional subjective (manual-graded) fill_blank questions to include. */
    subjectiveQuestions?: SubjectiveQuestionSeed[];
    /**
     * Optional text_response questions to include (P3-MOD-P0-4). Independent
     * QuestionType rendered as a textarea; not the legacy fill_blank-null
     * encoding.
     */
    textResponseQuestions?: TextResponseQuestionSeed[];
  } = {},
): Promise<SeededExam> {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const token = await adminLogin(request, baseURL);

  const examTitle = `E2E-${unique}-${Date.now()}`;

  const course = await adminPost(request, baseURL, token, "/api/courses", {
    name: `Course-${unique}`,
    code: `E2E-${unique}-${Date.now()}`,
    description: "",
  });
  const courseId = course.id as string;

  const question = await adminPost(request, baseURL, token, "/api/questions", {
    courseId,
    type: "true_false",
    content: `判断题-${unique}`,
    standardAnswer: opts.questionAnswer ?? true,
    score: opts.questionScore ?? 100,
  });
  const questionId = question.id as string;

  // Objective (true_false) question renders FIRST, subjective (fill_blank)
  // questions AFTER — this matches spec assumptions (e.g. manual-grading answers
  // the objective Q1 first, then navigates to subjective Q2). HEAD had this
  // order; a later edit (to fix totalScore) accidentally reversed it by
  // initializing questionIds empty and pushing base last.
  const questionIds: string[] = [questionId];
  const subjectiveQuestionIds: string[] = [];
  for (const sq of opts.subjectiveQuestions ?? []) {
    const created = await adminPost(request, baseURL, token, "/api/questions", {
      courseId,
      type: "fill_blank",
      content: sq.content ?? `主观题-${unique}-____`,
      // null standardAnswer marks the question as subjective (manual-graded).
      standardAnswer: null,
      score: sq.score,
    });
    subjectiveQuestionIds.push(created.id as string);
    questionIds.push(created.id as string);
  }
  // P3-MOD-P0-4: text_response is an independent QuestionType. Per
  // exam-protocol.md §1.1 the legacy `fill_blank + standardAnswer=null`
  // encoding is deprecated for free-text questions.
  const textResponseQuestionIds: string[] = [];
  for (const tr of opts.textResponseQuestions ?? []) {
    const created = await adminPost(request, baseURL, token, "/api/questions", {
      courseId,
      type: "text_response",
      content: tr.content ?? `论述题-${unique}`,
      standardAnswer: tr.standardAnswer ?? null,
      // rubric is required for text_response at publish time (P3-L0-5).
      rubric: tr.rubric ?? `按逻辑完整性、关键概念、论证质量给分（${unique}）`,
      score: tr.score,
    });
    textResponseQuestionIds.push(created.id as string);
    questionIds.push(created.id as string);
  }

  const subjectiveTotal =
    opts.subjectiveQuestions?.reduce((sum, q) => sum + q.score, 0) ?? 0;
  const textResponseTotal =
    opts.textResponseQuestions?.reduce((sum, q) => sum + q.score, 0) ?? 0;
  const baseQuestionScore = opts.questionScore ?? 100;
  const computedTotalScore =
    baseQuestionScore + subjectiveTotal + textResponseTotal;

  // #291 Phase A mode-legal timing shape. timed_window keeps the historical
  // defaults byte-identically (60min duration, +24h closeAt). deadline carries
  // no personal duration (closeAt IS the deadline); untimed carries neither.
  const timingMode = opts.timingMode ?? "timed_window";
  const durationMinutes =
    timingMode === "timed_window" ? (opts.durationMinutes ?? 60) : null;
  const openAt = opts.openAt ?? new Date(Date.now() - 3600_000);
  const closeAt =
    timingMode === "untimed"
      ? null
      : (opts.closeAt ?? new Date(Date.now() + 86400_000));

  const exam = await adminPost(request, baseURL, token, "/api/exams", {
    title: examTitle,
    description: "",
    courseId,
    timingMode,
    durationMinutes,
    openAt: openAt.toISOString(),
    closeAt: closeAt ? closeAt.toISOString() : null,
    passingScore: opts.passingScore ?? 60,
    totalScore: opts.totalScore ?? computedTotalScore,
    questionSelectionMode: "manual",
    questionIds,
    resultPublicationMode: opts.resultPublicationMode ?? "immediate",
    controlFlags: {
      shuffleQuestions: false,
      shuffleOptions: false,
      detectTabSwitch: false,
      disableCopyPaste: false,
      showResultImmediately: true,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 1,
    interruptionTimePolicy: opts.interruptionTimePolicy ?? "strict",
  });
  const examId = exam.id as string;

  await adminPost(request, baseURL, token, `/api/exams/${examId}/publish`, {});

  const candidate = await createCandidate(request, baseURL, token, unique);
  await adminPost(request, baseURL, token, `/api/exams/${examId}/enrollments`, {
    candidateIds: [candidate.profileId],
  });

  return {
    examId,
    questionId,
    courseId,
    examTitle,
    candidateIds: [candidate.profileId],
    candidate,
    subjectiveQuestionIds,
    textResponseQuestionIds,
  };
}
