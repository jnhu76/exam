import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { DateTimeProvider } from "@/contexts/DateTimeContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { toast } from "sonner";
import { ExamEditPage } from "./ExamEditPage";
import { permissionsForRole } from "@exam/authz";

/** Exam fixture schedule — fixed instants so TZ assertions are stable. */
const EXAM_OPEN_AT = "2026-11-20T01:00:30.000Z";
const EXAM_CLOSE_AT = "2026-11-20T03:00:00.000Z";

const { apiGet, apiPatch, state } = vi.hoisted(() => {
  const mockCourses = [{ id: "c1", name: "数学", code: "MATH101" }];
  const mockQuestions = [
    {
      id: "q1",
      type: "true_false",
      content: "2+2=4",
      score: 100,
      courseId: "c1",
      standardAnswer: true,
    },
  ];
  const state = {
    examStatus: "draft",
    openAt: "",
    closeAt: "" as string | null,
    orgTimeZone: "Asia/Shanghai",
    /** When true, /api/admin/settings hangs until the test resolves it. */
    holdSettings: false,
    resolveSettings: null as null | ((value: unknown) => void),
  };
  const mockExam = () => ({
    id: "exam-1",
    title: "期末测评",
    description: "desc",
    courseId: "c1",
    status: state.examStatus,
    durationMinutes: 60,
    openAt: state.openAt,
    closeAt: state.closeAt,
    passingScore: 60,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: ["q1"],
    controlFlags: {},
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 1,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
  });
  return {
    state,
    apiGet: vi.fn().mockImplementation((path: string) => {
      if (path.includes("/api/courses"))
        return Promise.resolve({ items: mockCourses, total: 1 });
      if (path.includes("/api/questions"))
        return Promise.resolve({ items: mockQuestions, total: 1 });
      if (path.includes("/api/exams/exam-1"))
        return Promise.resolve(mockExam());
      if (path.includes("/api/admin/settings")) {
        if (state.holdSettings) {
          return new Promise((resolve) => {
            state.resolveSettings = resolve;
          });
        }
        return Promise.resolve({ timezone: state.orgTimeZone });
      }
      return Promise.resolve({});
    }),
    apiPatch: vi.fn().mockResolvedValue({}),
  };
});

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
    get: (...args: unknown[]) => apiGet(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/exams/exam-1/edit"]}>
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
          <DateTimeProvider>
            <Routes>
              <Route path="/admin/exams/:id/edit" element={<ExamEditPage />} />
              <Route
                path="/admin/exams/:id"
                element={<div data-testid="exam-detail" />}
              />
            </Routes>
          </DateTimeProvider>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ExamEditPage", () => {
  beforeEach(() => {
    apiGet.mockClear();
    apiPatch.mockClear();
    apiPatch.mockResolvedValue({});
    state.examStatus = "draft";
    state.openAt = EXAM_OPEN_AT;
    state.closeAt = EXAM_CLOSE_AT;
    state.orgTimeZone = "Asia/Shanghai";
    state.holdSettings = false;
    state.resolveSettings = null;
  });

  it("prefills the form from the existing exam", async () => {
    renderPage();
    // The prefilled title appears in the form input.
    expect(await screen.findByDisplayValue("期末测评")).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/exams/exam-1");
  });

  it("PATCHes the exam on save and shows success toast", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByDisplayValue("期末测评");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/exams/exam-1",
        expect.objectContaining({ title: "期末测评" }),
      );
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("考试已更新");
    });
  });

  it("navigates to the exam detail page after a successful save", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByDisplayValue("期末测评");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(screen.getByTestId("exam-detail")).toBeInTheDocument();
    });
  });
});

