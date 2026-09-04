import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { ProctorWorkspacePage } from "./ProctorWorkspacePage";

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly message: string;
    readonly code?: string;
    readonly details?: unknown;
    readonly requestId?: string;
    readonly serverMessage?: string;
    constructor(
      status: number,
      message: string,
      code?: string,
      details?: unknown,
      requestId?: string,
      serverMessage?: string,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.message = message;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
      this.serverMessage = serverMessage ?? message;
    }
  },
  api: { get: vi.fn() },
  setNavigate: () => {},
}));

const getMock = vi.mocked(api.get);
const exams = {
  items: [
    {
      examId: "00000000-0000-4000-8000-000000000001",
      title: "开放考试",
      status: "open",
      openAt: "2026-07-17T01:00:00.000Z",
      closeAt: "2026-07-17T03:00:00.000Z",
    },
    {
      examId: "00000000-0000-4000-8000-000000000002",
      title: "已关闭考试",
      status: "closed",
      openAt: "2026-07-16T01:00:00.000Z",
      closeAt: "2026-07-16T03:00:00.000Z",
    },
  ],
  total: 2,
};

function LocationProbe() {
  return <span data-testid="current-path">{useLocation().pathname}</span>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/proctor"]}>
      <Routes>
        <Route path="/admin/proctor" element={<ProctorWorkspacePage />} />
        <Route
          path="/admin/exams/:id/proctor/monitor"
          element={<LocationProbe />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProctorWorkspacePage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue(exams);
  });

  it("loads and renders discoverable exams from the Proctor API", async () => {
    renderPage();
    expect(await screen.findByText("开放考试")).toBeInTheDocument();
    expect(screen.getByText("已关闭考试")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith("/api/admin/proctor/exams");
  });

  it("filters the workspace by exam status", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("开放考试");

    await user.click(screen.getByRole("combobox", { name: "考试状态" }));
    await user.click(screen.getByRole("option", { name: "已关闭" }));

    expect(screen.queryByText("开放考试")).not.toBeInTheDocument();
    expect(screen.getByText("已关闭考试")).toBeInTheDocument();
  });

  it("enters the existing monitoring route with the selected examId", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("开放考试");

    await user.click(screen.getAllByRole("button", { name: "进入监考" })[0]!);
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/admin/exams/00000000-0000-4000-8000-000000000001/proctor/monitor",
    );
  });

  it("shows the formal empty state for an empty list", async () => {
    getMock.mockResolvedValue({ items: [], total: 0 });
    renderPage();
    expect(await screen.findByText("当前没有可监考的考试")).toBeInTheDocument();
    expect(
      screen.queryByText("页面将在后续任务中实现。"),
    ).not.toBeInTheDocument();
  });

  it("shows a retryable error state for 403 or load failure", async () => {
    getMock.mockRejectedValue(new Error("403"));
    renderPage();
    expect(await screen.findByText("加载监考考试失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
