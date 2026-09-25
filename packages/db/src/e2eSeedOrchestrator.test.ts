import { describe, it, expect, vi } from "vitest";
import {
  runE2eSeed,
  buildE2eSeedOutput,
  type E2eSeedLogger,
} from "./e2eSeedOrchestrator.js";
import type { Database } from "./types.js";
import type { DemoIds } from "./demo-seed.js";

const fakeDb = {} as Database;
const fakeHash = async (password: string) => `hashed-${password}`;

const FAKE_IDS: DemoIds = {
  orgId: "org1",
  settingsId: "s1",
  users: { admin: "u1" },
  candidateFields: { cf1: "cf1" },
  courses: { c1: "c1" },
  questions: { q1: "q1" },
  exams: { e1: "e1" },
  enrollments: { en1: "en1" },
  attempts: { a1: "a1" },
};

function createCapturingLogger(): {
  logger: E2eSeedLogger;
  messages: string[];
} {
  const messages: string[] = [];
  return {
    logger: {
      write(message: string) {
        messages.push(message);
      },
    },
    messages,
  };
}

/** Injected workflow steps that record their invocation order. */
function makeSteps(order: string[]) {
  return {
    resetFn: vi.fn().mockImplementation(async () => {
      order.push("reset");
    }),
    migrateFn: vi.fn().mockImplementation(async () => {
      order.push("migrate");
    }),
    seedFn: vi.fn().mockImplementation(async () => {
      order.push("seed");
    }),
    seedDemoFn: vi.fn().mockImplementation(async () => {
      order.push("seedDemo");
      return FAKE_IDS;
    }),
    verifyDemoSeedFn: vi.fn().mockImplementation(async () => {
      order.push("verify");
      return [];
    }),
  };
}

