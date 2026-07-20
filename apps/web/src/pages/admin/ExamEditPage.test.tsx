import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { toast } from "sonner";
import { ExamEditPage } from "./ExamEditPage";
import { permissionsForRole } from "@exam/authz";

const { apiGet, apiPatch } = vi.hoisted(() => {
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
  const mockExam = {
    id: "exam-1",
    title: "期末测评",
    description: "desc",
    courseId: "c1",
    status: "draft",
    durationMinutes: 60,
    openAt: new Date().toISOString(),
    closeAt: new Date(Date.now() + 86400000).toISOString(),
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
  };
  return {
    apiGet: vi.fn().mockImplementation((path: string) => {
      if (path.includes("/api/courses"))
        return Promise.resolve({ items: mockCourses, total: 1 });
      if (path.includes("/api/questions"))
        return Promise.resolve({ items: mockQuestions, total: 1 });
      if (path.includes("/api/exams/exam-1")) return Promise.resolve(mockExam);
      return Promise.resolve({});
    }),
    apiPatch: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("@/lib/api", () => ({
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
          <Routes>
            <Route path="/admin/exams/:id/edit" element={<ExamEditPage />} />
            <Route
              path="/admin/exams/:id"
              element={<div data-testid="exam-detail" />}
            />
          </Routes>
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
