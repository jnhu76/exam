import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { QuestionEditPage } from "./QuestionEditPage";

const { apiGet, apiPost, apiPatch } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn().mockResolvedValue(undefined),
  apiPatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const courses = [
  { id: "c1", name: "数学", code: "MATH" },
  { id: "c2", name: "英语", code: "ENG" },
];

const existingQuestion = {
  courseId: "c1",
  type: "single_choice",
  content: "1+1=?",
  options: [
    { id: "A", content: "1", isCorrect: false },
    { id: "B", content: "2", isCorrect: true },
  ],
  standardAnswer: "B",
  score: 10,
  difficulty: 2,
  tags: ["基础"],
  gradingRule: {
    multiSelectScoring: "all_correct_full",
    fillBlankMatchMode: "exact",
  },
};

function renderNew(apiImpl?: (...args: unknown[]) => Promise<unknown>) {
  if (apiImpl) {
    apiGet.mockImplementation(apiImpl);
  } else {
    apiGet.mockImplementation(() => Promise.resolve({ items: courses }));
  }
  return render(
    <MemoryRouter initialEntries={["/admin/questions/new"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/questions/new" element={<QuestionEditPage />} />
            <Route
              path="/admin/questions"
              element={<div>questions list</div>}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function renderEdit() {
  let callCount = 0;
  apiGet.mockImplementation(() => {
    callCount++;
    if (callCount === 1) return Promise.resolve({ items: courses });
    return Promise.resolve(existingQuestion);
  });
  return render(
    <MemoryRouter initialEntries={["/admin/questions/q1/edit"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
        }}
      >
        <BrandProvider>
          <Routes>
            <Route
              path="/admin/questions/:id/edit"
              element={<QuestionEditPage />}
            />
            <Route
              path="/admin/questions"
              element={<div>questions list</div>}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("QuestionEditPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset().mockResolvedValue(undefined);
    apiPatch.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading skeleton while fetching data", async () => {
    apiGet.mockImplementation(() => new Promise(() => {}));
    renderNew();
    expect(screen.getByRole("status")).toBeInTheDocument();
    await act(async () => {});
  });

  it("shows error state when API fails", async () => {
    renderNew(() => Promise.reject(new Error("network")));
    expect(await screen.findByText("加载数据失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });

  it("renders new question form with default values", async () => {
    renderNew();
    expect(await screen.findByText("新增题目")).toBeInTheDocument();
    expect(screen.getByText("保存")).toBeInTheDocument();
    expect(screen.getByText("取消")).toBeInTheDocument();
    expect(screen.getByText("考生视角预览")).toBeInTheDocument();
  });

  it("loads existing question in edit mode", async () => {
    renderEdit();
    expect(await screen.findByText("编辑题目")).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText("输入题目内容");
    expect(textarea).toHaveValue("1+1=?");
  });

  it("save button calls POST for new question", async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByText("新增题目");
    await user.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/api/questions",
        expect.objectContaining({ courseId: "c1" }),
      );
    });
  });

  it("save button calls PATCH for existing question", async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByText("编辑题目");
    await user.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/questions/q1",
        expect.objectContaining({ content: "1+1=?" }),
      );
    });
  });

  it("shows specific save error when API rejects", async () => {
    apiPost.mockRejectedValue(new Error("题目不属于所选课程"));
    const user = userEvent.setup();
    renderNew();
    await screen.findByText("新增题目");
    await user.click(screen.getByText("保存"));
    expect(await screen.findByText("题目不属于所选课程")).toBeInTheDocument();
  });

  it("cancel button is clickable and disabled during saving", async () => {
    let resolveSave: (value: unknown) => void;
    apiPost.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const user = userEvent.setup();
    renderNew();
    await screen.findByText("新增题目");
    const cancelBtn = screen.getByText("取消");
    expect(cancelBtn).toBeEnabled();
    await user.click(screen.getByText("保存"));
    expect(screen.getByRole("button", { name: "保存中..." })).toBeDisabled();
    expect(cancelBtn).toBeDisabled();
    resolveSave!(undefined);
    await act(async () => {});
  });
});

// ── P3-MOD-P2-1C: text_response authoring closure ────────────────
// text_response must be creatable end-to-end via the UI: type option,
// multiline rubric, optional standardAnswer, payload, edit echo, type
// switch normalization. These tests document and guard that closure.

// Field locators. QuestionForm uses detached <Label> + control (no
// htmlFor/id), so fields are queried by placeholder like the rest of
// this test file (see the existing "输入题目内容" usage above).
const CONTENT_PLACEHOLDER = "输入题目内容";
const RUBRIC_PLACEHOLDER =
  "请描述评分时应考虑的关键点、完整性、准确性或论证质量";

