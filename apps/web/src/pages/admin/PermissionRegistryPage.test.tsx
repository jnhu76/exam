import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { PermissionRegistryPage } from "./PermissionRegistryPage";
import { permissionsForRole } from "@exam/authz";
import type { PaginatedResponse } from "@exam/contracts";

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
    get: vi.fn(),
  },
  setNavigate: () => {},
}));

const getMock = vi.mocked(api.get);

/** A minimal registry projection (backend returns the exhaustive catalog). */
const registry = {
  permissions: [
    { key: "exam.publish", category: "exam" },
    { key: "user.role.assign", category: "user" },
    { key: "score.export", category: "score" },
  ],
  rolePresets: [
    {
      key: "Admin",
      label: "Admin",
      purpose: "superset",
      isSystem: true,
      assignable: true,
      loginAllowed: true,
      defaultScope: "organization",
      permissions: ["exam.publish", "user.role.assign", "score.export"],
      sensitivePermissions: ["user.role.assign"],
    },
    {
      key: "Teacher",
      label: "Teacher",
      purpose: "authoring",
      isSystem: true,
      assignable: true,
      loginAllowed: true,
      defaultScope: "course",
      permissions: ["exam.publish"],
      sensitivePermissions: [],
    },
    {
      key: "System",
      label: "System",
      purpose: "synthetic",
      isSystem: true,
      assignable: false,
      loginAllowed: false,
      defaultScope: "system",
      permissions: ["system.auto_submit"],
      sensitivePermissions: [],
    },
  ],
};

/** Staff-list projection consumed by the picker (subset of the API item). */
interface StaffUser {
  id: string;
  username: string;
  name: string;
}

/** Matches the page's directory page size — pinned by the exact-URL mocks. */
const DIRECTORY_PAGE_SIZE = 20;

function staffItem(n: number): StaffUser {
  return {
    id: `u-${n}`,
    username: `staff${String(n).padStart(3, "0")}`,
    name: `员工${n}`,
  };
}

function directoryPage(
  page: number,
  items: StaffUser[],
  total: number,
): PaginatedResponse<StaffUser> {
  return {
    items,
    total,
    page,
    pageSize: DIRECTORY_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE)),
  };
}

