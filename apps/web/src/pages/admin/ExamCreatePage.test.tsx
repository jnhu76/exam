import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ExamCreatePage } from "./ExamCreatePage";
import { permissionsForRole } from "@exam/authz";
import type { ExamProfileDTO } from "@exam/contracts";

const mockCourses = [{ id: "c1", name: "数学", code: "MATH101" }];
const mockQuestions = [
  {
    id: "q1",
    type: "true_false",
    content: "2+2=4",
    score: 10,
    courseId: "c1",
    standardAnswer: true,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
  {
    id: "q2",
    type: "single_choice",
    content: "Capital of France?",
    score: 15,
    courseId: "c1",
    standardAnswer: "Paris",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
];

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function defaultApiGet(path: string): unknown {
  if (path.includes("/api/courses")) return { items: mockCourses, total: 1 };
  if (path.includes("/api/questions"))
    return { items: mockQuestions, total: 2 };
  if (path.includes("/api/exam-profiles")) return [] as ExamProfileDTO[];
  return {};
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/exams/new"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
          capabilities: [...permissionsForRole("Admin")],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/exams/new" element={<ExamCreatePage />} />
            <Route
              path="/admin/exams/:id"
              element={<div data-testid="exam-detail" />}
            />
            <Route
              path="/admin/exams"
              element={<div data-testid="exam-list" />}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation(defaultApiGet);
  apiPost.mockResolvedValue({ id: "exam-1" });
});

function fillTitle(value: string) {
  fireEvent.change(screen.getByPlaceholderText("请输入考试名称"), {
    target: { value },
  });
}

describe("ExamCreatePage wizard — step 1 (basic + profile)", () => {
  it("renders the wizard title and step 1 fields", async () => {
    renderPage();
    expect(await screen.findByText("创建考试")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入考试名称")).toBeInTheDocument();
    // Profile picker is present on step 1.
    expect(
      screen.getByRole("combobox", { name: "使用现有模板" }),
    ).toBeInTheDocument();
  });

  it("does NOT surface latent Phase-2 control flags anywhere in the wizard", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("创建考试");
    // Step 1, then step 2 (policy fields — where such flags would appear)…
    fillTitle("Flags Exam");
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    await screen.findByLabelText("考试时长（分钟）");
    // …then the review step, covering every conditional surface.
    for (let i = 0; i < 2; i++) {
      await user.click(screen.getByRole("button", { name: /下一步/ }));
    }
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "2026-09-01T09:00" },
    });
    fireEvent.change(screen.getByLabelText("结束时间"), {
      target: { value: "2026-09-01T11:00" },
    });
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    await screen.findByText("创建前检查");
    expect(screen.queryByText(/随机选题/)).not.toBeInTheDocument();
    expect(screen.queryByText(/排队入场/)).not.toBeInTheDocument();
    expect(screen.queryByText(/限制访问网络/)).not.toBeInTheDocument();
    expect(screen.queryByText(/要求锁定环境/)).not.toBeInTheDocument();
    expect(screen.queryByText(/打乱题目顺序/)).not.toBeInTheDocument();
    expect(screen.queryByText(/禁止复制粘贴/)).not.toBeInTheDocument();
  });

  it("blocks Next when title is empty and shows a field error", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("创建考试");
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    expect(await screen.findByText("请输入考试名称")).toBeInTheDocument();
    // Still on step 1.
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("profile select defaults to 不使用模板", async () => {
    renderPage();
    await screen.findByText("创建考试");
    // Profile select defaults to __none__ (不使用模板) — no interaction needed.
    expect(
      screen.getByRole("combobox", { name: "使用现有模板" }),
    ).toHaveTextContent("不使用模板");
  });
});

