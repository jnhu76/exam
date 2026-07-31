import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CourseSearchSelect } from "./CourseSearchSelect";

/**
 * CourseSearchSelect — search-path truncation disclosure + a11y label coverage.
 *
 * The component fetches `/api/courses?search=...&pageSize=100` (the contract
 * max). When more courses match than the page can hold, the dropdown must
 * surface a visible hint instead of silently hiding courses beyond the cap.
 * The trigger button also carries a stable accessible name so tests/screen
 * readers can target it by role+name rather than DOM order.
 */

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
  setNavigate: () => {},
}));

interface CourseRow {
  id: string;
  name: string;
  code: string;
}

interface ListResponse {
  items: CourseRow[];
  total: number;
  totalPages: number;
}

function makeCourses(n: number): CourseRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    name: `课程${i}`,
    code: `C${i}`,
  }));
}

function renderSelect(
  courses: CourseRow[],
  overrides: { value?: string; placeholder?: string } = {},
) {
  render(
    <CourseSearchSelect
      courses={courses}
      value={overrides.value ?? ""}
      onChange={() => {}}
      placeholder={overrides.placeholder}
    />,
  );
}

describe("CourseSearchSelect", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("the trigger exposes a stable accessible name (所属课程)", () => {
    renderSelect(makeCourses(2));
    // Two elements may look like comboboxes on the real form; the trigger
    // MUST be locatable by role+name, never by positional .first().
    expect(
      screen.getByRole("combobox", { name: "所属课程" }),
    ).toBeInTheDocument();
  });

  it("shows the truncation hint when more courses match than the page holds", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(2));

    await user.click(screen.getByRole("combobox", { name: "所属课程" }));
    const input = await screen.findByPlaceholderText("搜索课程名称或代码...");
    // 120 courses match a term, but only 100 fit on a page → truncated.
    apiGet.mockResolvedValueOnce({
      items: makeCourses(100),
      total: 120,
      totalPages: 2,
    } satisfies ListResponse);
    await user.type(input, "课");

    await waitFor(() => {
      expect(screen.getByText(/仅显示前 100 条匹配/)).toBeInTheDocument();
    });
  });

  it("hides the truncation hint when results fit within one page", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(2));

    await user.click(screen.getByRole("combobox", { name: "所属课程" }));
    const input = await screen.findByPlaceholderText("搜索课程名称或代码...");
    apiGet.mockResolvedValueOnce({
      items: makeCourses(5),
      total: 5,
      totalPages: 1,
    } satisfies ListResponse);
    await user.type(input, "课");

    // Wait for the search to resolve and the results to render.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalled();
    });
    await act(async () => {
      // Let any pending state settle.
    });
    expect(screen.queryByText(/仅显示前 100 条匹配/)).toBeNull();
  });
});
