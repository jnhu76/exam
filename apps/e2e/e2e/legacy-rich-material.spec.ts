import { test, expect } from "@playwright/test";
import { adminApiToken, adminPost, adminGet } from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * #678 review (P2) — the Standard phase of the legacy-Rich switch story.
 *
 * This spec authors the LEGACY material through the real authoring API under
 * the default Standard ceiling: a rich-prompt single_choice (one rich
 * option), a rich-answer 简答, and a PUBLISHED exam freezing both, plus one
 * enrolled candidate with FIXED credentials. The Minimal phase
 * (minimal-rich-downgrade.spec.ts) then boots the same database under
 * PRODUCT_PRESET=minimal and drives the browser conversions against this
 * material — the production story being reproduced: the deployment authored
 * Rich under Standard, published, and only then switched the static preset.
 *
 * Stable markers (no cross-run state sharing): the question contents, exam
 * title, and candidate credentials are fixed literals prefixed
 * LEGACY-RICH-678 so the Minimal spec can rediscover them by search. The
 * serial DB path pairs the runs explicitly:
 *
 *   bash scripts/e2e/run.sh legacy-rich-material              # Standard, reseed
 *   PRODUCT_PRESET=minimal bash scripts/e2e/run.sh --no-reseed minimal-rich-downgrade
 *
 * (CI's minimal lane runs both phases against one database: this spec with
 * the server on Standard, then the server restarts Minimal — testing.md
 * §4.2.1.) Under the standard sharded lanes this spec also stands on its own
 * as a light rich-authoring regression: the write seam accepts the material
 * and the search projection serves it.
 */

const MARKER = "LEGACY-RICH-678";
const PROMPT_TEXT = `${MARKER} 题干`;
const OPTION_TEXT = `${MARKER} 选项`;
const SHORT_ANSWER_TEXT = `${MARKER} 简答`;
const EXAM_TITLE = `${MARKER} 卷`;
const CANDIDATE = {
  username: "legacy-rich-678",
  password: "candidate123",
  name: "Legacy Rich 678 Candidate",
  candidateNo: "LEGACY-RICH-678",
};

/** Formatted (bold) legacy prompt: the lossy-confirm conversion path. */
const RICH_PROMPT_DOC = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: PROMPT_TEXT, marks: ["bold"] }],
    },
  ],
};

/** Unformatted legacy option: the direct (no-confirm) conversion path. */
const RICH_OPTION_DOC = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: OPTION_TEXT }],
    },
  ],
};

test.describe("Legacy Rich material authored under Standard (#678 review)", () => {
  test("seeds a published rich exam + rich-answer question with an enrolled candidate", async ({
    request,
  }) => {
    const token = await adminApiToken(request);
    const stamp = Date.now();

    const course = await adminPost(request, token, "/api/courses", {
      name: `${MARKER} 课程`,
      code: `LR-${stamp}`,
      description: "",
    });
    expect(course.status(), course.text()).toBe(201);
    const courseId = ((await course.json()) as { id: string }).id;

    const qPrompt = await adminPost(request, token, "/api/questions", {
      courseId,
      type: "single_choice",
      content: PROMPT_TEXT,
      contentDocument: RICH_PROMPT_DOC,
      options: [
        { id: "a", content: OPTION_TEXT, contentDocument: RICH_OPTION_DOC },
        { id: "b", content: "plain option" },
      ],
      standardAnswer: "a",
      score: 50,
    });
    expect(qPrompt.status(), qPrompt.text()).toBe(201);

    const qShortAnswer = await adminPost(request, token, "/api/questions", {
      courseId,
      type: "text_response",
      content: SHORT_ANSWER_TEXT,
      answerMode: "rich",
      standardAnswer: null,
      rubric: "按要点给分",
      score: 50,
    });
    expect(qShortAnswer.status(), qShortAnswer.text()).toBe(201);

    const promptId = ((await qPrompt.json()) as { id: string }).id;
    const shortAnswerId = ((await qShortAnswer.json()) as { id: string }).id;

    const exam = await adminPost(request, token, "/api/exams", {
      title: EXAM_TITLE,
      description: "",
      courseId,
      durationMinutes: 60,
      openAt: new Date(Date.now() - 3_600_000).toISOString(),
      closeAt: new Date(Date.now() + 86_400_000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [promptId, shortAnswerId],
      resultPublicationMode: "immediate",
    });
    expect(exam.status(), exam.text()).toBe(201);
    const examId = ((await exam.json()) as { id: string }).id;

    const publish = await adminPost(
      request,
      token,
      `/api/exams/${examId}/publish`,
    );
    expect(publish.status(), publish.text()).toBe(200);

    const candidate = await request.post(`${BASE_URL}/api/candidates`, {
      data: {
        username: CANDIDATE.username,
        password: CANDIDATE.password,
        name: CANDIDATE.name,
        fields: { candidateNo: CANDIDATE.candidateNo },
      },
    });
    expect(candidate.status(), candidate.text()).toBe(201);
    const profileId = ((await candidate.json()) as { id: string }).id;

    const enroll = await adminPost(
      request,
      token,
      `/api/exams/${examId}/enrollments`,
      { candidateIds: [profileId] },
    );
    expect(enroll.status(), enroll.text()).toBe(200);

    // The search projection (the discovery channel the Minimal phase uses)
    // serves both legacy questions with their rich slots intact.
    const search = await adminGet(
      request,
      token,
      `/api/questions?search=${encodeURIComponent(MARKER)}&pageSize=50`,
    );
    expect(search.status(), search.text()).toBe(200);
    const items = (
      (await search.json()) as {
        items: Array<{
          id: string;
          content: string;
          contentDocument: unknown;
          answerMode: string | null;
        }>;
      }
    ).items;
    const servedPrompt = items.find((q) => q.content === PROMPT_TEXT);
    const servedShortAnswer = items.find(
      (q) => q.content === SHORT_ANSWER_TEXT,
    );
    expect(servedPrompt?.id).toBe(promptId);
    expect(servedPrompt?.contentDocument).toEqual(RICH_PROMPT_DOC);
    expect(servedShortAnswer?.id).toBe(shortAnswerId);
    expect(servedShortAnswer?.answerMode).toBe("rich");
  });
});