describe("ExamCreatePage wizard — step 3 (questions + scores)", () => {
  async function goToStep3(user: ReturnType<typeof userEvent.setup>) {
    renderPage();
    await screen.findByText("创建考试");
    fillTitle("Test Exam");
    // Step 1 → 2 (policy) → 3 (questions). Identify step 3 by its unique
    // question-picker button rather than the heading (which also appears in
    // the stepper).
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    await screen.findByRole("button", { name: "手动选题" });
  }

  it("opens the question picker dialog and adds a question", async () => {
    const user = userEvent.setup();
    await goToStep3(user);
    await user.click(screen.getByRole("button", { name: "手动选题" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("2+2=4")).toBeInTheDocument();
    const addButtons = within(dialog).getAllByRole("button", { name: "添加" });
    await user.click(addButtons[0]!);
    await waitFor(() => {
      expect(screen.getByText("已选题目 (1)")).toBeInTheDocument();
    });
  });

  it("removes a selected question", async () => {
    const user = userEvent.setup();
    await goToStep3(user);
    await user.click(screen.getByRole("button", { name: "手动选题" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getAllByRole("button", { name: "添加" })[0]!,
    );
    await user.click(within(dialog).getByRole("button", { name: "关闭" }));
    await waitFor(() =>
      expect(screen.getByText("已选题目 (1)")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "删除题目" }));
    await waitFor(() =>
      expect(screen.getByText("已选题目 (0)")).toBeInTheDocument(),
    );
  });

  it("auto-calculates totalScore from the selected questions (10 + 15 = 25)", async () => {
    const user = userEvent.setup();
    await goToStep3(user);
    await user.click(screen.getByRole("button", { name: "手动选题" }));
    const dialog = await screen.findByRole("dialog");
    // Add BOTH fixture questions (scores 10 and 15).
    const addButtons = within(dialog).getAllByRole("button", { name: "添加" });
    await user.click(addButtons[0]!);
    await user.click(addButtons[1]!);
    await user.click(within(dialog).getByRole("button", { name: "关闭" }));
    // Auto mode: the 总分 input shows the sum and the auto-calc hint appears.
    // (getByLabelText matches both the section title and the input — scope to
    // the input element.)
    await waitFor(() => {
      expect(screen.getByLabelText("总分", { selector: "input" })).toHaveValue(
        25,
      );
    });
    expect(screen.getByText("自动计算：25 分")).toBeInTheDocument();
  });
});

describe("ExamCreatePage wizard — no-profile create flow", () => {
  it("creates a draft exam via the review step (no profileId sent)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("创建考试");
    fillTitle("My Exam");
    // 1 → 2 → 3 → 4 (schedule), then fill the schedule, then 4 → 5.
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "2026-09-01T09:00" },
    });
    fireEvent.change(screen.getByLabelText("结束时间"), {
      target: { value: "2026-09-01T11:00" },
    });
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    await screen.findByText("创建前检查");
    await user.click(screen.getByRole("button", { name: "创建草稿" }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/api/exams",
        expect.not.objectContaining({ profileId: expect.anything() }),
      );
    });
    expect(apiPost).toHaveBeenCalledWith(
      "/api/exams",
      expect.objectContaining({ title: "My Exam" }),
    );
  });
});

