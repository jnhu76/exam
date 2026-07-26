import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";
import type { Organization } from "@exam/domain";
import {
  BOOTSTRAP_PENDING_MESSAGE,
  interruptibleSleep,
  waitForSingleOrganization,
  type LogFn,
} from "./emailDeliveryWorker.js";

describe("waitForSingleOrganization", () => {
  function createDeps() {
    return {
      orgRepo: {
        resolveOptionalBrandingTenant: vi.fn(),
      },
      heartbeatRepo: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      workerInstanceId: "test-worker-1",
      pollIntervalMs: 5000,
      isShuttingDown: vi.fn().mockReturnValue(false),
      sleep: vi.fn().mockResolvedValue(undefined),
      log: vi.fn() as MockedFunction<LogFn>,
    };
  }

  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("polls through empty states and resolves once a single organization exists", async () => {
    const org: Organization = {
      id: "org-1",
      name: "Org",
      displayName: "Org",
      slug: "org",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    deps.orgRepo.resolveOptionalBrandingTenant
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(org);

    const result = await waitForSingleOrganization(deps);

    expect(result).toBe(org);
    expect(deps.orgRepo.resolveOptionalBrandingTenant).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.heartbeatRepo.upsert).toHaveBeenCalledTimes(2);
    expect(deps.heartbeatRepo.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workerName: "email-delivery",
        workerInstanceId: "test-worker-1",
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: BOOTSTRAP_PENDING_MESSAGE,
      }),
    );
    expect(deps.log).toHaveBeenCalledWith(
      "warn",
      "waiting for initial organization bootstrap",
    );
    expect(deps.log).toHaveBeenCalledWith(
      "info",
      "resolved default organization",
      { organizationId: org.id },
    );
    // The warning should only be emitted once, not on every poll interval.
    expect(
      deps.log.mock.calls.filter(
        ([level, msg]) =>
          level === "warn" &&
          msg === "waiting for initial organization bootstrap",
      ),
    ).toHaveLength(1);
  });

  it("fails fast when multiple organizations exist", async () => {
    deps.orgRepo.resolveOptionalBrandingTenant.mockRejectedValue(
      new Error("Multiple organizations exist; organizationSlug is required"),
    );

    await expect(waitForSingleOrganization(deps)).rejects.toThrow(
      "Multiple organizations exist; organizationSlug is required",
    );

    expect(deps.heartbeatRepo.upsert).not.toHaveBeenCalled();
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(
      deps.log.mock.calls.filter(
        ([level, msg]) =>
          level === "warn" &&
          msg === "waiting for initial organization bootstrap",
      ),
    ).toHaveLength(0);
  });

  it("returns null immediately when already shutting down", async () => {
    deps.isShuttingDown.mockReturnValue(true);

    const result = await waitForSingleOrganization(deps);

    expect(result).toBeNull();
    expect(deps.orgRepo.resolveOptionalBrandingTenant).not.toHaveBeenCalled();
    expect(deps.heartbeatRepo.upsert).not.toHaveBeenCalled();
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it("returns null when shutdown is requested during waiting", async () => {
    deps.orgRepo.resolveOptionalBrandingTenant.mockResolvedValue(null);
    deps.isShuttingDown.mockReturnValueOnce(false).mockReturnValue(true);

    const result = await waitForSingleOrganization(deps);

    expect(result).toBeNull();
    expect(deps.orgRepo.resolveOptionalBrandingTenant).toHaveBeenCalledTimes(1);
    expect(deps.heartbeatRepo.upsert).toHaveBeenCalledTimes(1);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it("continues waiting when bootstrap-pending heartbeat write is rejected", async () => {
    const org: Organization = {
      id: "org-1",
      name: "Org",
      displayName: "Org",
      slug: "org",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    deps.orgRepo.resolveOptionalBrandingTenant
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(org);
    deps.heartbeatRepo.upsert
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce({});

    const result = await waitForSingleOrganization(deps);

    expect(result).toBe(org);
    expect(deps.orgRepo.resolveOptionalBrandingTenant).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    expect(deps.heartbeatRepo.upsert).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(
      "warn",
      "heartbeat write failed (non-fatal)",
      { error: "connection reset" },
    );
    expect(deps.log).toHaveBeenCalledWith(
      "info",
      "resolved default organization",
      { organizationId: org.id },
    );
  });
});

describe("interruptibleSleep", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears both handles after normal timeout", async () => {
    let shuttingDown = false;
    const promise = interruptibleSleep(1000, () => shuttingDown);

    expect(vi.getTimerCount()).toBe(2);

    vi.advanceTimersByTime(1000);
    await promise;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears both handles when shutdown interrupts sleep", async () => {
    let shuttingDown = false;
    const promise = interruptibleSleep(1000, () => shuttingDown);

    expect(vi.getTimerCount()).toBe(2);

    shuttingDown = true;
    vi.advanceTimersByTime(200);
    await promise;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves exactly once when timeout and shutdown race", async () => {
    let shuttingDown = false;
    const promise = interruptibleSleep(200, () => shuttingDown);

    let resolveCount = 0;
    const tracked = promise.then(() => {
      resolveCount++;
    });

    shuttingDown = true;
    vi.advanceTimersByTime(200);
    await tracked;

    expect(resolveCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