function authorityFor(user: StaffUser) {
  return {
    user: { id: user.id, name: user.name, username: user.username },
    authority: {
      ok: true,
      authority: {
        primaryRole: "Teacher",
        activeRoles: ["Teacher"],
        capabilities: ["exam.publish"],
        assignmentIds: ["a-1"],
      },
    },
    assignments: [
      {
        id: "a-1",
        role: "Teacher",
        isPrimary: true,
        isActive: true,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
  };
}

const alice = staffItem(1);

/**
 * Exact path+query route table: ONLY the listed URLs resolve; ANY other GET
 * rejects with a 404 ApiError, mirroring the real API for unknown routes. A
 * regression that requests the wrong URL (e.g. the historical
 * /api/admin/users?pageSize=100 404 path) therefore FAILS here instead of
 * silently succeeding against a loose `path.includes("/users")` match.
 */
type RouteTable = Record<string, unknown>;
let routes: RouteTable;

function installRoutes(table: RouteTable) {
  routes = table;
  getMock.mockImplementation((path: string) => {
    if (path in routes) return Promise.resolve(routes[path]);
    return Promise.reject(
      new ApiError(404, `unrouted GET ${path}`, "NOT_FOUND"),
    );
  });
}

/**
 * Deferred route table for request-ownership tests: each GET returns a held
 * promise; the test resolves them in an explicit order.
 */
interface DeferredGet {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

function installDeferredRoutes(
  immediate: RouteTable,
): Map<string, DeferredGet[]> {
  const deferredByPath = new Map<string, DeferredGet[]>();
  getMock.mockImplementation((path: string) => {
    if (path in immediate) return Promise.resolve(immediate[path]);
    let queue = deferredByPath.get(path);
    if (!queue) {
      queue = [];
      deferredByPath.set(path, queue);
    }
    let resolve!: (value: unknown) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    queue.push({ promise, resolve, reject });
    return promise;
  });
  return deferredByPath;
}

/** Default routes: registry + a one-user first directory page + authority. */
function installDefaultRoutes() {
  installRoutes({
    "/api/admin/permission-registry": registry,
    "/api/users?page=1&pageSize=20": directoryPage(1, [alice], 1),
    "/api/admin/users/u-1/effective-authority": authorityFor(alice),
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider
        initialUser={{
          id: "admin-1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
          capabilities: [...permissionsForRole("Admin")],
        }}
      >
        <BrandProvider>
          <PermissionRegistryPage />
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function openUserPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("combobox", { name: /选择员工用户/ }),
  );
}

describe("PermissionRegistryPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    installDefaultRoutes();
  });

  it("renders the permission catalog grouped by category", async () => {
    renderPage();
    // Each permission key appears in BOTH the catalog card and the matrix row.
    expect(
      (await screen.findAllByText("exam.publish")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText("user.role.assign").length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("score.export").length).toBeGreaterThanOrEqual(
      1,
    );
    // Category grouping headings render from i18n (catalog card + matrix header).
    expect(screen.getAllByText("考试生命周期").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("renders the role matrix over assignable presets only", async () => {
    renderPage();
    await screen.findAllByText("exam.publish");
    // Assignable roles are columns (Teacher shown); System is NOT assignable
    // and must not be a column.
    expect(screen.getByText("教师")).toBeInTheDocument();
    expect(screen.queryByText("系统")).toBeNull();
  });

  it("loads the staff directory from the exact paginated /api/users contract", async () => {
    const user = userEvent.setup();
    renderPage();

    await openUserPicker(user);
    expect(
      await screen.findByRole("option", { name: "员工1" }),
    ).toBeInTheDocument();

    expect(getMock).toHaveBeenCalledWith("/api/users?page=1&pageSize=20");
  });

  it("renders effective authority and its assignments for a selected user", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("exam.publish");

    await openUserPicker(user);
    await user.click(await screen.findByRole("option", { name: "员工1" }));

    // The primary role badge + assignment row role are both "Teacher".
    expect(
      (await screen.findAllByText("Teacher")).length,
    ).toBeGreaterThanOrEqual(1);
    // The capability chip carries the derived capability key.
    expect(screen.getAllByText("exam.publish").length).toBeGreaterThanOrEqual(
      1,
    );
    // The capability list carries the eligibility-vs-resource-reach caveat.
    expect(screen.getByText(/scope assignment/)).toBeInTheDocument();
    // The assignment is displayed alongside, not as a per-capability source.
    expect(screen.getByText("主角色")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(
      "/api/admin/users/u-1/effective-authority",
    );
  });

  it("shows an empty state when the staff directory has no staff users", async () => {
    installRoutes({
      "/api/admin/permission-registry": registry,
      "/api/users?page=1&pageSize=20": directoryPage(1, [], 0),
    });
    renderPage();
    await screen.findAllByText("exam.publish");

    expect(await screen.findByText("暂无员工用户")).toBeInTheDocument();
    // An empty directory offers no picker.
    expect(screen.queryByRole("combobox", { name: /选择员工用户/ })).toBeNull();
  });

  it("surfaces directory failure with retry and keeps the registry usable", async () => {
    const user = userEvent.setup();
    // No /api/users route: the directory request 404s while the registry route
    // still resolves — the two sections fail and load independently.
    installRoutes({
      "/api/admin/permission-registry": registry,
      "/api/admin/users/u-1/effective-authority": authorityFor(alice),
    });
    renderPage();
    await screen.findAllByText("exam.publish");

    // Directory failure is VISIBLE (no silent empty picker).
    expect(await screen.findByText("加载员工目录失败")).toBeInTheDocument();
    // The already-loaded catalog + matrix remain usable.
    expect(screen.getAllByText("exam.publish").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText("教师")).toBeInTheDocument();

    // Retry recovers the directory and the picker becomes usable.
    routes["/api/users?page=1&pageSize=20"] = directoryPage(1, [alice], 1);
    await user.click(screen.getByRole("button", { name: "重试" }));
    await openUserPicker(user);
    expect(
      await screen.findByRole("option", { name: "员工1" }),
    ).toBeInTheDocument();
  });

  it("selects a staff user beyond the first page (pagination boundary)", async () => {
    const user = userEvent.setup();
    const firstPage = Array.from({ length: 20 }, (_, i) => staffItem(i + 1));
    const user101 = staffItem(101);
    installRoutes({
      "/api/admin/permission-registry": registry,
      "/api/users?page=1&pageSize=20": directoryPage(1, firstPage, 101),
      ...Object.fromEntries(
        [2, 3, 4, 5].map((page) => [
          `/api/users?page=${page}&pageSize=20`,
          directoryPage(page, [staffItem((page - 1) * 20 + 1)], 101),
        ]),
      ),
      "/api/users?page=6&pageSize=20": directoryPage(6, [user101], 101),
      "/api/admin/users/u-101/effective-authority": authorityFor(user101),
    });
    renderPage();
    await screen.findAllByText("exam.publish");

    // 101 staff over a 20-per-page directory → real pagination controls.
    expect(
      await screen.findByRole("button", { name: "下一页" }),
    ).toBeInTheDocument();
    for (let page = 2; page <= 6; page++) {
      await user.click(screen.getByRole("button", { name: "下一页" }));
      // aria-current moves only when the NEXT page's response has landed.
      await waitFor(() => {
        expect(
          screen.getByRole("link", { name: `第 ${page} 页` }),
        ).toHaveAttribute("aria-current", "page");
      });
    }
    expect(getMock).toHaveBeenCalledWith("/api/users?page=6&pageSize=20");

    // The 101st staff member is reachable and inspectable.
    await openUserPicker(user);
    await user.click(await screen.findByRole("option", { name: "员工101" }));
    expect(
      (await screen.findAllByText("Teacher")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(getMock).toHaveBeenCalledWith(
      "/api/admin/users/u-101/effective-authority",
    );
  });

  it("lands directory pages by request ownership, not resolution order", async () => {
    const user = userEvent.setup();
    const pageOneUsers = [staffItem(1), staffItem(2)];
    const newestPageTwo = [staffItem(21), staffItem(22)];
    const stalePageTwo = [staffItem(99)];
    const deferreds = installDeferredRoutes({
      "/api/admin/permission-registry": registry,
    });

    renderPage();

    // Initial page-1 request is in flight.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const initial = deferreds.get("/api/users?page=1&pageSize=20")?.[0];
    expect(initial).toBeDefined();
    await act(async () => {
      initial?.resolve(directoryPage(1, pageOneUsers, 41));
      await Promise.resolve();
      await Promise.resolve();
    });

    await openUserPicker(user);
    expect(
      await screen.findByRole("option", { name: "员工1" }),
    ).toBeInTheDocument();
    // Close the dropdown (Radix hides outside content while open) before
    // driving the pagination controls.
    await user.keyboard("{Escape}");

    // Two rapid NEXT clicks put TWO page-2 requests in flight before the
    // first lands (usersPage stays 1 until a response lands).
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await user.click(screen.getByRole("button", { name: "下一页" }));
    const queue2 = deferreds.get("/api/users?page=2&pageSize=20") ?? [];
    expect(queue2.length).toBe(2);

    // The NEWEST request lands first and owns the visible page...
    await act(async () => {
      queue2[1]?.resolve(directoryPage(2, newestPageTwo, 41));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "第 2 页" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    // ...then the STALE first request resolves LAST and must be discarded
    // wholesale: its items may not reach the picker.
    await act(async () => {
      queue2[0]?.resolve(directoryPage(2, stalePageTwo, 41));
      await Promise.resolve();
      await Promise.resolve();
    });

    await openUserPicker(user);
    expect(
      await screen.findByRole("option", { name: "员工21" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "员工99" })).toBeNull();
  });

  it("keeps the selected user's authority panel across directory page flips", async () => {
    const user = userEvent.setup();
    const pageOneUsers = [alice, staffItem(2)];
    const pageTwoUsers = [staffItem(21)];
    installRoutes({
      "/api/admin/permission-registry": registry,
      "/api/users?page=1&pageSize=20": directoryPage(1, pageOneUsers, 41),
      "/api/users?page=2&pageSize=20": directoryPage(2, pageTwoUsers, 41),
      "/api/admin/users/u-1/effective-authority": authorityFor(alice),
    });
    renderPage();
    await screen.findAllByText("exam.publish");

    await openUserPicker(user);
    await user.click(await screen.findByRole("option", { name: "员工1" }));
    expect(
      (await screen.findAllByText("Teacher")).length,
    ).toBeGreaterThanOrEqual(1);

    // Flipping the directory page must NOT clobber the inspector state or
    // re-issue the authority request for the unchanged selection.
    const authorityCallsBefore = getMock.mock.calls.filter(
      ([path]) => path === "/api/admin/users/u-1/effective-authority",
    ).length;
    await user.click(screen.getByRole("button", { name: "下一页" }));
    // The flip landed: page 2's usersPage state moved the aria-current marker.
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "第 2 页" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    // The inspector panel still describes 员工1, and no authority request was
    // re-issued for the unchanged selection.
    expect(screen.getAllByText("Teacher").length).toBeGreaterThanOrEqual(1);
    const authorityCallsAfter = getMock.mock.calls.filter(
      ([path]) => path === "/api/admin/users/u-1/effective-authority",
    ).length;
    expect(authorityCallsAfter).toBe(authorityCallsBefore);

    // The picker now lists page 2.
    await openUserPicker(user);
    expect(
      await screen.findByRole("option", { name: "员工21" }),
    ).toBeInTheDocument();
  });
});
