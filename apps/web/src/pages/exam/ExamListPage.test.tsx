import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { ExamListPage } from "./ExamListPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
  },
}));

const getMock = vi.mocked(api.get);

describe("ExamListPage", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("opens the final attempt result from an ended exam", async () => {
    getMock.mockResolvedValue([
      {
        examId: "exam-1",
        title: "能力测验",
        durationMinutes: 60,
        passingScore: 6,
        totalScore: 10,
        openAt: "2026-05-01T00:00:00.000Z",
        closeAt: "2026-05-01T01:00:00.000Z",
        questionCount: 1,
        attemptCount: 1,
        maxAttempts: 1,
        finalScore: 10,
        finalPassed: true,
        finalAttemptId: "attempt-1",
        isAvailable: false,
        isEnded: true,
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/exam/list"]}>
        <Routes>
          <Route path="/exam/list" element={<ExamListPage />} />
          <Route
            path="/exam/:attemptId/result"
            element={<div>考试结果页</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "查看结果" }),
    );

    expect(screen.getByText("考试结果页")).toBeInTheDocument();
  });
});
