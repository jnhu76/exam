import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthProvider } from "@/contexts/AuthContext";
import { DateTimeProvider } from "@/contexts/DateTimeContext";
import { createProductDateTimeFormatter } from "@/lib/dateTime";
import { permissionsForRole } from "@exam/authz";
import { InvitationsCard } from "./InvitationsCard";

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
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  setNavigate: () => {},
}));

const getMock = vi.mocked(api.get);

/**
 * The organization timezone must differ from the host timezone, otherwise the
 * "rendered through the product authority" assertion below could pass through
 * the browser fallback by coincidence.
 */
const HOST_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const ORG_TIME_ZONE =
  HOST_TIME_ZONE === "Asia/Tokyo" ? "America/New_York" : "Asia/Tokyo";

const EXPIRES_AT = "2026-01-15T00:00:00.000Z";

const invitation = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "teacher@example.org",
  role: "Teacher",
  status: "pending",
  createdBy: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: EXPIRES_AT,
  consumedAt: null,
  revokedAt: null,
};

const ROLES = [
  { key: "Teacher", label: "Teacher", purpose: "teaching" },
] as const;

function renderCard() {
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
        <DateTimeProvider>
          <InvitationsCard roles={[...ROLES]} />
        </DateTimeProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("InvitationsCard expiry column (#598)", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/admin/settings")) {
        return Promise.resolve({ timezone: ORG_TIME_ZONE });
      }
      return Promise.resolve({ items: [invitation], total: 1 });
    });
  });

  it("renders expiresAt through the date role and the product datetime authority", async () => {
    renderCard();

    const expected =
      createProductDateTimeFormatter(ORG_TIME_ZONE).formatDateTime(EXPIRES_AT);
    // 2026-01-15 09:00:00 in +09:00 — the product grammar, not a locale one.
    expect(expected).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    // The expiry cell declares the date semantic role (not `type`).
    const dateCells = await screen.findAllByText(expected);
    const dateCell = dateCells
      .map((node) => node.closest('[data-slot="table-cell"]'))
      .find((cell) => cell?.getAttribute("data-column-role") === "date");
    expect(dateCell).toBeTruthy();

    // The organization timezone from settings is what renders the value: the
    // browser-locale / browser-timezone rendering never appears.
    expect(
      screen.queryByText(new Date(EXPIRES_AT).toLocaleString()),
    ).toBeNull();
    expect(EXPIRES_AT.slice(11, 16)).not.toBe(expected.slice(11, 16));
  });
});
