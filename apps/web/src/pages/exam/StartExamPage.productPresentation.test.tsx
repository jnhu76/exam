import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ProductProjectionProvider } from "@/contexts/ProductProjectionContext";
import type { ProductProjection } from "@/lib/productProjection";
import { StartExamPage } from "./StartExamPage";
import { ApiError } from "@/lib/api";
import type { MeResponse } from "@exam/contracts";
import { permissionsForRole } from "@exam/authz";

/**
 * W3.2 counterexample (#678 / ADR-022 Phase 3): the candidate entry queue is
 * a PER-EXAM POLICY fact (frozen `controlFlags.requireQueue`) executed on
 * kernel admission paths — NOT a deployment capability surface. Under a
 * Minimal projection (`admission.queue` NOT enabled), a requireQueue exam
 * still drives the same durable queue join → wait → start flow (§4.1 kernel;
 * W3.1 preflight ruling: queue reconcile is candidate-self-service). The
 * projection must never suppress this policy-driven path.
 */

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  ApiError: class ApiError extends Error {
    readonly status: number;
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
      this.status = status;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
      this.serverMessage = serverMessage ?? message;
      this.name = "ApiError";
    }
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

const candidate: MeResponse = {
  id: "c1",
  username: "candidate",
  name: "Candidate",
  role: "Candidate",
  organizationId: "org1",
  capabilities: [...permissionsForRole("Candidate")],
};

const minimalProjection: ProductProjection = {
  revision: 1,
  presentation: "minimal",
  enabled: [
    "question.single_choice",
    "question.true_false",
    "question.text_response",
    "grading.manual",
    "admission.account",
    "result.publication",
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/exam/exam-1/start"]}>
      <AuthProvider initialUser={candidate}>
        <BrandProvider>
          <ProductProjectionProvider initialProjection={minimalProjection}>
            <Routes>
              <Route path="/exam/:examId/start" element={<StartExamPage />} />
              <Route path="/exam/:attemptId/take" element={<LocationProbe />} />
            </Routes>
          </ProductProjectionProvider>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

describe("candidate queue entry under a Minimal projection (#678 W3.2)", () => {
  it("keeps the requireQueue policy flow fully working without admission.queue", async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValueOnce({
      id: "exam-1",
      title: "排队考试",
      durationMinutes: 30,
      passingScore: 50,
      totalScore: 100,
      questionCount: 5,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: true,
        batchSize: 1,
        batchInterval: 60,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      maxAttempts: 1,
      currentAttempts: 0,
      canStartNewAttempt: true,
      availabilityStatus: "available",
      primaryAction: "start",
    });
    apiPost
      .mockResolvedValueOnce({
        status: "waiting",
        position: 2,
        waitCount: 1,
        estimatedWaitSeconds: 30,
      })
      .mockResolvedValueOnce({ status: "ready", position: 1 })
      .mockResolvedValueOnce({
        id: "att-9",
        status: "in_progress",
        examId: "exam-1",
      });

    renderPage();

    expect(await screen.findByText("排队考试")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始考试" }));

    // Policy-driven join fires regardless of the deployment projection.
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/attempts/exam-1/queue");
    });
    // The waiting panel (per-场 policy surface) renders while queued.
    expect(await screen.findByTestId("exam-queue-panel")).toBeInTheDocument();

    // The flow completes: queue ready → start → navigate to the attempt.
    await waitFor(
      () => {
        expect(screen.getByTestId("current-path")).toHaveTextContent(
          "/exam/att-9/take",
        );
      },
      { timeout: 4_000 },
    );
    expect(apiPost).toHaveBeenCalledWith("/api/attempts/exam-1/start");
  });
});