describe("ExamCreatePage wizard — profile path", () => {
  const profile: ExamProfileDTO = {
    id: "p1",
    organizationId: "00000000-0000-0000-0000-000000000001",
    name: "标准在线考试",
    description: "",
    durationMinutes: 90,
    latestStartOffsetMinutes: 15,
    minSubmitAfterStartMinutes: 10,
    retakePolicy: "max_attempts",
    maxAttempts: 2,
    scoreStrategy: "highest",
    resultPublicationMode: "after_grading",
    interruptionTimePolicy: "bounded_grace",
    interruptionGracePerIncidentSeconds: 300,
    interruptionGracePerAttemptSeconds: 600,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };

  it("selecting a profile shows its values in step 2 and '已自定义' after override", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.includes("/api/exam-profiles")) return [profile];
      return defaultApiGet(path);
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("创建考试");
    fillTitle("Profiled Exam");
    // Select the profile.
    await user.click(screen.getByRole("combobox", { name: "使用现有模板" }));
    await user.click(
      await screen.findByRole("option", { name: "标准在线考试" }),
    );
    // COPY-ON-APPLY hint now visible.
    expect(
      screen.getAllByText(/选择模板后，模板中的设置将复制到本次考试/).length,
    ).toBeGreaterThan(0);
    // Go to step 2.
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    // Profile duration (90) shown; at least one field badge says 来自「标准在线考试」.
    const durationInput = screen.getByLabelText("考试时长（分钟）");
    expect(durationInput).toHaveValue(90);
    expect(screen.getAllByText("来自「标准在线考试」").length).toBeGreaterThan(
      0,
    );
    // Override duration → badge switches to 已自定义 for that field.
    fireEvent.change(durationInput, { target: { value: 45 } });
    expect(screen.getAllByText("已自定义").length).toBeGreaterThan(0);
    // 恢复模板值 button appears.
    expect(
      screen.getByRole("button", { name: "恢复模板值" }),
    ).toBeInTheDocument();
  });

  it("override is preserved as explicit value in the final POST payload", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.includes("/api/exam-profiles")) return [profile];
      return defaultApiGet(path);
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("创建考试");
    fillTitle("Profiled Exam 2");
    await user.click(screen.getByRole("combobox", { name: "使用现有模板" }));
    await user.click(
      await screen.findByRole("option", { name: "标准在线考试" }),
    );
    // Step 1 → 2.
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    // Override duration.
    fireEvent.change(screen.getByLabelText("考试时长（分钟）"), {
      target: { value: 120 },
    });
    // Override latestStartOffsetMinutes → explicit null (clear the field).
    fireEvent.change(screen.getByLabelText("最晚进入（开考后分钟）"), {
      target: { value: "" },
    });
    // Walk to review and create.
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole("button", { name: /下一步/ }));
    }
    // Fill schedule.
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "2026-09-01T09:00" },
    });
    fireEvent.change(screen.getByLabelText("结束时间"), {
      target: { value: "2026-09-01T11:00" },
    });
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    await screen.findByText("创建前检查");
    await user.click(screen.getByRole("button", { name: "创建草稿" }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/api/exams",
        expect.objectContaining({
          profileId: "p1",
          durationMinutes: 120,
          latestStartOffsetMinutes: null,
        }),
      );
    });
    // The NON-overridden profile fields (retakePolicy etc.) are NOT sent —
    // the backend applies the profile. Verify retakePolicy absent from payload.
    expect(apiPost).toHaveBeenCalledWith(
      "/api/exams",
      expect.not.objectContaining({ retakePolicy: expect.anything() }),
    );
  });

  it("reset-to-profile removes the override from the POST payload", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.includes("/api/exam-profiles")) return [profile];
      return defaultApiGet(path);
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("创建考试");
    fillTitle("Reset Exam");
    await user.click(screen.getByRole("combobox", { name: "使用现有模板" }));
    await user.click(
      await screen.findByRole("option", { name: "标准在线考试" }),
    );
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    fireEvent.change(screen.getByLabelText("考试时长（分钟）"), {
      target: { value: 45 },
    });
    // Reset.
    await user.click(screen.getByRole("button", { name: "恢复模板值" }));
    // Field reverted to profile value; at least one badge is from template.
    expect(screen.getByLabelText("考试时长（分钟）")).toHaveValue(90);
    expect(screen.getAllByText("来自「标准在线考试」").length).toBeGreaterThan(
      0,
    );
  });
});

