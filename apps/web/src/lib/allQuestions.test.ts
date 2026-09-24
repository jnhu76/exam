import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAllPickerQuestions } from "./allQuestions";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";

const apiGet = vi.mocked(api.get) as unknown as ReturnType<typeof vi.fn>;

function page(page: number, totalPages: number, ids: string[]) {
  return {
    items: ids.map((id) => ({
      id,
      type: "single_choice",
      content: id,
      score: 5,
    })),
    totalPages,
  };
}

describe("fetchAllPickerQuestions", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it("pages through the whole list when it exceeds the API's pageSize cap", async () => {
    apiGet
      .mockResolvedValueOnce(page(1, 3, ["a", "b"]))
      .mockResolvedValueOnce(page(2, 3, ["c"]))
      .mockResolvedValueOnce(page(3, 3, ["d", "e"]));

    const questions = await fetchAllPickerQuestions();
    expect(questions.map((q) => q.id)).toEqual(["a", "b", "c", "d", "e"]);
    const urls = apiGet.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      "/api/questions?page=1&pageSize=100",
      "/api/questions?page=2&pageSize=100",
      "/api/questions?page=3&pageSize=100",
    ]);
  });

  it("short-circuits to the first page alone", async () => {
    apiGet.mockResolvedValueOnce(page(1, 1, ["a"]));

    const questions = await fetchAllPickerQuestions();
    expect(questions.map((q) => q.id)).toEqual(["a"]);
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});
