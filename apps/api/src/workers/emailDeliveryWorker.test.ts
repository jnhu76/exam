import {
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
});
