import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { PermissionRegistryPage } from "./PermissionRegistryPage";
import { permissionsForRole } from "@exam/authz";

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

/**
 * F-04 / matrix-overlap fixture: the widest catalog capability key renders in
 * the matrix's first column, granted for the only assignable role — the exact
 * geometry the audit screenshots flagged (grant icon painted over the key).
 */
const registry = {
  permissions: [
    { key: "course.teacher_assignment.manage", category: "course" as const },
    { key: "exam.publish", category: "exam" as const },
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
      sensitivePermissions: [],
      permissions: ["course.teacher_assignment.manage"],
    },
    {
      key: "Teacher",
      label: "Teacher",
      purpose: "staff",
      isSystem: true,
      assignable: true,
      loginAllowed: true,
      defaultScope: "course",
      sensitivePermissions: [],
      permissions: [],
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/permissions"]}>
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

describe("PermissionRegistryPage role × capability matrix", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.includes("/permission-registry")) {
        return Promise.resolve(registry);
      }
      // The staff-directory read (W1's surface) is irrelevant here; reject so
      // a regression that lets it take the page down is visible.
      return Promise.reject(new Error("unexpected call: " + path));
    });
  });

  it("keeps the role × capability header relationship", async () => {
    renderPage();
    const matrix = await screen.findByRole("table", {
      name: "角色预设矩阵",
    });
    const headers = within(matrix).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "权限",
      "管理员",
      "教师",
    ]);
  });

  it("announces granted cells to assistive technology (decorative=false icon)", async () => {
    renderPage();
    const matrix = await screen.findByRole("table", {
      name: "角色预设矩阵",
    });

    // The granted state is the only signal the cell carries — it must be in
    // the accessibility tree, not swallowed by aria-hidden.
    const granted = within(matrix).getAllByRole("img", { name: "已授予" });
    expect(granted.length).toBeGreaterThan(0);

    // The ungranted state stays a readable text glyph in the same row — the
    // two states are distinguishable without color.
    const row = granted[0]!.closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("carries the nowrap overflow vocabulary on the capability-key cells", async () => {
    renderPage();
    const matrix = await screen.findByRole("table", {
      name: "角色预设矩阵",
    });

    // recipes.css clips a single-line cell ONLY when the cell declares
    // data-column-overflow — without the attribute the widest key paints
    // across the sticky boundary onto the grant column (audit screenshots).
    const keyCell = within(matrix)
      .getByText("course.teacher_assignment.manage")
      .closest("td")!;
    expect(keyCell).toHaveAttribute("data-column-overflow", "nowrap");
    expect(keyCell).toHaveAttribute("data-column-role", "matrix-key");
  });
});
