import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CourseSearchSelect } from "./CourseSearchSelect";

/**
 * CourseSearchSelect — keyboard navigation, search purity, stale-response
 * protection, truncation disclosure, mouse selection, and a11y coverage.
 *
 * The combobox interaction (active option, Arrow/Home/End navigation,
 * Enter-to-select, IME guard, ARIA wiring) is owned by cmdk; these tests
 * pin it through public ARIA contracts — roles, accessible names, and the
 * input's aria-activedescendant → option id reference — never cmdk-private
 * markers.
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
  return screen.getByRole("combobox", { name: "所属课程" });
}

/** Assert the input's aria-activedescendant points at the given option. */
function expectActiveOption(input: HTMLElement, option: HTMLElement) {
  expect(option.id).not.toBe("");
  expect(input).toHaveAttribute("aria-activedescendant", option.id);
}

/** Fire a keydown that the platform marks as belonging to an IME
 * composition (isComposing=true / legacy keyCode 229). */
function fireComposingKey(key: "Enter" | "Escape", target: HTMLElement) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "isComposing", { value: true });
  Object.defineProperty(event, "keyCode", { value: 229 });
  fireEvent(target, event);
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

  it("Enter selects the pre-highlighted first option; ArrowDown then Enter selects the next", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect(makeCourses(3), { onChange });

    await openPopover(user);
    await screen.findByRole("option", { name: /课程0/ });
    const input = getComboboxInput();

    // The list mounts with the first option active (highlight ≠ selection);
    // Enter activates it and writes the form value exactly once.
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("c0");
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    // Re-open: ArrowDown moves the active option to the second row.
    await openPopover(user);
    await screen.findByRole("option", { name: /课程0/ });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith("c1");
  });

  it("ArrowUp, Home, and End update the active option correctly", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(4));

    await openPopover(user);
    await screen.findByRole("option", { name: /课程0/ });
    const input = getComboboxInput();

    // On mount cmdk marks the first option as the active one (highlight,
    // not a form selection).
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /课程0/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    // ArrowDown twice → second option.
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expectActiveOption(input, screen.getByRole("option", { name: /课程2/ }));

    // End → last option.
    await user.keyboard("{End}");
    expectActiveOption(input, screen.getByRole("option", { name: /课程3/ }));

    // Home → first option.
    await user.keyboard("{Home}");
    expectActiveOption(input, screen.getByRole("option", { name: /课程0/ }));

    // ArrowUp from 0 should clamp to 0 (not go negative).
    await user.keyboard("{ArrowUp}");
    expectActiveOption(input, screen.getByRole("option", { name: /课程0/ }));
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

  it("server results that do not literally match the query are kept in full, in server order", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(3));

    await openPopover(user);
    await screen.findByRole("option", { name: /课程0/ });

    // The term never appears literally in any returned name: the server
    // decides hits and order, so the list must not be re-filtered, re-ranked,
    // or partially dropped by client-side literal matching.
    apiGet.mockResolvedValueOnce({
      items: [
        { id: "s1", name: "安全生产", code: "SA" },
        { id: "s2", name: "进阶实操", code: "SB" },
        { id: "s3", name: "考核认证", code: "SC" },
      ],
      total: 3,
      totalPages: 1,
    } satisfies ListResponse);
    await user.type(getComboboxInput(), "甲");

    await waitFor(() => {
      expect(screen.getByText("考核认证")).toBeInTheDocument();
    });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("安全生产");
    expect(options[1]).toHaveTextContent("进阶实操");
    expect(options[2]).toHaveTextContent("考核认证");
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

  it("zero-result search shows the no-results state and Enter selects nothing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect(makeCourses(2), { onChange });

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

    // Enter on an empty list must not select anything, close, or submit.
    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
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

  it("courses sharing a name are distinguished by id", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const sameName = [
      { id: "first", name: "同名课程", code: "X1" },
      { id: "second", name: "同名课程", code: "X2" },
    ];
    renderSelect(sameName, { onChange });

    await openPopover(user);
    const options = await screen.findAllByRole("option", {
      name: /同名课程/,
    });
    expect(options).toHaveLength(2);
    await user.click(options[1]!);

    expect(onChange).toHaveBeenCalledWith("second");
  });

  it("accessible relationships and roles are present", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(2));

    await openPopover(user);

    // The search input is the editable combobox, named after the field.
    const input = getComboboxInput();
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "true");

    // The listbox is labelled and referenced from the input by id.
    const listbox = screen.getByRole("listbox", { name: "所属课程" });
    expect(listbox.id).not.toBe("");
    expect(input).toHaveAttribute("aria-controls", listbox.id);

    // On mount the first option is the active one; after navigation the
    // input references the active option by its element id.
    expect(screen.getByRole("option", { name: /课程0/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{ArrowDown}");
    expectActiveOption(input, screen.getByRole("option", { name: /课程1/ }));

    // The trigger button should NOT have combobox role.
    const trigger = screen.getByRole("button", { name: "所属课程" });
    expect(trigger).not.toHaveAttribute("role", "combobox");
  });

  it("trigger aria-haspopup agrees with the popover it controls", async () => {
    const user = userEvent.setup();
    renderSelect(makeCourses(2));
    const trigger = screen.getByRole("button", { name: "所属课程" });

    await openPopover(user);
    // Radix owns the trigger wiring: it renders a dialog popup, so the token
    // must be the Radix default — not a hand-written "listbox" claim that
    // contradicts the role of the element aria-controls points at.
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    const popup = screen.getByRole("dialog");
    expect(popup.id).not.toBe("");
    expect(trigger).toHaveAttribute("aria-controls", popup.id);
  });
});

