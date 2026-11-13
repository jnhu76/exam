import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DateTimeProvider,
  useProductDateTime,
} from "@/contexts/DateTimeContext";
import { permissionsForRole } from "@exam/authz";
import type { MeResponse } from "@exam/contracts";

/**
 * R9 (#971): after an identity or organization switch, the previous
 * identity's settings request — success AND failure — must never write into
 * the current context, and the previous organization's time zone must not
 * briefly apply inside the new identity's forms.
 */

const { apiGet, useAuthMock, deferreds } = vi.hoisted(() => {
  const apiGet = vi.fn();
  const useAuthMock = vi.fn();
  const deferreds: Array<{
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  return { apiGet, useAuthMock, deferreds };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => useAuthMock() }));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
}));

function userFor(id: string): Pick<MeResponse, "role" | "capabilities"> {
  return {
    role: "Admin",
    capabilities: [...permissionsForRole("Admin")],
    // `id` is the identity the provider must key ownership on.
    id,
    username: id,
    name: id,
    organizationId: "org-1",
  } as MeResponse;
}

/** Fulfills the nth /api/admin/settings request. */
function deferredSettings(n: number) {
  apiGet.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        deferreds[n] = { resolve, reject };
      }),
  );
}

function Probe() {
  const formatter = useProductDateTime();
  return <div data-testid="tz-probe">{formatter.timeZone}</div>;
}

const FALLBACK_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

beforeEach(() => {
  deferreds.length = 0;
  apiGet.mockReset();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({ user: null, isLoading: false });
});

afterEach(() => {
  // Never leave a dangling deferred rejection for the next test.
  for (const d of deferreds) d?.resolve({});
});

function renderProvider() {
  return render(
    <DateTimeProvider>
      <Probe />
    </DateTimeProvider>,
  );
}

function switchUser(user: unknown, rerender: (ui: React.ReactNode) => void) {
  useAuthMock.mockReturnValue({ user, isLoading: false });
  act(() => {
    rerender(
      <DateTimeProvider>
        <Probe />
      </DateTimeProvider>,
    );
  });
}

describe("DateTimeProvider — organization settings ownership (R9)", () => {
  it("loads the organization time zone and aborts superseded requests via signal", async () => {
    useAuthMock.mockReturnValue({ user: userFor("a"), isLoading: false });
    apiGet.mockResolvedValue({ timezone: "Asia/Shanghai" });
    renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId("tz-probe")).toHaveTextContent("Asia/Shanghai");
    });
    // The settings request is cancellable: the provider forwards an
    // AbortSignal so a superseded fetch can be canceled at the transport.
    expect(apiGet).toHaveBeenCalledWith(
      "/api/admin/settings",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("never applies a previous identity's LATE SUCCESS", async () => {
    useAuthMock.mockReturnValue({ user: userFor("a"), isLoading: false });
    deferredSettings(0); // identity A's settings request hangs
    const { rerender } = renderProvider();

    // Switch to identity B before A's response arrives. Europe/Paris is
    // never a host fallback here, so "not Paris" is a real assertion.
    deferredSettings(1); // identity B's settings request hangs
    switchUser(userFor("b"), rerender);

    // A's response lands late with the OLD organization zone.
    await act(async () => {
      deferreds[0]!.resolve({ timezone: "Europe/Paris" });
    });
    expect(screen.getByTestId("tz-probe")).not.toHaveTextContent(
      "Europe/Paris",
    );

    // B's own settings apply normally.
    await act(async () => {
      deferreds[1]!.resolve({ timezone: "Asia/Shanghai" });
    });
    expect(screen.getByTestId("tz-probe")).toHaveTextContent("Asia/Shanghai");
  });

  it("never applies a previous identity's LATE FAILURE over a loaded zone", async () => {
    useAuthMock.mockReturnValue({ user: userFor("a"), isLoading: false });
    deferredSettings(0);
    const { rerender } = renderProvider();

    deferredSettings(1);
    switchUser(userFor("b"), rerender);

    // B's settings succeed first…
    await act(async () => {
      deferreds[1]!.resolve({ timezone: "Asia/Shanghai" });
    });
    expect(screen.getByTestId("tz-probe")).toHaveTextContent("Asia/Shanghai");

    // …then A's request FAILS late: it must not clobber B's zone with the
    // failure fallback either.
    await act(async () => {
      deferreds[0]!.reject(new Error("late failure"));
    });
    expect(screen.getByTestId("tz-probe")).toHaveTextContent("Asia/Shanghai");
  });

  it("clears the previous organization zone synchronously on identity switch", async () => {
    useAuthMock.mockReturnValue({ user: userFor("a"), isLoading: false });
    deferredSettings(0);
    const { rerender } = renderProvider();
    await act(async () => {
      deferreds[0]!.resolve({ timezone: "Europe/Paris" });
    });
    expect(screen.getByTestId("tz-probe")).toHaveTextContent("Europe/Paris");

    // Switching identities must not let org A's zone paint inside identity
    // B's forms — not even before B's settings arrive.
    deferredSettings(1);
    switchUser(userFor("b"), rerender);
    expect(screen.getByTestId("tz-probe")).toHaveTextContent(FALLBACK_TZ);
    expect(screen.getByTestId("tz-probe")).not.toHaveTextContent(
      "Europe/Paris",
    );

    await act(async () => {
      deferreds[1]!.resolve({ timezone: "Asia/Shanghai" });
    });
    expect(screen.getByTestId("tz-probe")).toHaveTextContent("Asia/Shanghai");
  });

  it("returns to the fallback zone when the user logs out", async () => {
    useAuthMock.mockReturnValue({ user: userFor("a"), isLoading: false });
    apiGet.mockResolvedValue({ timezone: "Europe/Paris" });
    const { rerender } = renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId("tz-probe")).toHaveTextContent("Europe/Paris");
    });

    switchUser(null, rerender);
    expect(screen.getByTestId("tz-probe")).toHaveTextContent(FALLBACK_TZ);
    expect(screen.getByTestId("tz-probe")).not.toHaveTextContent(
      "Europe/Paris",
    );
  });
});
