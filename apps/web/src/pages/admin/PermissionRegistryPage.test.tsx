import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { PermissionRegistryPage } from "./PermissionRegistryPage";
import { permissionsForRole } from "@exam/authz";

vi.mock("@/lib/api", () => ({
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

const users = {
  items: [{ id: "u-1", username: "alice", name: "Alice" }],
};

const authority = {
  user: { id: "u-1", name: "Alice", username: "alice" },
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

function mockApi() {
  getMock.mockImplementation((path: string) => {
    if (path.includes("/permission-registry")) return Promise.resolve(registry);
    if (path.includes("/effective-authority"))
      return Promise.resolve(authority);
    if (path.includes("/users")) return Promise.resolve(users);
    return Promise.resolve({});
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

describe("PermissionRegistryPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    mockApi();
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

  it("renders effective authority and its assignments for a selected user", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("exam.publish");

    await user.click(screen.getByRole("combobox", { name: /选择用户/ }));
    await user.click(await screen.findByRole("option", { name: "Alice" }));

    // The primary role badge + assignment row role are both "Teacher".
    expect(
      (await screen.findAllByText("Teacher")).length,
    ).toBeGreaterThanOrEqual(1);
    // The capability chip carries the derived capability key.
    expect(screen.getAllByText("exam.publish").length).toBeGreaterThanOrEqual(
      1,
    );
    // The assignment is the authoritative "why" source.
    expect(screen.getByText("主角色")).toBeInTheDocument();
  });
});
