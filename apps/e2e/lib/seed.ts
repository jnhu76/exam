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
}

/** A subjective (manual-graded) question to seed: fill_blank with null answer. */
export interface SubjectiveQuestionSeed {
  /** Score weight for this question. */
  score: number;
  /** Content must include a `____` placeholder for the fill_blank input. */
  content?: string;
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
  const body = await adminPost(request, baseURL, token, "/api/candidates", {
    username,
    password,
    name: `E2E Candidate ${unique} ${stamp}`,
    fields: { candidateNo: `E2E-${unique}-${stamp}` },
  });
  return {
    profileId: body.id as string,
    userId: body.userId as string,
    username,
    name:
      (body.name as string | undefined) ?? `E2E Candidate ${unique} ${stamp}`,
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
    /** Optional subjective (manual-graded) fill_blank questions to include. */
    subjectiveQuestions?: SubjectiveQuestionSeed[];
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

  const exam = await adminPost(request, baseURL, token, "/api/exams", {
    title: examTitle,
    description: "",
    courseId,
    timingMode: "timed_window",
    durationMinutes: opts.durationMinutes ?? 60,
    openAt: new Date(Date.now() - 3600_000).toISOString(),
    closeAt: new Date(Date.now() + 86400_000).toISOString(),
    passingScore: opts.passingScore ?? 60,
    totalScore: opts.totalScore ?? 100,
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
  };
}
