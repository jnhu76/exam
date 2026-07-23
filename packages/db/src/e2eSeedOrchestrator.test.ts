import { describe, it, expect, vi } from "vitest";
import {
  runE2eSeed,
  E2E_SEED_OUTPUT,
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

describe("e2eSeedOrchestrator", () => {
  it("runs migrations by default", async () => {
    const migrateFn = vi.fn().mockResolvedValue(undefined);
    const seedFn = vi.fn().mockResolvedValue(undefined);
    const seedDemoFn = vi.fn().mockResolvedValue(FAKE_IDS);
    const verifyDemoSeedFn = vi.fn().mockResolvedValue([]);

    const { logger, messages } = createCapturingLogger();

    await runE2eSeed(fakeDb, fakeHash, {
      migrateFn,
      logger,
      workflow: { seedFn, seedDemoFn, verifyDemoSeedFn },
    });

    expect(migrateFn).toHaveBeenCalledWith(fakeDb);
    expect(messages).toContain("Running migrations...\n");
  });

  it("skips migration when skipMigrate=true", async () => {
    const migrateFn = vi.fn().mockResolvedValue(undefined);
    const seedFn = vi.fn().mockResolvedValue(undefined);
    const seedDemoFn = vi.fn().mockResolvedValue(FAKE_IDS);
    const verifyDemoSeedFn = vi.fn().mockResolvedValue([]);

    const { logger, messages } = createCapturingLogger();

    await runE2eSeed(fakeDb, fakeHash, {
      skipMigrate: true,
      migrateFn,
      logger,
      workflow: { seedFn, seedDemoFn, verifyDemoSeedFn },
    });

    expect(migrateFn).not.toHaveBeenCalled();
    expect(messages).toContain("Skipping migrations (--skip-migrate)\n");
  });

  it("executes migrate -> seed -> seedDemo -> verify in order", async () => {
    const order: string[] = [];
    const migrateFn = vi.fn().mockImplementation(async () => {
      order.push("migrate");
    });
    const seedFn = vi.fn().mockImplementation(async () => {
      order.push("seed");
    });
    const seedDemoFn = vi.fn().mockImplementation(async () => {
      order.push("seedDemo");
      return FAKE_IDS;
    });
    const verifyDemoSeedFn = vi.fn().mockImplementation(async () => {
      order.push("verify");
      return [];
    });

    await runE2eSeed(fakeDb, fakeHash, {
      migrateFn,
      workflow: { seedFn, seedDemoFn, verifyDemoSeedFn },
    });

    expect(order).toEqual(["migrate", "seed", "seedDemo", "verify"]);
  });

  it("stops when baseline seed fails", async () => {
    const seedFn = vi.fn().mockRejectedValue(new Error("seed boom"));
    const seedDemoFn = vi.fn().mockResolvedValue(FAKE_IDS);
    const verifyDemoSeedFn = vi.fn().mockResolvedValue([]);

    await expect(
      runE2eSeed(fakeDb, fakeHash, {
        skipMigrate: true,
        workflow: { seedFn, seedDemoFn, verifyDemoSeedFn },
      }),
    ).rejects.toThrow("seed boom");

    expect(seedDemoFn).not.toHaveBeenCalled();
    expect(verifyDemoSeedFn).not.toHaveBeenCalled();
  });

  it("stops when demo seed fails", async () => {
    const seedFn = vi.fn().mockResolvedValue(undefined);
    const seedDemoFn = vi.fn().mockRejectedValue(new Error("demo boom"));
    const verifyDemoSeedFn = vi.fn().mockResolvedValue([]);

    await expect(
      runE2eSeed(fakeDb, fakeHash, {
        skipMigrate: true,
        workflow: { seedFn, seedDemoFn, verifyDemoSeedFn },
      }),
    ).rejects.toThrow("demo boom");

    expect(verifyDemoSeedFn).not.toHaveBeenCalled();
  });

  it("returns ok=false when verification reports errors", async () => {
    const seedFn = vi.fn().mockResolvedValue(undefined);
    const seedDemoFn = vi.fn().mockResolvedValue(FAKE_IDS);
    const verifyDemoSeedFn = vi
      .fn()
      .mockResolvedValue(["missing candidate1", "missing exam"]);

    const result = await runE2eSeed(fakeDb, fakeHash, {
      skipMigrate: true,
      workflow: { seedFn, seedDemoFn, verifyDemoSeedFn },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["missing candidate1", "missing exam"]);
  });

  it("returns ok=true when verification passes", async () => {
    const seedFn = vi.fn().mockResolvedValue(undefined);
    const seedDemoFn = vi.fn().mockResolvedValue(FAKE_IDS);
    const verifyDemoSeedFn = vi.fn().mockResolvedValue([]);

    const result = await runE2eSeed(fakeDb, fakeHash, {
      skipMigrate: true,
      workflow: { seedFn, seedDemoFn, verifyDemoSeedFn },
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("passes demo ids returned by seedDemo into verifyDemoSeed", async () => {
    const seedFn = vi.fn().mockResolvedValue(undefined);
    const seedDemoFn = vi.fn().mockResolvedValue(FAKE_IDS);
    const verifyDemoSeedFn = vi.fn().mockResolvedValue([]);

    await runE2eSeed(fakeDb, fakeHash, {
      skipMigrate: true,
      workflow: { seedFn, seedDemoFn, verifyDemoSeedFn },
    });

    expect(verifyDemoSeedFn).toHaveBeenCalledWith(fakeDb, FAKE_IDS);
  });

  it("preserves workflow order across repeated calls", async () => {
    const order: string[] = [];
    const migrateFn = vi.fn().mockImplementation(async () => {
      order.push("migrate");
    });
    const seedFn = vi.fn().mockImplementation(async () => {
      order.push("seed");
    });
    const seedDemoFn = vi.fn().mockImplementation(async () => {
      order.push("seedDemo");
      return FAKE_IDS;
    });
    const verifyDemoSeedFn = vi.fn().mockImplementation(async () => {
      order.push("verify");
      return [];
    });

    const workflow = { seedFn, seedDemoFn, verifyDemoSeedFn };

    await runE2eSeed(fakeDb, fakeHash, { migrateFn, workflow });
    await runE2eSeed(fakeDb, fakeHash, { migrateFn, workflow });

    expect(order).toEqual([
      "migrate",
      "seed",
      "seedDemo",
      "verify",
      "migrate",
      "seed",
      "seedDemo",
      "verify",
    ]);
  });

  it("exposes canonical credential output", () => {
    expect(E2E_SEED_OUTPUT).toContain("admin      / admin123");
    expect(E2E_SEED_OUTPUT).toContain("candidate  / candidate123");
    expect(E2E_SEED_OUTPUT).toContain("candidate1 / candidate123");
  });
});
