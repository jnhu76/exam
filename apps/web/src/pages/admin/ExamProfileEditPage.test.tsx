import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { ExamProfileEditPage } from "./ExamProfileEditPage";
import type { ExamProfileDTO } from "@exam/contracts";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPage(path = "/admin/exam-profiles/new") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/admin/exam-profiles/new"
            element={<ExamProfileEditPage />}
          />
          <Route
            path="/admin/exam-profiles/:id/edit"
            element={<ExamProfileEditPage />}
          />
          <Route
            path="/admin/exam-profiles"
            element={<div>profile list</div>}
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const existing: ExamProfileDTO = {
  id: "p-1",
  organizationId: "00000000-0000-0000-0000-000000000001",
  name: "标准在线考试",
  description: "existing",
  durationMinutes: 90,
  latestStartOffsetMinutes: 20,
  minSubmitAfterStartMinutes: 5,
  retakePolicy: "max_attempts",
  maxAttempts: 3,
  scoreStrategy: "highest",
  resultPublicationMode: "after_grading",
  interruptionTimePolicy: "bounded_grace",
  interruptionGracePerIncidentSeconds: 200,
  interruptionGracePerAttemptSeconds: 400,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ExamProfileEditPage — create path", () => {
  it("renders the create title and an empty form", async () => {
    await act(async () => {
      renderPage();
    });
    expect(
      screen.getByRole("heading", { name: "新建策略模板" }),
    ).toBeInTheDocument();
    // Default duration is 60.
    expect(screen.getByLabelText("考试时长（分钟）")).toHaveValue(60);
  });

  it("requires a name and shows a field error", async () => {
    await act(async () => {
      renderPage();
    });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("请输入模板名称")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("creates a profile with explicit fields on save", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ ...existing, id: "new" });
    await act(async () => {
      renderPage();
    });
    await userEvent.type(screen.getByLabelText("模板名称"), "我的模板");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(api.post).toHaveBeenCalledWith(
      "/api/exam-profiles",
      expect.objectContaining({
        name: "我的模板",
        durationMinutes: 60,
        retakePolicy: "unlimited",
        resultPublicationMode: "immediate",
        interruptionTimePolicy: "strict",
        interruptionGracePerIncidentSeconds: null,
        interruptionGracePerAttemptSeconds: null,
      }),
    );
  });

  it("prefills from a starter recipe via the starter dialog", async () => {
    await act(async () => {
      renderPage();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "从起步模板创建" }),
    );
    const dialog = await screen.findByRole("dialog");
    // Two starter recipes present.
    expect(within(dialog).getByText("基础测验")).toBeInTheDocument();
    expect(within(dialog).getByText("标准在线考试")).toBeInTheDocument();
    // Pick standard online → duration prefilled to 60, retake max_attempts.
    const useButtons = within(dialog).getAllByRole("button", {
      name: "使用此模板",
    });
    await userEvent.click(useButtons[1]!);
    // After prefill, the bounded_grace caps inputs are visible.
    expect(screen.getByLabelText("每次中断补时上限（秒）")).toBeInTheDocument();
    expect(screen.getByLabelText("考试时长（分钟）")).toHaveValue(60);
  });

  it("maps a 409 duplicate-name server error to a friendly message", async () => {
    const err = new Error("409 RESOURCE_CONFLICT");
    vi.mocked(api.post).mockRejectedValueOnce(err);
    await act(async () => {
      renderPage();
    });
    await userEvent.type(screen.getByLabelText("模板名称"), "dup");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("同名策略模板已存在")).toBeInTheDocument();
  });
});

describe("ExamProfileEditPage — conditional fields", () => {
  it("hides maxAttempts when retakePolicy is not max_attempts", async () => {
    await act(async () => {
      renderPage();
    });
    // Default retakePolicy is unlimited → maxAttempts input absent.
    expect(screen.queryByLabelText("最大尝试次数")).not.toBeInTheDocument();
  });

  it("shows maxAttempts when retakePolicy becomes max_attempts", async () => {
    await act(async () => {
      renderPage();
    });
    // Open the retake policy select (Radix combobox).
    await userEvent.click(screen.getByRole("combobox", { name: "重考策略" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "限制次数" }),
    );
    expect(await screen.findByLabelText("最大尝试次数")).toBeInTheDocument();
  });

  it("hides grace caps when interruption policy is strict", async () => {
    await act(async () => {
      renderPage();
    });
    expect(
      screen.queryByLabelText("每次中断补时上限（秒）"),
    ).not.toBeInTheDocument();
  });

  it("shows grace caps when interruption policy becomes bounded_grace", async () => {
    await act(async () => {
      renderPage();
    });
    await userEvent.click(
      screen.getByRole("combobox", { name: "中断恢复策略" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "有限补时" }),
    );
    expect(
      await screen.findByLabelText("每次中断补时上限（秒）"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("累计中断补时上限（秒）")).toBeInTheDocument();
  });
});

describe("ExamProfileEditPage — edit path", () => {
  it("loads the existing profile into the form", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(existing);
    await act(async () => {
      renderPage("/admin/exam-profiles/p-1/edit");
    });
    expect(
      await screen.findByRole("heading", { name: "编辑策略模板" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("考试时长（分钟）")).toHaveValue(90);
    expect(screen.getByLabelText("模板名称")).toHaveValue("标准在线考试");
  });

  it("patches on save", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(existing);
    vi.mocked(api.patch).mockResolvedValueOnce(existing);
    await act(async () => {
      renderPage("/admin/exam-profiles/p-1/edit");
    });
    await screen.findByRole("heading", { name: "编辑策略模板" });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(api.patch).toHaveBeenCalledWith(
      "/api/exam-profiles/p-1",
      expect.objectContaining({ name: "标准在线考试", durationMinutes: 90 }),
    );
  });
});
