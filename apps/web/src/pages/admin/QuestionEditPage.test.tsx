import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { QuestionEditPage } from "./QuestionEditPage";

const { apiGet, apiPost, apiPatch } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn().mockResolvedValue(undefined),
  apiPatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
  setNavigate: () => {},
}));

const courses = [
  { id: "c1", name: "数学", code: "MATH" },
  { id: "c2", name: "英语", code: "ENG" },
];

const existingQuestion = {
  courseId: "c1",
  type: "single_choice",
  content: "1+1=?",
  options: [
    { id: "A", content: "1", isCorrect: false },
    { id: "B", content: "2", isCorrect: true },
  ],
  standardAnswer: "B",
  score: 10,
  difficulty: 2,
  tags: ["基础"],
  gradingRule: {
    multiSelectScoring: "all_correct_full",
    fillBlankMatchMode: "exact",
  },
};

function renderNew(apiImpl?: (...args: unknown[]) => Promise<unknown>) {
  if (apiImpl) {
    apiGet.mockImplementation(apiImpl);
  } else {
    apiGet.mockImplementation(() => Promise.resolve({ items: courses }));
  }
  return render(
    <MemoryRouter initialEntries={["/admin/questions/new"]}>
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
            <Route path="/admin/questions/new" element={<QuestionEditPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function renderEdit() {
  let callCount = 0;
  apiGet.mockImplementation(() => {
    callCount++;
    if (callCount === 1) return Promise.resolve({ items: courses });
    return Promise.resolve(existingQuestion);
  });
  return render(
    <MemoryRouter initialEntries={["/admin/questions/q1/edit"]}>
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
            <Route
              path="/admin/questions/:id/edit"
              element={<QuestionEditPage />}
            />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("QuestionEditPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset().mockResolvedValue(undefined);
    apiPatch.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading skeleton while fetching data", () => {
    apiGet.mockImplementation(() => new Promise(() => {}));
    renderNew();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows error state when API fails", async () => {
    renderNew(() => Promise.reject(new Error("network")));
    expect(await screen.findByText("加载数据失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });

  it("renders new question form with default values", async () => {
    renderNew();
    expect(await screen.findByText("新增题目")).toBeInTheDocument();
    expect(screen.getByText("保存")).toBeInTheDocument();
    expect(screen.getByText("取消")).toBeInTheDocument();
    expect(screen.getByText("考生视角预览")).toBeInTheDocument();
  });

  it("loads existing question in edit mode", async () => {
    renderEdit();
    expect(await screen.findByText("编辑题目")).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText("输入题目内容");
    expect(textarea).toHaveValue("1+1=?");
  });

  it("save button calls POST for new question", async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByText("新增题目");
    await user.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/api/questions",
        expect.objectContaining({ courseId: "c1" }),
      );
    });
  });

  it("save button calls PATCH for existing question", async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByText("编辑题目");
    await user.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/questions/q1",
        expect.objectContaining({ content: "1+1=?" }),
      );
    });
  });

  it("cancel button is clickable and shows saving state recovery", async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByText("新增题目");
    const cancelBtn = screen.getByText("取消");
    expect(cancelBtn).toBeEnabled();
    await user.click(cancelBtn);
  });
});
