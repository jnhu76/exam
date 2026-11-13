import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DateTimeProvider,
  useProductDateTime,
  useScheduleSessionTimeZone,
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

/**
 * The form-session zone: null while the first settings read is pending (the
 * schedule inputs stay closed), then the frozen zone the whole session uses.
 */
function SessionProbe() {
  const sessionTimeZone = useScheduleSessionTimeZone();
  return <div data-testid="session-probe">{sessionTimeZone ?? "pending"}</div>;
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
      <SessionProbe />
    </DateTimeProvider>,
  );
}

function switchUser(user: unknown, rerender: (ui: React.ReactNode) => void) {
  useAuthMock.mockReturnValue({ user, isLoading: false });
  act(() => {
    rerender(
      <DateTimeProvider>
        <Probe />
        <SessionProbe />
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

/**
 * #971 W3 review (A/C): a FORM SESSION gets exactly one scheduling zone.
 * While the first organization-settings read is pending the session zone is
 * unknown (schedule inputs stay closed); once it settles the zone is frozen
 * for the whole session, and an identity switch drops it before paint.
 */
describe("DateTimeProvider — one scheduling zone per form session", () => {
  it("keeps the session closed until the first settings read settles, then freezes the organization zone", async () => {
    useAuthMock.mockReturnValue({ user: userFor("a"), isLoading: false });
    deferredSettings(0);
    renderProvider();

    // No session zone yet: no schedule input may open on the fallback.
    expect(screen.getByTestId("session-probe")).toHaveTextContent("pending");

    await act(async () => {
      deferreds[0]!.resolve({ timezone: "Asia/Shanghai" });
    });
    expect(screen.getByTestId("session-probe")).toHaveTextContent(
      "Asia/Shanghai",
    );
  });

  it("freezes the session zone: a later settings refresh cannot change it", async () => {
    useAuthMock.mockReturnValue({ user: userFor("a"), isLoading: false });
    apiGet.mockResolvedValueOnce({ timezone: "Asia/Shanghai" });
    renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId("session-probe")).toHaveTextContent(
        "Asia/Shanghai",
      );
    });

    // A branding refresh re-reads settings and moves the PRODUCT display zone…
    apiGet.mockResolvedValueOnce({ timezone: "Europe/Paris" });
    await act(async () => {
      window.dispatchEvent(new Event("branding:refresh"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("tz-probe")).toHaveTextContent("Europe/Paris");
    });
    // …but the open form session keeps interpreting/echoing Shanghai.
    expect(screen.getByTestId("session-probe")).toHaveTextContent(
      "Asia/Shanghai",
    );
  });

  it("opens the session on the allowed fallback when the identity cannot read settings", () => {
    useAuthMock.mockReturnValue({
      user: {
        ...userFor("candidate"),
        role: "Candidate",
        capabilities: [...permissionsForRole("Candidate")],
      },
      isLoading: false,
    });
    renderProvider();

    expect(screen.getByTestId("session-probe")).toHaveTextContent(FALLBACK_TZ);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("opens the session on the fallback after the first settings read fails", async () => {
    useAuthMock.mockReturnValue({ user: userFor("a"), isLoading: false });
    deferredSettings(0);
    renderProvider();
    expect(screen.getByTestId("session-probe")).toHaveTextContent("pending");

    await act(async () => {
      deferreds[0]!.reject(new Error("settings unavailable"));
    });
    expect(screen.getByTestId("session-probe")).toHaveTextContent(FALLBACK_TZ);
  });

  it("drops a superseded identity's session zone; its late success cannot reopen the old zone", async () => {
    useAuthMock.mockReturnValue({ user: userFor("a"), isLoading: false });
    apiGet.mockResolvedValueOnce({ timezone: "Asia/Shanghai" });
    const { rerender } = renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId("session-probe")).toHaveTextContent(
        "Asia/Shanghai",
      );
    });

    // A branding refresh under identity A is still in flight when the
    // identity switches to B.
    deferredSettings(1);
    await act(async () => {
      window.dispatchEvent(new Event("branding:refresh"));
    });
    deferredSettings(2);
    switchUser(userFor("b"), rerender);
    // The previous identity's frozen zone is gone before B's read settles.
    expect(screen.getByTestId("session-probe")).toHaveTextContent("pending");
    expect(screen.getByTestId("session-probe")).not.toHaveTextContent(
      "Asia/Shanghai",
    );

    // A's late refresh success must not write the old organization's zone.
    await act(async () => {
      deferreds[1]!.resolve({ timezone: "Europe/Paris" });
    });
    expect(screen.getByTestId("session-probe")).toHaveTextContent("pending");

    // B's own read settles the new session.
    await act(async () => {
      deferreds[2]!.resolve({ timezone: "Asia/Shanghai" });
    });
    expect(screen.getByTestId("session-probe")).toHaveTextContent(
      "Asia/Shanghai",
    );
  });

  it("never lets a superseded identity's late failure reopen a fallback session", async () => {
    useAuthMock.mockReturnValue({ user: userFor("a"), isLoading: false });
    apiGet.mockResolvedValueOnce({ timezone: "Asia/Shanghai" });
    const { rerender } = renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId("session-probe")).toHaveTextContent(
        "Asia/Shanghai",
      );
    });

    deferredSettings(1);
    await act(async () => {
      window.dispatchEvent(new Event("branding:refresh"));
    });
    deferredSettings(2);
    switchUser(userFor("b"), rerender);
    expect(screen.getByTestId("session-probe")).toHaveTextContent("pending");

    // B's read succeeds first…
    await act(async () => {
      deferreds[2]!.resolve({ timezone: "Asia/Shanghai" });
    });
    expect(screen.getByTestId("session-probe")).toHaveTextContent(
      "Asia/Shanghai",
    );

    // …then A's late refresh FAILS: it must not clobber the session.
    await act(async () => {
      deferreds[1]!.reject(new Error("late failure"));
    });
    expect(screen.getByTestId("session-probe")).toHaveTextContent(
      "Asia/Shanghai",
    );
  });
});