/** Deferred promise for controlling response order from the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CourseSearchSelect query ownership (controlled clock)", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // The repo fake-timer pattern (QuestionPage.queryState A12): drive events
  // with fireEvent — userEvent's internal waits deadlock on faked timers.

  const FAKE: Parameters<typeof vi.useFakeTimers>[0] = {
    toFake: ["setTimeout", "clearTimeout", "Date"],
  };

  /** Open the popover synchronously; returns the search input. */
  function openForOwnership(courses: CourseRow[] = makeCourses(3)) {
    renderSelect(courses);
    fireEvent.click(screen.getByRole("button", { name: "所属课程" }));
    expect(screen.getAllByRole("option").length).toBe(courses.length);
    return getComboboxInput();
  }

  /** Fire the pending debounced commit and let its effects settle. */
  async function advanceDebounce() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
  }

  /** Resolve a deferred search response and let the component apply it. */
  async function settle(
    handle: {
      promise: Promise<ListResponse>;
      resolve: (value: ListResponse) => void;
    },
    value: ListResponse,
  ) {
    await act(async () => {
      handle.resolve(value);
      await handle.promise;
    });
  }

  it("a response for an older query cannot land after a newer term is typed", async () => {
    vi.useFakeTimers(FAKE);
    const input = openForOwnership();

    // Query A is in flight.
    const staleA = deferred<ListResponse>();
    apiGet.mockImplementationOnce(() => staleA.promise);
    fireEvent.change(input, { target: { value: "甲" } });
    await advanceDebounce();
    expect(apiGet).toHaveBeenCalledTimes(1);

    // The user types B while A is still unresolved.
    const freshB = deferred<ListResponse>();
    apiGet.mockImplementationOnce(() => freshB.promise);
    fireEvent.change(input, { target: { value: "甲乙" } });

    // A resolves inside B's debounce window — it belongs to a superseded
    // query and must not update results, truncation, or loading.
    await settle(staleA, {
      items: [{ id: "stale-a", name: "旧查询结果", code: "OLD" }],
      total: 5,
      totalPages: 1,
    });
    expect(screen.queryByText("旧查询结果")).not.toBeInTheDocument();
    expect(screen.getByText("课程0")).toBeInTheDocument();
    expect(screen.queryByText(/仅显示前/)).not.toBeInTheDocument();

    // B fires after its debounce and its response is the one that applies.
    await advanceDebounce();
    expect(apiGet).toHaveBeenCalledTimes(2);
    await settle(freshB, {
      items: [{ id: "fresh-b", name: "新查询结果", code: "NEW" }],
      total: 1,
      totalPages: 1,
    });
    expect(screen.getByText("新查询结果")).toBeInTheDocument();
    expect(screen.queryByText("旧查询结果")).not.toBeInTheDocument();
    expect(screen.queryByText("课程0")).not.toBeInTheDocument();
  });

  it("when responses return in reverse order only the newest query updates state", async () => {
    vi.useFakeTimers(FAKE);
    const input = openForOwnership();

    const staleA = deferred<ListResponse>();
    apiGet.mockImplementationOnce(() => staleA.promise);
    fireEvent.change(input, { target: { value: "甲" } });
    await advanceDebounce();
    expect(apiGet).toHaveBeenCalledTimes(1);

    const freshB = deferred<ListResponse>();
    apiGet.mockImplementationOnce(() => freshB.promise);
    fireEvent.change(input, { target: { value: "甲乙" } });
    await advanceDebounce();
    expect(apiGet).toHaveBeenCalledTimes(2);

    // B resolves BEFORE A: B applies, and the later-arriving A is discarded.
    await settle(freshB, {
      items: [{ id: "fresh-b", name: "新查询结果", code: "NEW" }],
      total: 1,
      totalPages: 1,
    });
    expect(screen.getByText("新查询结果")).toBeInTheDocument();
    await settle(staleA, {
      items: [{ id: "stale-a", name: "旧查询结果", code: "OLD" }],
      total: 5,
      totalPages: 1,
    });
    expect(screen.getByText("新查询结果")).toBeInTheDocument();
    expect(screen.queryByText("旧查询结果")).not.toBeInTheDocument();
    expect(screen.queryByText(/仅显示前/)).not.toBeInTheDocument();
  });

  it("replacing the initial course list invalidates an in-flight search", async () => {
    vi.useFakeTimers(FAKE);
    const scopeA = makeCourses(3, "范围A");
    const { rerender } = render(
      <CourseSearchSelect courses={scopeA} value="" onChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "所属课程" }));
    expect(screen.getAllByRole("option").length).toBe(scopeA.length);
    const input = getComboboxInput();

    const stale = deferred<ListResponse>();
    apiGet.mockImplementationOnce(() => stale.promise);
    fireEvent.change(input, { target: { value: "a" } });
    await advanceDebounce();
    expect(apiGet).toHaveBeenCalledTimes(1);

    // The parent supplies a new initial list (scope change, e.g. the edit
    // page finishing its course load).
    const scopeB = makeCourses(2, "范围B");
    rerender(
      <CourseSearchSelect courses={scopeB} value="" onChange={() => {}} />,
    );
    expect(screen.getByText("范围B0")).toBeInTheDocument();

    // The response from the old scope must never land.
    await settle(stale, {
      items: [{ id: "stale", name: "旧范围结果", code: "OLD" }],
      total: 5,
      totalPages: 1,
    });
    expect(screen.queryByText("旧范围结果")).not.toBeInTheDocument();
    expect(screen.getByText("范围B0")).toBeInTheDocument();
    expect(screen.getByText("范围B1")).toBeInTheDocument();
    expect(screen.queryByText(/仅显示前/)).not.toBeInTheDocument();
  });

  it("a scope change during the debounce window cancels the pending search", async () => {
    vi.useFakeTimers(FAKE);
    const scopeA = makeCourses(3, "范围A");
    const { rerender } = render(
      <CourseSearchSelect courses={scopeA} value="" onChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "所属课程" }));
    const input = getComboboxInput();

    // Type a term, but leave the 300ms debounce pending — no request yet.
    fireEvent.change(input, { target: { value: "a" } });
    expect(apiGet).not.toHaveBeenCalled();

    // The parent supplies a new initial list before the commit is due.
    const scopeB = makeCourses(2, "范围B");
    rerender(
      <CourseSearchSelect courses={scopeB} value="" onChange={() => {}} />,
    );
    expect(screen.getByText("范围B0")).toBeInTheDocument();

    // The superseded term belongs to the old scope and must never be sent,
    // neither by the stale debounce nor by a late in-flight continuation.
    await advanceDebounce();
    expect(apiGet).not.toHaveBeenCalled();
    expect(getComboboxInput()).toHaveValue("");
    expect(screen.getByText("范围B0")).toBeInTheDocument();
    expect(screen.getByText("范围B1")).toBeInTheDocument();
  });

  it("a failed current query restores the initial list; a superseded failure changes nothing", async () => {
    vi.useFakeTimers(FAKE);
    const input = openForOwnership();

    // Part 1: the current query fails → fall back to the initial list.
    const failing = deferred<ListResponse>();
    apiGet.mockImplementationOnce(() => failing.promise);
    fireEvent.change(input, { target: { value: "甲" } });
    await advanceDebounce();
    expect(apiGet).toHaveBeenCalledTimes(1);
    await act(async () => {
      failing.reject(new Error("network down"));
      await failing.promise.catch(() => {});
    });
    expect(screen.getByText("课程0")).toBeInTheDocument();
    expect(screen.queryByText("新查询结果")).not.toBeInTheDocument();

    // Part 2: a newer query succeeds, then the OLDER query fails — the
    // failure must not clobber the newer results with the initial list.
    const staleA = deferred<ListResponse>();
    apiGet.mockImplementationOnce(() => staleA.promise);
    fireEvent.change(input, { target: { value: "甲乙" } });
    await advanceDebounce();
    expect(apiGet).toHaveBeenCalledTimes(2);

    const freshB = deferred<ListResponse>();
    apiGet.mockImplementationOnce(() => freshB.promise);
    fireEvent.change(input, { target: { value: "甲乙丙" } });
    await advanceDebounce();
    expect(apiGet).toHaveBeenCalledTimes(3);
    await settle(freshB, {
      items: [{ id: "fresh-b", name: "新查询结果", code: "NEW" }],
      total: 1,
      totalPages: 1,
    });
    expect(screen.getByText("新查询结果")).toBeInTheDocument();

    await act(async () => {
      staleA.reject(new Error("network down"));
      await staleA.promise.catch(() => {});
    });
    expect(screen.getByText("新查询结果")).toBeInTheDocument();
    expect(screen.queryByText("课程0")).not.toBeInTheDocument();
  });

  it("closing during the debounce window cancels the scheduled search", async () => {
    vi.useFakeTimers(FAKE);
    const input = openForOwnership();

    // Type a term whose debounced search has NOT fired yet, then close.
    fireEvent.change(input, { target: { value: "甲" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // The scheduled commit must never fire.
    await advanceDebounce();
    expect(apiGet).not.toHaveBeenCalled();

    // Re-opening shows the clean initial state.
    fireEvent.click(screen.getByRole("button", { name: "所属课程" }));
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getByRole("option", { name: /课程0/ })).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("Enter inside the debounce window selects nothing and keeps the pending search", async () => {
    vi.useFakeTimers(FAKE);
    const onChange = vi.fn();
    renderSelect(makeCourses(3), { onChange });
    fireEvent.click(screen.getByRole("button", { name: "所属课程" }));
    const input = getComboboxInput();

    // Type a fresh term and press Enter BEFORE the 300ms commit: the stale
    // list is still rendered, so Enter must be inert — no stale pre-highlight
    // selection, no close, and the pending debounced search stays scheduled.
    fireEvent.change(input, { target: { value: "甲" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    const response = deferred<ListResponse>();
    apiGet.mockImplementationOnce(() => response.promise);
    await advanceDebounce();
    expect(apiGet).toHaveBeenCalledTimes(1);

    // Once the current query settles, its results are selectable again.
    await settle(response, {
      items: [{ id: "fresh-1", name: "新词结果", code: "NEW" }],
      total: 1,
      totalPages: 1,
    });
    expect(screen.getByText("新词结果")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("fresh-1");
  });

  it("Enter while the current request is in flight selects nothing from the stale list", async () => {
    vi.useFakeTimers(FAKE);
    const onChange = vi.fn();
    renderSelect(makeCourses(3), { onChange });
    fireEvent.click(screen.getByRole("button", { name: "所属课程" }));
    const input = getComboboxInput();

    const response = deferred<ListResponse>();
    apiGet.mockImplementationOnce(() => response.promise);
    fireEvent.change(input, { target: { value: "甲" } });
    await advanceDebounce();
    expect(apiGet).toHaveBeenCalledTimes(1);

    // The initial list is still rendered while the request is unresolved;
    // Enter must not pick a stale option, close the popover, or invalidate
    // the in-flight query.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await settle(response, {
      items: [{ id: "fresh-1", name: "在途结果", code: "NEW" }],
      total: 1,
      totalPages: 1,
    });
    expect(screen.getByText("在途结果")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keys during IME composition are handed to the IME, not selection or dismissal", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect(makeCourses(3), { onChange });

    await openPopover(user);
    await screen.findByRole("option", { name: /课程0/ });
    const input = getComboboxInput();

    // Enter pressed while the IME is composing (keyCode 229 / isComposing):
    // it confirms the composition text and must not select the highlighted
    // option.
    fireComposingKey("Enter", input);
    expect(onChange).not.toHaveBeenCalled();

    // Escape while composing cancels the candidate panel — the popover must
    // stay open and nothing may be selected.
    fireComposingKey("Escape", input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    // After composition, Enter selects the highlighted option normally.
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("c0");
  });
});