describe("QuestionEditPage — text_response authoring", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset().mockResolvedValue(undefined);
    apiPatch.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Select a question type via the form's type <Select> combobox. */
  async function selectType(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
  ) {
    await user.click(screen.getByRole("combobox", { name: "题目类型" }));
    await user.click(await screen.findByRole("option", { name }));
  }

  it("renders text_response option and shows rubric control when selected", async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByText("新增题目");

    await selectType(user, "文本作答题");

    // rubric Textarea appears (placeholder marks the grading basis field)
    expect(screen.getByPlaceholderText(RUBRIC_PLACEHOLDER)).toBeInTheDocument();
    // objective options control is NOT shown for text_response
    expect(screen.queryByText("选项")).not.toBeInTheDocument();
  });

  it("creates text_response question with multiline rubric preserved", async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByText("新增题目");

    const rubric = "关键概念正确：10 分\n论证完整且逻辑清晰：10 分";
    await selectType(user, "文本作答题");
    await user.type(
      screen.getByPlaceholderText(CONTENT_PLACEHOLDER),
      "请阐述你的观点",
    );
    await user.type(screen.getByPlaceholderText(RUBRIC_PLACEHOLDER), rubric);

    await user.click(screen.getByText("保存"));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/api/questions",
        expect.objectContaining({
          type: "text_response",
          options: [],
          standardAnswer: null,
          rubric,
        }),
      );
    });
  });

  it("does not require standardAnswer for text_response (payload null)", async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByText("新增题目");

    await selectType(user, "文本作答题");
    await user.type(
      screen.getByPlaceholderText(CONTENT_PLACEHOLDER),
      "请阐述你的观点",
    );
    await user.type(
      screen.getByPlaceholderText(RUBRIC_PLACEHOLDER),
      "按逻辑完整性给分",
    );

    // No objective answer control is shown; rubric present is enough to save.
    expect(
      screen.queryByPlaceholderText("输入标准答案，多个答案用 | 分隔"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByText("保存"));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/api/questions",
        expect.objectContaining({
          type: "text_response",
          standardAnswer: null,
          rubric: "按逻辑完整性给分",
        }),
      );
    });
  });

  it.each([
    ["empty string", ""],
    ["only spaces", "   "],
    ["only newlines", "\n\n"],
  ])(
    "rejects empty/whitespace rubric (%s) before API call",
    async (_label, badRubric) => {
      const user = userEvent.setup();
      renderNew();
      await screen.findByText("新增题目");

      await selectType(user, "文本作答题");
      await user.type(
        screen.getByPlaceholderText(CONTENT_PLACEHOLDER),
        "请阐述你的观点",
      );
      if (badRubric.length > 0) {
        await user.type(
          screen.getByPlaceholderText(RUBRIC_PLACEHOLDER),
          badRubric,
        );
      }

      await user.click(screen.getByText("保存"));

      // The save must be blocked client-side: no API call, error shown.
      expect(apiPost).not.toHaveBeenCalled();
      expect(await screen.findByText(/评分标准不能为空/)).toBeInTheDocument();
    },
  );

  it("loads and preserves existing text_response multiline rubric in edit mode", async () => {
    const existingTextResponse = {
      courseId: "c1",
      type: "text_response",
      content: "请阐述你的观点",
      options: [],
      standardAnswer: null,
      score: 20,
      difficulty: 3,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      rubric: "第一项评分标准\n第二项评分标准",
    };
    let callCount = 0;
    apiGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ items: courses });
      return Promise.resolve(existingTextResponse);
    });

    render(
      <MemoryRouter initialEntries={["/admin/questions/q1/edit"]}>
        <AuthProvider
          initialUser={{
            id: "1",
            username: "admin",
            name: "Admin",
            role: "Admin",
            organizationId: "org1",
          }}
        >
          <BrandProvider>
            <Routes>
              <Route
                path="/admin/questions/:id/edit"
                element={<QuestionEditPage />}
              />
              <Route
                path="/admin/questions"
                element={<div>questions list</div>}
              />
            </Routes>
          </BrandProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("编辑题目")).toBeInTheDocument();
    const rubricField = screen.getByPlaceholderText(RUBRIC_PLACEHOLDER);
    expect(rubricField).toBeInTheDocument();
    expect(rubricField).toHaveValue("第一项评分标准\n第二项评分标准");
  });

  it("normalizes incompatible fields when switching single_choice → text_response", async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByText("新增题目");

    // default is single_choice with 2 options; switch to text_response
    await selectType(user, "文本作答题");
    await user.type(
      screen.getByPlaceholderText(CONTENT_PLACEHOLDER),
      "请阐述你的观点",
    );
    await user.type(
      screen.getByPlaceholderText(RUBRIC_PLACEHOLDER),
      "按逻辑给分",
    );

    await user.click(screen.getByText("保存"));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/api/questions",
        expect.objectContaining({
          type: "text_response",
          options: [],
          standardAnswer: null,
        }),
      );
    });
  });

  it("does not leak rubric into payload when switching text_response → objective type", async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByText("新增题目");

    // Set up a text_response with a rubric, then switch back to fill_blank.
    await selectType(user, "文本作答题");
    await user.type(
      screen.getByPlaceholderText(CONTENT_PLACEHOLDER),
      "____ 是元素符号",
    );
    await user.type(
      screen.getByPlaceholderText(RUBRIC_PLACEHOLDER),
      "主观评分依据",
    );
    await selectType(user, "填空题");
    // fill_blank canonical: objective, no rubric in payload
    await user.type(
      screen.getByPlaceholderText("输入标准答案，多个答案用 | 分隔"),
      "Fe",
    );

    await user.click(screen.getByText("保存"));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/api/questions",
        expect.objectContaining({ type: "fill_blank", rubric: null }),
      );
    });
  });
});