describe("e2eSeedOrchestrator", () => {
  it("runs migrate → seed → seedDemo → verify in order; skipMigrate skips the migrate step", async () => {
    const order: string[] = [];
    const steps = makeSteps(order);
    const { logger, messages } = createCapturingLogger();

    await runE2eSeed(fakeDb, fakeHash, {
      migrateFn: steps.migrateFn,
      logger,
      workflow: {
        seedFn: steps.seedFn,
        seedDemoFn: steps.seedDemoFn,
        verifyDemoSeedFn: steps.verifyDemoSeedFn,
      },
    });

    expect(order).toEqual(["migrate", "seed", "seedDemo", "verify"]);
    expect(messages).toContain("Running migrations...\n");
    // Demo ids flow from seedDemo into verifyDemoSeed.
    expect(steps.verifyDemoSeedFn).toHaveBeenCalledWith(fakeDb, FAKE_IDS);

    order.length = 0;
    const { logger: skipLogger, messages: skipMessages } =
      createCapturingLogger();
    await runE2eSeed(fakeDb, fakeHash, {
      skipMigrate: true,
      migrateFn: steps.migrateFn,
      logger: skipLogger,
      workflow: {
        seedFn: steps.seedFn,
        seedDemoFn: steps.seedDemoFn,
        verifyDemoSeedFn: steps.verifyDemoSeedFn,
      },
    });
    expect(steps.migrateFn).toHaveBeenCalledTimes(1); // only the first run
    expect(skipMessages).toContain("Skipping migrations (--skip-migrate)\n");
  });

  it("reset=true truncates before the workflow; the default never touches mutable state", async () => {
    const order: string[] = [];
    const steps = makeSteps(order);
    const { logger, messages } = createCapturingLogger();

    await runE2eSeed(fakeDb, fakeHash, {
      reset: true,
      resetFn: steps.resetFn,
      migrateFn: steps.migrateFn,
      logger,
      workflow: {
        seedFn: steps.seedFn,
        seedDemoFn: steps.seedDemoFn,
        verifyDemoSeedFn: steps.verifyDemoSeedFn,
      },
    });

    expect(order).toEqual(["reset", "migrate", "seed", "seedDemo", "verify"]);
    expect(messages).toContain("Resetting mutable E2E state...\n");

    const untouched = makeSteps([]);
    await runE2eSeed(fakeDb, fakeHash, {
      skipMigrate: true,
      resetFn: untouched.resetFn,
      workflow: {
        seedFn: untouched.seedFn,
        seedDemoFn: untouched.seedDemoFn,
        verifyDemoSeedFn: untouched.verifyDemoSeedFn,
      },
    });
    expect(untouched.resetFn).not.toHaveBeenCalled();
  });

  it("a failed stage stops the workflow at that stage", async () => {
    // Reset refusal stops before migrate and seed.
    const resetSteps = makeSteps([]);
    resetSteps.resetFn.mockRejectedValue(new Error("reset refused"));
    await expect(
      runE2eSeed(fakeDb, fakeHash, {
        reset: true,
        resetFn: resetSteps.resetFn,
        migrateFn: resetSteps.migrateFn,
        workflow: {
          seedFn: resetSteps.seedFn,
          seedDemoFn: resetSteps.seedDemoFn,
          verifyDemoSeedFn: resetSteps.verifyDemoSeedFn,
        },
      }),
    ).rejects.toThrow("reset refused");
    expect(resetSteps.migrateFn).not.toHaveBeenCalled();
    expect(resetSteps.seedFn).not.toHaveBeenCalled();

    // Baseline seed failure stops before demo seed and verify.
    const seedSteps = makeSteps([]);
    seedSteps.seedFn.mockRejectedValue(new Error("seed boom"));
    await expect(
      runE2eSeed(fakeDb, fakeHash, {
        skipMigrate: true,
        workflow: {
          seedFn: seedSteps.seedFn,
          seedDemoFn: seedSteps.seedDemoFn,
          verifyDemoSeedFn: seedSteps.verifyDemoSeedFn,
        },
      }),
    ).rejects.toThrow("seed boom");
    expect(seedSteps.seedDemoFn).not.toHaveBeenCalled();
    expect(seedSteps.verifyDemoSeedFn).not.toHaveBeenCalled();

    // Demo seed failure stops before verify.
    const demoSteps = makeSteps([]);
    demoSteps.seedDemoFn.mockRejectedValue(new Error("demo boom"));
    await expect(
      runE2eSeed(fakeDb, fakeHash, {
        skipMigrate: true,
        workflow: {
          seedFn: demoSteps.seedFn,
          seedDemoFn: demoSteps.seedDemoFn,
          verifyDemoSeedFn: demoSteps.verifyDemoSeedFn,
        },
      }),
    ).rejects.toThrow("demo boom");
    expect(demoSteps.verifyDemoSeedFn).not.toHaveBeenCalled();
  });

  it("verification errors gate ok=false; a clean verify yields ok=true", async () => {
    const failing = makeSteps([]);
    failing.verifyDemoSeedFn.mockResolvedValue([
      "missing candidate1",
      "missing exam",
    ]);
    const failed = await runE2eSeed(fakeDb, fakeHash, {
      skipMigrate: true,
      workflow: {
        seedFn: failing.seedFn,
        seedDemoFn: failing.seedDemoFn,
        verifyDemoSeedFn: failing.verifyDemoSeedFn,
      },
    });
    expect(failed.ok).toBe(false);
    expect(failed.errors).toEqual(["missing candidate1", "missing exam"]);

    const clean = makeSteps([]);
    const passed = await runE2eSeed(fakeDb, fakeHash, {
      skipMigrate: true,
      workflow: {
        seedFn: clean.seedFn,
        seedDemoFn: clean.seedDemoFn,
        verifyDemoSeedFn: clean.verifyDemoSeedFn,
      },
    });
    expect(passed.ok).toBe(true);
    expect(passed.errors).toEqual([]);
  });

  it("buildE2eSeedOutput reflects default credentials and env-var overrides", () => {
    const output = buildE2eSeedOutput();
    expect(output).toContain("admin");
    expect(output).toContain("admin123");
    expect(output).toContain("candidate");
    expect(output).toContain("candidate123");
    expect(output).toContain("candidate1 / candidate123");

    vi.stubEnv("SEED_ADMIN_USERNAME", "myadmin");
    vi.stubEnv("SEED_ADMIN_PASSWORD", "s3cret");
    try {
      const overridden = buildE2eSeedOutput();
      expect(overridden).toContain("myadmin");
      expect(overridden).toContain("s3cret");
      expect(overridden).not.toContain("admin      / admin123");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
