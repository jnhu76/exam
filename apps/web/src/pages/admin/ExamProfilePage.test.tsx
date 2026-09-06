import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { ExamProfilePage } from "./ExamProfilePage";
import type { ExamProfileDTO } from "@exam/contracts";

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
  api: {
    get: vi.fn(),
    delete: vi.fn(),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/exam-profiles"]}>
      <AuthProvider>
        <Routes>
          <Route path="/admin/exam-profiles" element={<ExamProfilePage />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const standardProfile: ExamProfileDTO = {
  id: "p-std",
  organizationId: "00000000-0000-0000-0000-000000000001",
  name: "标准在线考试",
  description: "常规在线考试模板",
  timingMode: "timed_window" as const,
  durationMinutes: 60,
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

const basicProfile: ExamProfileDTO = {
  id: "p-basic",
  organizationId: "00000000-0000-0000-0000-000000000001",
  name: "基础测验",
  description: "",
  timingMode: "untimed" as const,
  durationMinutes: null,
  latestStartOffsetMinutes: null,
  minSubmitAfterStartMinutes: null,
  retakePolicy: "unlimited",
  maxAttempts: 1,
  scoreStrategy: "highest",
  resultPublicationMode: "immediate",
  interruptionTimePolicy: "strict",
  interruptionGracePerIncidentSeconds: null,
  interruptionGracePerAttemptSeconds: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ExamProfilePage (list)", () => {
  it("renders the loading state then the profile rows", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([standardProfile, basicProfile]);
    await act(async () => {
      renderPage();
    });
    // Row content renders twice by design (desktop table + mobile cards);
    // scope to the desktop table representation.
    const table = await screen.findByRole("table");
    expect(within(table).getByText("标准在线考试")).toBeInTheDocument();
    expect(within(table).getByText("基础测验")).toBeInTheDocument();
  });

  it("renders a human-readable summary, not raw enum codes", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([standardProfile]);
    await act(async () => {
      renderPage();
    });
    const table = await screen.findByRole("table");
    const row = within(table).getByText("标准在线考试");
    // Summary should contain human labels, not raw enum values.
    const summary = row.closest("tr")?.textContent ?? "";
    expect(summary).toContain("60");
    expect(summary).toContain("最多");
    expect(summary).not.toContain("max_attempts");
    expect(summary).not.toContain("bounded_grace");
  });

  it("shows the empty state when there are no profiles", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([]);
    await act(async () => {
      renderPage();
    });
    expect(await screen.findByText("暂无策略模板")).toBeInTheDocument();
  });

  it("shows COPY-ON-APPLY wording in the delete confirm dialog", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([standardProfile]);
    await act(async () => {
      renderPage();
    });
    const table = await screen.findByRole("table");
    const deleteBtn = within(table).getByRole("button", {
      name: "删除",
    });
    await userEvent.click(deleteBtn);
    const dialog = await screen.findByRole("alertdialog");
    // The COPY-ON-APPLY safety message MUST be present.
    expect(within(dialog).getByText(/删除此模板不会影响/)).toBeInTheDocument();
  });

  it("calls DELETE and reloads the list on confirm", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([standardProfile]);
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);
    // Second get call after reload:
    vi.mocked(api.get).mockResolvedValueOnce([]);
    await act(async () => {
      renderPage();
    });
    const table = await screen.findByRole("table");
    await userEvent.click(within(table).getByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认删除" }),
    );
    expect(api.delete).toHaveBeenCalledWith("/api/exam-profiles/p-std");
    // The list reloads after deletion (second GET on /api/exam-profiles) and
    // the emptied list renders.
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
      expect(api.get).toHaveBeenLastCalledWith("/api/exam-profiles");
    });
    expect(await screen.findByText("暂无策略模板")).toBeInTheDocument();
  });

  it("shows an error state when the list fails to load", async () => {
    // Reject with a non-Error object so the i18n fallback message is used.
    vi.mocked(api.get).mockRejectedValueOnce({});
    await act(async () => {
      renderPage();
    });
    expect(await screen.findByText("加载策略模板失败")).toBeInTheDocument();
  });
});