describe("ExamEditPage — scheduling time zone (F-20)", () => {
  beforeEach(() => {
    apiGet.mockClear();
    apiPatch.mockClear();
    apiPatch.mockResolvedValue({});
    state.examStatus = "draft";
    state.openAt = EXAM_OPEN_AT;
    state.closeAt = EXAM_CLOSE_AT;
    state.orgTimeZone = "Asia/Shanghai";
    state.holdSettings = false;
    state.resolveSettings = null;
  });

  /** The two datetime-local inputs, in DOM order (openAt, closeAt). */
  function scheduleInputs(): HTMLInputElement[] {
    const inputs = document.querySelectorAll<HTMLInputElement>(
      "input[type='datetime-local']",
    );
    expect(inputs.length).toBe(2);
    return [inputs[0]!, inputs[1]!];
  }

  /** Renders and waits until the ORG scheduling zone is applied, so every
   * later conversion is known to use it (not the host fallback). */
  async function renderAndAwaitOrgZone(tzHint: string) {
    renderPage();
    await screen.findByDisplayValue("期末测评");
    await screen.findByText(tzHint);
  }

  it("prefills the schedule as the ORGANIZATION wall clock and labels the time zone", async () => {
    await renderAndAwaitOrgZone("以下时间按 Asia/Shanghai 时区填写与保存。");
    // 2026-11-20T01:00:30Z is 09:00 (with :30 seconds) in Asia/Shanghai —
    // the org zone, regardless of the browser's zone.
    expect(scheduleInputs()[0]).toHaveValue("2026-11-20T09:00");
    expect(scheduleInputs()[1]).toHaveValue("2026-11-20T11:00");
  });

  it("preserves the untouched original instant byte-for-byte (seconds included) on save", async () => {
    const user = userEvent.setup();
    await renderAndAwaitOrgZone("以下时间按 Asia/Shanghai 时区填写与保存。");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/exams/exam-1",
        expect.anything(),
      );
    });
    const payload = apiPatch.mock.calls[0]![1];
    expect(payload.openAt).toBe(EXAM_OPEN_AT);
    expect(payload.closeAt).toBe(EXAM_CLOSE_AT);
  });

  it("converts an edited wall clock through the org zone (10:00 Shanghai → 02:00Z)", async () => {
    const user = userEvent.setup();
    await renderAndAwaitOrgZone("以下时间按 Asia/Shanghai 时区填写与保存。");
    fireEvent.change(scheduleInputs()[0]!, {
      target: { value: "2026-11-20T10:00" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/exams/exam-1",
        expect.anything(),
      );
    });
    const payload = apiPatch.mock.calls[0]![1];
    expect(payload.openAt).toBe("2026-11-20T02:00:00.000Z");
    // Untouched closeAt keeps its original instant.
    expect(payload.closeAt).toBe(EXAM_CLOSE_AT);
  });

  it("preserves an untouched DST-overlap instant on its original side of the transition", async () => {
    // 2026-11-01T09:30:30Z is 01:30:30 PST — the SECOND occurrence of the
    // fall-back overlap hour in Los Angeles. Re-converting the wall clock
    // would silently move the exam to the first occurrence (08:30Z).
    state.orgTimeZone = "America/Los_Angeles";
    state.openAt = "2026-11-01T08:00:00.000Z";
    state.closeAt = "2026-11-01T09:30:30.000Z";
    const user = userEvent.setup();
    await renderAndAwaitOrgZone(
      "以下时间按 America/Los_Angeles 时区填写与保存。",
    );
    expect(scheduleInputs()[0]).toHaveValue("2026-11-01T01:00");
    expect(scheduleInputs()[1]).toHaveValue("2026-11-01T01:30");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/exams/exam-1",
        expect.anything(),
      );
    });
    const payload = apiPatch.mock.calls[0]![1];
    expect(payload.closeAt).toBe("2026-11-01T09:30:30.000Z");
    expect(payload.openAt).toBe("2026-11-01T08:00:00.000Z");
  });

  it("blocks an edited DST-overlap wall clock with a field hint", async () => {
    state.orgTimeZone = "America/Los_Angeles";
    const user = userEvent.setup();
    await renderAndAwaitOrgZone(
      "以下时间按 America/Los_Angeles 时区填写与保存。",
    );
    fireEvent.change(scheduleInputs()[1]!, {
      target: { value: "2026-11-01T01:30" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByText(
        "该时间在 America/Los_Angeles 的夏令时回拨中出现两次，无法唯一确定，请调整时间。",
      ),
    ).toBeInTheDocument();
    expect(apiPatch).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("keeps the published-exam schedule-only PATCH shape with preserved instants", async () => {
    state.examStatus = "published";
    const user = userEvent.setup();
    await renderAndAwaitOrgZone("以下时间按 Asia/Shanghai 时区填写与保存。");
    fireEvent.change(scheduleInputs()[1]!, {
      target: { value: "2026-11-20T12:00" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/exams/exam-1",
        expect.anything(),
      );
    });
    const payload = apiPatch.mock.calls[0]![1];
    expect(payload).toEqual({
      openAt: EXAM_OPEN_AT,
      closeAt: "2026-11-20T04:00:00.000Z",
    });
  });

  /** Resolves the held /api/admin/settings request once it is in flight. */
  async function resolveLateSettings(timeZone: string) {
    await waitFor(() => expect(state.resolveSettings).not.toBeNull());
    await act(async () => {
      state.resolveSettings!({ timezone: timeZone });
    });
  }

  it("opens the schedule only after the first settings read settles (exam detail first)", async () => {
    // The review acceptance order: GET /api/exams/:id lands BEFORE the
    // organization settings read. The schedule inputs must not open on the
    // fallback zone, because that zone would silently reinterpret whatever
    // the user typed once settings arrived.
    state.holdSettings = true;
    const user = userEvent.setup();
    renderPage();

    // The exam detail has been fetched (and resolved) while settings hang;
    // the form is not open yet, so no wall clock exists on a fallback zone.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith("/api/exams/exam-1");
    });
    await act(async () => {});
    expect(
      document.querySelectorAll("input[type='datetime-local']"),
    ).toHaveLength(0);
    expect(screen.queryByText(/以下时间按/)).not.toBeInTheDocument();

    await resolveLateSettings("Asia/Shanghai");
    expect(await screen.findByDisplayValue("期末测评")).toBeInTheDocument();
    await screen.findByText("以下时间按 Asia/Shanghai 时区填写与保存。");

    // The user sees the ORGANIZATION wall clock of the stored instants.
    expect(scheduleInputs()[0]).toHaveValue("2026-11-20T09:00");
    expect(scheduleInputs()[1]).toHaveValue("2026-11-20T11:00");

    // Untouched: the displayed 09:00 Shanghai is exactly 01:00:30Z.
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/exams/exam-1",
        expect.anything(),
      );
    });
    const payload = apiPatch.mock.calls[0]![1];
    expect(payload.openAt).toBe(EXAM_OPEN_AT);
    expect(payload.closeAt).toBe(EXAM_CLOSE_AT);
  });

  it("converts an edit made after late-arriving settings in the zone the user saw", async () => {
    state.holdSettings = true;
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith("/api/exams/exam-1");
    });
    await resolveLateSettings("Asia/Shanghai");
    expect(await screen.findByDisplayValue("期末测评")).toBeInTheDocument();
    await screen.findByText("以下时间按 Asia/Shanghai 时区填写与保存。");

    fireEvent.change(scheduleInputs()[0]!, {
      target: { value: "2026-11-20T10:00" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/exams/exam-1",
        expect.anything(),
      );
    });
    const payload = apiPatch.mock.calls[0]![1];
    // 10:00 in the zone the form session displayed (Shanghai) = 02:00Z.
    expect(payload.openAt).toBe("2026-11-20T02:00:00.000Z");
    expect(payload.closeAt).toBe(EXAM_CLOSE_AT);
  });

  it("keeps the open session's zone when settings refresh later (no silent re-fill)", async () => {
    const user = userEvent.setup();
    await renderAndAwaitOrgZone("以下时间按 Asia/Shanghai 时区填写与保存。");

    // A branding refresh re-reads settings under a DIFFERENT organization
    // zone. The already-open form session must keep its zone: the fields are
    // not re-filled and the payload is not reinterpreted.
    state.orgTimeZone = "America/Los_Angeles";
    await act(async () => {
      window.dispatchEvent(new Event("branding:refresh"));
    });

    expect(
      screen.getByText("以下时间按 Asia/Shanghai 时区填写与保存。"),
    ).toBeInTheDocument();
    expect(scheduleInputs()[0]).toHaveValue("2026-11-20T09:00");
    expect(scheduleInputs()[1]).toHaveValue("2026-11-20T11:00");

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/exams/exam-1",
        expect.anything(),
      );
    });
    const payload = apiPatch.mock.calls[0]![1];
    expect(payload.openAt).toBe(EXAM_OPEN_AT);
    expect(payload.closeAt).toBe(EXAM_CLOSE_AT);
  });
});