describe("ExamCreatePage wizard — validation routing", () => {
  it("routes a server schedule error (openAt/closeAt) to step 4 with the inline error", async () => {
    const user = userEvent.setup();
    const serverMsg = "服务器校验：结束时间无效";
    apiPost.mockRejectedValueOnce(
      Object.assign(new Error(serverMsg), {
        details: {
          fields: [{ field: "closeAt", message: serverMsg, code: "X" }],
        },
      }),
    );
    renderPage();
    await screen.findByText("创建考试");
    fillTitle("Bad Schedule");
    // Walk to step 4 with a LOCALLY VALID schedule, so the local gate passes
    // and the POST is actually reached (this test proves server routing).
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole("button", { name: /下一步/ }));
    }
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "2026-09-01T09:00" },
    });
    fireEvent.change(screen.getByLabelText("结束时间"), {
      target: { value: "2026-09-01T11:00" },
    });
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    // On step 5 (review). Submit; the server rejects with a closeAt field error.
    await screen.findByText("创建前检查");
    await user.click(screen.getByRole("button", { name: "创建草稿" }));
    // The UI routes back to step 4 and renders the SERVER's inline field error
    // (distinct copy — it can only have come from the mocked rejection). It
    // appears both inline (FieldError) and in the global save-error banner.
    const serverErrors = await screen.findAllByText(serverMsg);
    expect(serverErrors.length).toBeGreaterThan(0);
    expect(screen.getByLabelText("开始时间")).toBeInTheDocument();
    // Step 5's review heading is gone (queryByRole — getByRole throws on absence).
    expect(
      screen.queryByRole("heading", { name: "创建前检查" }),
    ).not.toBeInTheDocument();
  });

  it("stepper future steps are disabled — forward validation cannot be bypassed", async () => {
    renderPage();
    await screen.findByText("创建考试");
    // On step 1, steps 2–5 are locked; only 下一步 advances.
    // (Stepper buttons expose an explicit aria-label with a number + label.)
    expect(screen.getByRole("button", { name: /5 检查并创建/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /2 考试策略/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /1 基本信息/ })).toBeEnabled();
  });

  it("fixed validation errors do not linger as ghosts after re-validation", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("创建考试");
    // Trigger the title-required error.
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    expect(await screen.findByText("请输入考试名称")).toBeInTheDocument();
    // Fix the title and advance — the error must be gone (we land on step 2).
    fillTitle("Fixed Title");
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    await screen.findByLabelText("考试时长（分钟）");
    expect(screen.queryByText("请输入考试名称")).not.toBeInTheDocument();
  });
});

describe("ExamCreatePage wizard — interruption policy override semantics", () => {
  it("switching a bounded_grace profile to strict atomically nulls both grace caps in the POST", async () => {
    const profile: ExamProfileDTO = {
      id: "p-grace",
      organizationId: "00000000-0000-0000-0000-000000000001",
      name: "宽限模板",
      description: "",
      durationMinutes: 90,
      latestStartOffsetMinutes: null,
      minSubmitAfterStartMinutes: null,
      retakePolicy: "unlimited",
      maxAttempts: 1,
      scoreStrategy: "highest",
      resultPublicationMode: "immediate",
      interruptionTimePolicy: "bounded_grace",
      interruptionGracePerIncidentSeconds: 300,
      interruptionGracePerAttemptSeconds: 600,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    };
    apiGet.mockImplementation((path: string) => {
      if (path.includes("/api/exam-profiles")) return [profile];
      return defaultApiGet(path);
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("创建考试");
    fillTitle("Strict Exam");
    await user.click(screen.getByRole("combobox", { name: "使用现有模板" }));
    await user.click(await screen.findByRole("option", { name: "宽限模板" }));
    // Step 1 → 2.
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    // Switch policy from bounded_grace to strict (不补时).
    await user.click(screen.getByRole("combobox", { name: "中断恢复策略" }));
    await user.click(await screen.findByRole("option", { name: "不补时" }));
    // Walk to review and create.
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole("button", { name: /下一步/ }));
    }
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "2026-09-01T09:00" },
    });
    fireEvent.change(screen.getByLabelText("结束时间"), {
      target: { value: "2026-09-01T11:00" },
    });
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    await screen.findByText("创建前检查");
    await user.click(screen.getByRole("button", { name: "创建草稿" }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/api/exams",
        expect.objectContaining({
          profileId: "p-grace",
          interruptionTimePolicy: "strict",
          interruptionGracePerIncidentSeconds: null,
          interruptionGracePerAttemptSeconds: null,
        }),
      );
    });
  });
});
