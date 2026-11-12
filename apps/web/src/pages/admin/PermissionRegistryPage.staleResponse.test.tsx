import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  api: { get: vi.fn() },
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
  ],
};

const users = {
  items: [
    { id: "u-1", username: "alice", name: "Alice" },
    { id: "u-2", username: "bob", name: "Bob" },
  ],
};

/** Distinct inspector payloads: every fact below is unique to its user so a
 * cross-user render is unambiguous against the page's other sections. */
function authorityFor(
  id: string,
  name: string,
  username: string,
  role: string,
  capability: string,
) {
  return {
    user: { id, name, username },
    authority: {
      ok: true,
      authority: {
        primaryRole: role,
        activeRoles: [role],
        capabilities: [capability],
        assignmentIds: [`asg-${id}`],
      },
    },
    assignments: [
      {
        id: `asg-${id}`,
        role,
        isPrimary: true,
        isActive: true,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
  };
}

const authorityA = authorityFor(
  "u-1",
  "Alice",
  "alice",
  "Role-Of-Alice",
  "capability-of-alice",
);
const authorityB = authorityFor(
  "u-2",
  "Bob",
  "bob",
  "Role-Of-Bob",
  "capability-of-bob",
);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Deferred FIFO pinning the effective-authority settlement order
 * independently of the selection order — the freedom a slow response has on
 * the wire. Registry / users lookups settle immediately. */
const authorityDeferreds: Array<
  ReturnType<typeof deferred<Record<string, unknown>>>
> = [];

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

beforeEach(() => {
  getMock.mockReset();
  authorityDeferreds.length = 0;
  getMock.mockImplementation(async (path: string) => {
    const target = String(path);
    if (target.includes("/permission-registry")) return registry;
    if (target.includes("/effective-authority")) {
      const d = deferred<Record<string, unknown>>();
      authorityDeferreds.push(d);
      return d.promise;
    }
    if (target.includes("/users")) return users;
    throw new Error(`unexpected GET ${target}`);
  });
});

/**
 * Effective-authority response ownership: the inspector panel must render
 * the authority of the CURRENTLY selected user. setAuthority /
 * setAuthorityError / setAuthorityLoading previously accepted any
 * last-settled response, so a slow selection could land under a faster,
 * newer selection and describe a user the picker no longer names.
 */
describe("PermissionRegistryPage effective-authority ownership", () => {
  it("a superseded authority response landing last must not render under the newly selected user", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("exam.publish");

    // Select Alice — her authority request is held on the wire.
    await user.click(screen.getByRole("combobox", { name: /选择员工用户/ }));
    await user.click(await screen.findByRole("option", { name: "Alice" }));

    // Select Bob while Alice is still in flight: Alice is superseded.
    await user.click(screen.getByRole("combobox", { name: /选择员工用户/ }));
    await user.click(await screen.findByRole("option", { name: "Bob" }));

    // Bob settles first: the panel shows his authority.
    await act(async () => {
      authorityDeferreds[1]!.resolve(authorityB);
    });
    expect(
      (await screen.findAllByText("Role-Of-Bob")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("capability-of-bob")).toBeInTheDocument();

    // Superseded Alice settles LAST: her authority must be discarded — the
    // panel must keep describing the user the picker names.
    await act(async () => {
      authorityDeferreds[0]!.resolve(authorityA);
    });

    expect(screen.queryAllByText("Role-Of-Alice")).toHaveLength(0);
    expect(screen.queryByText("capability-of-alice")).not.toBeInTheDocument();
    expect(screen.getAllByText("Role-Of-Bob").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("capability-of-bob")).toBeInTheDocument();
  });

  it("a superseded authority request FAILING after the current one succeeded must not flip the panel to its error", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("exam.publish");

    await user.click(screen.getByRole("combobox", { name: /选择员工用户/ }));
    await user.click(await screen.findByRole("option", { name: "Alice" }));
    await user.click(screen.getByRole("combobox", { name: /选择员工用户/ }));
    await user.click(await screen.findByRole("option", { name: "Bob" }));

    // Bob succeeds; Alice then FAILS. The failure belongs to a request
    // nobody is waiting for — it must not own Bob's panel.
    await act(async () => {
      authorityDeferreds[1]!.resolve(authorityB);
    });
    expect(screen.getAllByText("Role-Of-Bob").length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      authorityDeferreds[0]!.reject(new Error("stale authority failed"));
    });

    expect(screen.queryByText("加载用户能力授予失败")).not.toBeInTheDocument();
    expect(screen.getAllByText("Role-Of-Bob").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("capability-of-bob")).toBeInTheDocument();
  });
});
