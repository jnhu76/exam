import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ExamPage } from "./ExamPage";

const apiGet = vi.fn().mockResolvedValue({
  items: [
    {
      id: "draft-exam",
      title: "Draft Exam",
      status: "draft",
      openAt: new Date().toISOString(),
      closeAt: new Date(Date.now() + 3600000).toISOString(),
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
      questionIds: ["q1"],
      participantCount: 0,
      canDelete: true,
      deleteDisabledReason: null,
    },
    {
      id: "published-exam",
      title: "Published Exam",
      status: "published",
      openAt: new Date().toISOString(),
      closeAt: new Date(Date.now() + 3600000).toISOString(),
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
      questionIds: ["q1"],
      participantCount: 2,
      canDelete: false,
      deleteDisabledReason: "仅草稿状态的考试允许删除",
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
});

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  setNavigate: () => {},
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/exams"]}>
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
            <Route path="/admin/exams" element={<ExamPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ExamPage", () => {
  it("shows delete only as enabled for draft exams", async () => {
    renderPage();

    expect(await screen.findByText("考试管理")).toBeInTheDocument();

    const deleteButtons = await screen.findAllByRole("button", {
      name: "删除考试",
    });
    expect(deleteButtons).toHaveLength(2);
    expect(deleteButtons[0]).toBeEnabled();
    expect(deleteButtons[1]).toBeDisabled();
  });
});
