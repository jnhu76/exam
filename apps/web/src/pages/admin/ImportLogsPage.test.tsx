import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ImportLogsPage } from "./ImportLogsPage";
import { permissionsForRole } from "@exam/authz";
import type { ImportLogListResponse } from "@exam/contracts";

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

const mockLogs: ImportLogListResponse = {
  items: [
    {
      id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      type: "candidate",
      status: "partial",
      total: 20,
      createdCount: 18,
      updatedCount: 0,
      errors: 2,
      metadata: { filename: "candidates.csv" },
      errorsDetail: [{ row: 4, code: "DUPLICATE_USERNAME", message: "重复" }],
      createdAt: "2025-01-15T10:00:00.000Z",
    },
    {
      id: "3f2504e0-4f89-11d3-9a0c-0305e82c3302",
      type: "question",
      status: "completed",
      total: 5,
      createdCount: 5,
      updatedCount: 0,
      errors: 0,
      metadata: {},
      errorsDetail: null,
      createdAt: "2025-01-16T09:00:00.000Z",
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/import-logs"]}>
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
          <ImportLogsPage />
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ImportLogsPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue(mockLogs);
  });

  it("renders import log rows with type, status and counts", async () => {
    renderPage();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByText("考生导入").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("部分成功").length).toBeGreaterThan(0);
  });

  it("expands and collapses the import detail through a real toggle button bound to the detail region", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByRole("table");

    // The expansion control is a real, row-identifying button (keyboard/AT
    // reachable), not a mouse-only clickable row.
    const toggle = within(table).getByRole("button", {
      name: /考生导入/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const regionId = toggle.getAttribute("aria-controls");
    expect(regionId).toBeTruthy();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const region = screen.getByRole("region", { name: "导入详情" });
    expect(region).toHaveAttribute("id", regionId);
    // The expanded region carries the row's error detail payload.
    expect(within(region).getByText(/DUPLICATE_USERNAME/)).toBeInTheDocument();

    // Enter on the focused button collapses again (native button semantics).
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
