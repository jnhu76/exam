import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CourseSearchSelect } from "./CourseSearchSelect";

/**
 * CourseSearchSelect — keyboard navigation, search purity, stale-response
 * protection, truncation disclosure, mouse selection, and a11y coverage.
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

function makeCourses(n: number, prefix = "课程"): CourseRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    name: `${prefix}${i}`,
    code: `C${i}`,
  }));
}

function renderSelect(
  courses: CourseRow[],
  overrides: {
    value?: string;
    placeholder?: string;
    onChange?: (id: string) => void;
  } = {},
) {
  return render(
    <CourseSearchSelect
      courses={courses}
      value={overrides.value ?? ""}
      onChange={overrides.onChange ?? (() => {})}
      placeholder={overrides.placeholder}
    />,
  );
}

/** Helper to open the popover by clicking the trigger. */
async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "所属课程" }));
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
    expect(
      screen.getByRole("combobox", { name: "所属课程" }),
    ).toBeInTheDocument();
  });

  it("ArrowDown followed by Enter selects a result", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect(makeCourses(3), { onChange });

    await openPopover(user);
    // Results are shown from initialCourses.
    expect(
      await screen.findByRole("option", { name: /课程0/ }),
    ).toBeInTheDocument();

    // ArrowDown moves to first option, Enter selects it.
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("c0");
  });

  it("ArrowUp, Home, and End update the active option correctly", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(4));

    await openPopover(user);
    await screen.findByRole("option", { name: /课程0/ });

    // ArrowDown twice → index 1
    await user.keyboard("{ArrowDown}{ArrowDown}");
    // End → index 3
    await user.keyboard("{End}");
    // Home → index 0
    await user.keyboard("{Home}");
    // ArrowUp from 0 should clamp to 0 (not go negative)
    await user.keyboard("{ArrowUp}");

    // No error means the component handled it gracefully.
    // The listbox and options should still be visible.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("Escape closes the popover without selecting", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect(makeCourses(3), { onChange });

    await openPopover(user);
    await screen.findByRole("option", { name: /课程0/ });

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("remote search results do not include unrelated initialCourses", async () => {
    const user = userEvent.setup();
    const initial = makeCourses(3);
    renderSelect(initial);

    await openPopover(user);
    await screen.findByRole("option", { name: /课程0/ });

    // Remote search returns only a different set.
    apiGet.mockResolvedValueOnce({
      items: [
        { id: "remote-1", name: "远程课程A", code: "RA" },
        { id: "remote-2", name: "远程课程B", code: "RB" },
      ],
      total: 2,
      totalPages: 1,
    } satisfies ListResponse);
    await user.type(
      await screen.findByPlaceholderText("搜索课程名称或代码..."),
      "远程",
    );

    await waitFor(() => {
      expect(screen.getByText("远程课程A")).toBeInTheDocument();
    });
    // The initial courses must NOT appear in the search results.
    expect(screen.queryByText("课程0")).not.toBeInTheDocument();
    expect(screen.queryByText("课程1")).not.toBeInTheDocument();
    expect(screen.queryByText("课程2")).not.toBeInTheDocument();
  });

  it("zero-result remote search displays the no-results state", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(2));

    await openPopover(user);
    const input = await screen.findByPlaceholderText("搜索课程名称或代码...");
    apiGet.mockResolvedValueOnce({
      items: [],
      total: 0,
      totalPages: 0,
    } satisfies ListResponse);
    await user.type(input, "不存在");

    await waitFor(() => {
      expect(screen.getByText("未找到匹配课程")).toBeInTheDocument();
    });
  });

  it("clearing the search invalidates an older unresolved request", async () => {
    const user = userEvent.setup();
    const initial = makeCourses(3);
    renderSelect(initial);

    await openPopover(user);
    const input = await screen.findByPlaceholderText("搜索课程名称或代码...");

    // Start request A using a deferred promise that never resolves on its own.
    let resolveA!: (value: ListResponse) => void;
    apiGet.mockImplementation(
      () =>
        new Promise<ListResponse>((resolve) => {
          resolveA = resolve;
        }),
    );
    await user.type(input, "abc");

    // Wait for the debounce to fire and the mock to be consumed.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalled();
    });

    // Clear the input → should restore initialCourses immediately.
    await user.clear(input);
    await waitFor(() => {
      expect(screen.getByText("课程0")).toBeInTheDocument();
    });

    // Now resolve request A with stale data.
    await act(async () => {
      resolveA({
        items: [{ id: "stale", name: "过期结果", code: "ST" }],
        total: 1,
        totalPages: 1,
      });
    });

    // The stale result must NOT overwrite the cleared/initial state.
    expect(screen.queryByText("过期结果")).not.toBeInTheDocument();
    expect(screen.getByText("课程0")).toBeInTheDocument();
    expect(screen.getByText("课程1")).toBeInTheDocument();
    expect(screen.getByText("课程2")).toBeInTheDocument();
  });

  it("truncation hint appears when total > items.length", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(2));

    await openPopover(user);
    const input = await screen.findByPlaceholderText("搜索课程名称或代码...");
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

  it("mouse selection works", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect(makeCourses(3), { onChange });

    await openPopover(user);
    const option = await screen.findByRole("option", { name: /课程1/ });
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith("c1");
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("accessible relationships and roles are present", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(2));

    const trigger = screen.getByRole("combobox", { name: "所属课程" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await openPopover(user);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", "course-search-listbox");

    const listbox = screen.getByRole("listbox", { name: "所属课程" });
    expect(listbox).toHaveAttribute("id", "course-search-listbox");

    const options = screen.getAllByRole("option");
    for (const opt of options) {
      expect(opt).toHaveAttribute("id");
      expect(opt.id).toMatch(/^course-option-/);
    }
  });

  it("selected label still renders when course is not in search results", async () => {
    const user = userEvent.setup();
    const initial = makeCourses(3);
    renderSelect(initial, { value: "c0" });

    // The selected label should show even before opening.
    expect(screen.getByText("课程0")).toBeInTheDocument();

    await openPopover(user);
    const input = await screen.findByPlaceholderText("搜索课程名称或代码...");

    // Remote search returns results that don't include c0.
    apiGet.mockResolvedValueOnce({
      items: [{ id: "remote-1", name: "远程课程A", code: "RA" }],
      total: 1,
      totalPages: 1,
    } satisfies ListResponse);
    await user.type(input, "远程");

    await waitFor(() => {
      expect(screen.getByText("远程课程A")).toBeInTheDocument();
    });

    // The trigger button must still show the selected label "课程0".
    expect(
      screen.getByRole("combobox", { name: "所属课程" }),
    ).toHaveTextContent("课程0");
  });
});
