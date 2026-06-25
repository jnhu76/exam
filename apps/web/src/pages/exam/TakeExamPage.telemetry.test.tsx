import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { TakeExamPage } from "./TakeExamPage";

// The telemetry module is mocked so these tests assert that the PAGE calls
// the right events — they do not exercise the real buffer (that is covered by
// examTelemetry.test.ts).
const trackExamEvent = vi.fn();
const clearPendingForAttempt = vi.fn();
vi.mock("@/lib/examTelemetry", () => ({
  trackExamEvent: (...a: unknown[]) => trackExamEvent(...a),
  clearPendingForAttempt: (...a: unknown[]) => clearPendingForAttempt(...a),
}));

const { apiGet, apiPost, mockAttempt } = vi.hoisted(() => {
  const mockAttempt = {
    id: "att-1",
    examId: "exam-1",
    status: "in_progress",
    score: null,
    deadlineAt: new Date(Date.now() + 3600000).toISOString(),
    serverNow: new Date().toISOString(),
    questionSnapshot: [
      {
        originalQuestionId: "q1",
        type: "true_false",
        content: "地球是圆的",
        score: 10,
        options: null,
        standardAnswer: true,
      },
      {
        originalQuestionId: "q2",
        type: "true_false",
        content: "水是透明的",
        score: 15,
        options: null,
        standardAnswer: true,
      },
    ],
    answers: [],
    startedAt: new Date().toISOString(),
    submittedAt: null,
  };
  return {
    apiGet: vi.fn().mockResolvedValue(mockAttempt),
    apiPost: vi.fn().mockResolvedValue({
      ok: true,
      serverNow: new Date().toISOString(),
    }),
    mockAttempt,
  };
});

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

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/exam/exam-1/take/att-1"]}>
      <AuthProvider
        initialUser={{
          id: "c1",
          username: "candidate",
          name: "Candidate",
          role: "Candidate",
          organizationId: "org1",
        }}
      >
        <BrandProvider>
          <Routes>
            <Route
              path="/exam/:examId/take/:attemptId"
              element={<TakeExamPage />}
            />
            <Route path="/exam/:attemptId/result" element={<LocationProbe />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function namesCalled(): string[] {
  return trackExamEvent.mock.calls.map((c) => c[0] as string);
}

describe("TakeExamPage telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trackExamEvent.mockReset();
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({
      ...mockAttempt,
      serverNow: new Date().toISOString(),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits exam_page_loaded on successful mount", async () => {
    renderPage();
    await waitFor(() => expect(namesCalled()).toContain("exam_page_loaded"));
  });

  it("emits answer_autosave_failed when a save is rejected", async () => {
    // First answer POST (save) is rejected by the server.
    apiPost.mockResolvedValueOnce({
      accepted: false,
      reason: "DEADLINE_EXCEEDED",
      message: "deadline",
      serverVersion: 0,
    });
    renderPage();
    // Change an answer to trigger the debounced save.
    await screen.findByText("地球是圆的");
    const trueBtn = await screen.findByRole("radio", { name: /正确/ });
    await act(async () => {
      fireEvent.click(trueBtn);
    });
    // Save is debounced 1500ms; advance and wait for the failure event.
    await waitFor(
      () => expect(namesCalled()).toContain("answer_autosave_failed"),
      { timeout: 5000 },
    );
  });

  it("emits submit_failed when the submit POST throws", async () => {
    // The page fires submit as `void handleSubmit()` and rethrows inside, so
    // the rejected promise is unhandled. Attach a one-shot process-level
    // listener to consume it (vitest injects the Node `process` global even
    // under jsdom) so the run stays clean. The page's submit semantics are
    // intentionally unchanged.
    const swallow = () => {};
    // @ts-expect-error — process untyped in web tsconfig (see process.on above).
    process.on("unhandledRejection", swallow);
    apiPost.mockResolvedValue({
      accepted: true,
      serverVersion: 1,
    });
    renderPage();
    await screen.findByText("地球是圆的");
    // Open submit dialog.
    const submitBtn = await screen.findByTestId("take-submit-btn");
    await act(async () => {
      fireEvent.click(submitBtn);
    });
    // Make the submit POST reject.
    apiPost.mockRejectedValueOnce(new Error("submit boom"));
    const confirmBtn = await screen.findByTestId("confirm-submit-btn");
    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    await waitFor(() => expect(namesCalled()).toContain("submit_failed"), {
      timeout: 5000,
    });
    // submit_failed must be recorded at error level (dual-emit).
    const failedCall = trackExamEvent.mock.calls.find(
      (c) => c[0] === "submit_failed",
    )!;
    expect(failedCall[2]).toMatchObject({ level: "error" });
    // @ts-expect-error — process untyped in web tsconfig (see process.on above).
    process.off("unhandledRejection", swallow);
  });
});

describe("TakeExamPage browser-state listeners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trackExamEvent.mockReset();
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({
      ...mockAttempt,
      serverNow: new Date().toISOString(),
    });
    apiPost.mockResolvedValue({
      accepted: true,
      serverVersion: 1,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers online/offline/visibility listeners and removes them on unmount", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const docAddSpy = vi.spyOn(document, "addEventListener");
    const docRemoveSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderPage();
    await screen.findByText("地球是圆的");

    // The page registers offline/online on window and visibilitychange on document.
    expect(addSpy.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(["offline", "online"]),
    );
    expect(docAddSpy.mock.calls.map((c) => c[0])).toContain("visibilitychange");

    const offlineHandler = addSpy.mock.calls.find(
      (c) => c[0] === "offline",
    )![1];
    const visHandler = docAddSpy.mock.calls.find(
      (c) => c[0] === "visibilitychange",
    )![1];

    unmount();

    expect(removeSpy.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(["offline", "online"]),
    );
    expect(docRemoveSpy.mock.calls.map((c) => c[0])).toContain(
      "visibilitychange",
    );
    // The exact same handler references are removed (no leaked duplicates).
    expect(removeSpy.mock.calls.find((c) => c[0] === "offline")![1]).toBe(
      offlineHandler,
    );
    expect(
      docRemoveSpy.mock.calls.find((c) => c[0] === "visibilitychange")![1],
    ).toBe(visHandler);

    addSpy.mockRestore();
    removeSpy.mockRestore();
    docAddSpy.mockRestore();
    docRemoveSpy.mockRestore();
  });

  it("emits browser_offline then browser_online on connectivity changes", async () => {
    renderPage();
    await screen.findByText("地球是圆的");
    trackExamEvent.mockClear();

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(namesCalled()).toEqual(
      expect.arrayContaining(["browser_offline", "browser_online"]),
    );
  });

  it("records visibility transitions with a hidden duration, no restore spam", async () => {
    renderPage();
    await screen.findByText("地球是圆的");
    trackExamEvent.mockClear();

    // Hide the page -> visibility_lost.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(namesCalled().filter((n) => n === "visibility_lost")).toHaveLength(
      1,
    );

    // Restore -> exactly one visibility_restored carrying a durationMs.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const restored = trackExamEvent.mock.calls.filter(
      (c) => c[0] === "visibility_restored",
    );
    expect(restored).toHaveLength(1);
    expect(typeof restored[0]![1].durationMs).toBe("number");
    expect(restored[0]![1].durationMs).toBeGreaterThanOrEqual(0);
  });
});
