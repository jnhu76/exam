import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CourseSearchSelect } from "./CourseSearchSelect";

/**
 * CourseSearchSelect — keyboard navigation, search purity, stale-response
 * protection, truncation disclosure, mouse selection, and a11y coverage.
 */

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

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
  await user.click(screen.getByRole("button", { name: "所属课程" }));
}

/** Find the combobox input (the search field, not the trigger button). */
function getComboboxInput(): HTMLElement {
  return screen.getByRole("combobox");
}

describe("CourseSearchSelect", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("the trigger exposes a stable accessible name", () => {
    renderSelect(makeCourses(2));
    expect(
      screen.getByRole("button", { name: "所属课程" }),
    ).toBeInTheDocument();
  });

  it("ArrowDown followed by Enter selects a result", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect(makeCourses(3), { onChange });

    await openPopover(user);
    expect(
      await screen.findByRole("option", { name: /课程0/ }),
    ).toBeInTheDocument();

    // ArrowDown moves to first option (index 0), Enter selects it.
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("c0");
  });

  it("ArrowUp, Home, and End update the active option correctly", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(4));

    await openPopover(user);
    await screen.findByRole("option", { name: /课程0/ });
    const input = getComboboxInput();

    // ArrowDown twice → index 1
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      expect.stringContaining("c1"),
    );

    // End → index 3
    await user.keyboard("{End}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      expect.stringContaining("c3"),
    );

    // Home → index 0
    await user.keyboard("{Home}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      expect.stringContaining("c0"),
    );

    // ArrowUp from 0 should clamp to 0 (not go negative)
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      expect.stringContaining("c0"),
    );
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
    await user.type(getComboboxInput(), "远程");

    await waitFor(() => {
      expect(screen.getByText("远程课程A")).toBeInTheDocument();
    });
    // The initial courses must NOT appear in the search results.
    expect(screen.queryByText("课程0")).not.toBeInTheDocument();
    expect(screen.queryByText("课程1")).not.toBeInTheDocument();
    expect(screen.queryByText("课程2")).not.toBeInTheDocument();
  });

  it("selected remote course label persists after popover closes", async () => {
    const user = userEvent.setup();
    const initial = makeCourses(3);

    // Use a stateful wrapper so value updates after onChange.
    function Wrapper() {
      const [val, setVal] = useState("");
      return (
        <>
          <CourseSearchSelect courses={initial} value={val} onChange={setVal} />
          <span data-testid="current-value">{val}</span>
        </>
      );
    }
    render(<Wrapper />);

    await openPopover(user);
    await screen.findByRole("option", { name: /课程0/ });

    // Remote search returns a course NOT in initialCourses.
    const remoteCourse = { id: "remote-99", name: "远程课程Z", code: "RZ" };
    apiGet.mockResolvedValueOnce({
      items: [remoteCourse],
      total: 1,
      totalPages: 1,
    } satisfies ListResponse);
    await user.type(getComboboxInput(), "远程");

    await waitFor(() => {
      expect(screen.getByText("远程课程Z")).toBeInTheDocument();
    });

    // Select the remote course.
    await user.click(screen.getByText("远程课程Z"));

    // Popover should close and trigger should show the remote course name.
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "所属课程" })).toHaveTextContent(
      "远程课程Z",
    );
    expect(screen.getByTestId("current-value")).toHaveTextContent("remote-99");

    // Re-open — the label should still be correct.
    await openPopover(user);
    expect(screen.getByRole("button", { name: "所属课程" })).toHaveTextContent(
      "远程课程Z",
    );
  });

  it("zero-result remote search displays the no-results state", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(2));

    await openPopover(user);
    apiGet.mockResolvedValueOnce({
      items: [],
      total: 0,
      totalPages: 0,
    } satisfies ListResponse);
    await user.type(getComboboxInput(), "不存在");

    await waitFor(() => {
      expect(screen.getByText("未找到匹配课程")).toBeInTheDocument();
    });
  });

  it("clearing the search invalidates an older unresolved request", async () => {
    const user = userEvent.setup();
    const initial = makeCourses(3);
    renderSelect(initial);

    await openPopover(user);
    const input = getComboboxInput();

    // Start request A using a deferred promise.
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

  it("Escape invalidates an older unresolved request", async () => {
    const user = userEvent.setup();
    const initial = makeCourses(3);
    renderSelect(initial);

    await openPopover(user);
    const input = getComboboxInput();

    // Start request A using a deferred promise.
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

    // Press Escape to close.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    // Resolve request A with stale data.
    await act(async () => {
      resolveA({
        items: [{ id: "stale", name: "过期结果", code: "ST" }],
        total: 1,
        totalPages: 1,
      });
    });

    // Re-open — must show initialCourses, not stale results.
    await openPopover(user);
    await waitFor(() => {
      expect(screen.getByText("课程0")).toBeInTheDocument();
    });
    expect(screen.queryByText("过期结果")).not.toBeInTheDocument();
  });

  it("truncation hint appears when total > items.length", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(2));

    await openPopover(user);
    apiGet.mockResolvedValueOnce({
      items: makeCourses(100),
      total: 120,
      totalPages: 2,
    } satisfies ListResponse);
    await user.type(getComboboxInput(), "课");

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

    await openPopover(user);
    const input = getComboboxInput();

    // The search input is the combobox with the ARIA attributes.
    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "true");

    const listbox = screen.getByRole("listbox", { name: "所属课程" });
    expect(input).toHaveAttribute("aria-controls", listbox.id);

    // The listbox ID must be unique (generated via useId).
    expect(listbox.id).toMatch(/^course-search-listbox-/);

    const options = screen.getAllByRole("option");
    for (const opt of options) {
      expect(opt).toHaveAttribute("id");
      expect(opt.id).toMatch(/-option-/);
    }

    // The trigger button should NOT have combobox role.
    const trigger = screen.getByRole("button", { name: "所属课程" });
    expect(trigger).not.toHaveAttribute("role", "combobox");
  });

  it("active option has visible highlight via data attribute", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(3));

    await openPopover(user);
    await screen.findByRole("option", { name: /课程0/ });

    // ArrowDown to first option — it should have data-active="true".
    await user.keyboard("{ArrowDown}");
    const firstOption = screen.getByRole("option", { name: /课程0/ });
    expect(firstOption).toHaveAttribute("data-active", "true");

    // ArrowDown to second option.
    await user.keyboard("{ArrowDown}");
    const secondOption = screen.getByRole("option", { name: /课程1/ });
    expect(secondOption).toHaveAttribute("data-active", "true");
    expect(firstOption).not.toHaveAttribute("data-active", "true");
  });
});
