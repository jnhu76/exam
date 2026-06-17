import { describe, expect, it, vi } from "vitest";
import {
  selectExpiredAttempts,
  scanExpiredAttempts,
  scanDatabaseForExpiredAttempts,
  type ExpiredAttemptCandidate,
} from "./deadlineScanner.js";

function makeAttempt(
  overrides: Partial<ExpiredAttemptCandidate>,
): ExpiredAttemptCandidate {
  return {
    id: "att-1",
    status: "in_progress",
    deadlineAt: new Date("2025-01-01T11:00:00Z"),
    organizationId: "org-1",
    ...overrides,
  };
}

describe("deadline scanner — selectExpiredAttempts", () => {
  it("selects in_progress attempt whose deadline has passed", () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const selected = selectExpiredAttempts(
      [
        makeAttempt({
          id: "att-1",
          status: "in_progress",
          deadlineAt: new Date("2025-01-01T11:00:00Z"),
        }),
      ],
      now,
    );

    expect(selected.map((a) => a.id)).toEqual(["att-1"]);
  });

  it("selects disrupted attempt whose deadline has passed", () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const selected = selectExpiredAttempts(
      [
        makeAttempt({
          id: "att-2",
          status: "disrupted",
          deadlineAt: new Date("2025-01-01T11:00:00Z"),
        }),
      ],
      now,
    );

    expect(selected.map((a) => a.id)).toEqual(["att-2"]);
  });

  it("selects attempt exactly at deadline (now === deadlineAt)", () => {
    const now = new Date("2025-01-01T11:00:00Z");
    const selected = selectExpiredAttempts(
      [
        makeAttempt({
          id: "att-3",
          deadlineAt: new Date("2025-01-01T11:00:00Z"),
        }),
      ],
      now,
    );

    expect(selected.map((a) => a.id)).toEqual(["att-3"]);
  });

  it("does NOT select in_progress attempt whose deadline has not passed", () => {
    const now = new Date("2025-01-01T11:00:00Z");
    const selected = selectExpiredAttempts(
      [
        makeAttempt({
          id: "att-4",
          status: "in_progress",
          deadlineAt: new Date("2025-01-01T12:00:00Z"),
        }),
      ],
      now,
    );

    expect(selected).toHaveLength(0);
  });

  it("does NOT select submitted / grading / graded / voided attempts (idempotent skip)", () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const selected = selectExpiredAttempts(
      [
        makeAttempt({ id: "s", status: "submitted" }),
        makeAttempt({ id: "g1", status: "grading" }),
        makeAttempt({ id: "g2", status: "graded" }),
        makeAttempt({ id: "v", status: "voided" }),
      ],
      now,
    );

    expect(selected).toHaveLength(0);
  });

  it("does NOT select attempts without a deadline", () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const selected = selectExpiredAttempts(
      [
        makeAttempt({
          id: "att-5",
          status: "in_progress",
          deadlineAt: null,
        }),
      ],
      now,
    );

    expect(selected).toHaveLength(0);
  });

  it("selects multiple expired attempts from a mixed list", () => {
    const now = new Date("2025-01-01T12:00:00Z");
    const selected = selectExpiredAttempts(
      [
        makeAttempt({
          id: "exp-1",
          deadlineAt: new Date("2025-01-01T11:00:00Z"),
        }),
        makeAttempt({
          id: "live-1",
          deadlineAt: new Date("2025-01-01T13:00:00Z"),
        }),
        makeAttempt({
          id: "exp-2",
          status: "disrupted",
          deadlineAt: new Date("2025-01-01T11:30:00Z"),
        }),
        makeAttempt({ id: "graded-1", status: "graded" }),
      ],
      now,
    );

    expect(selected.map((a) => a.id).sort()).toEqual(["exp-1", "exp-2"]);
  });
});

describe("deadline scanner — scanExpiredAttempts", () => {
  it("invokes the submit callback for each expired attempt and returns counts", async () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const submittedIds: string[] = [];
    const onExpired = vi.fn(async (id: string) => {
      submittedIds.push(id);
    });

    const result = await scanExpiredAttempts(
      [
        makeAttempt({
          id: "exp-1",
          deadlineAt: new Date("2025-01-01T11:00:00Z"),
        }),
        makeAttempt({
          id: "exp-2",
          status: "disrupted",
          deadlineAt: new Date("2025-01-01T11:10:00Z"),
        }),
        makeAttempt({
          id: "live-1",
          deadlineAt: new Date("2025-01-01T13:00:00Z"),
        }),
      ],
      now,
      onExpired,
    );

    expect(result.submittedCount).toBe(2);
    expect(submittedIds.sort()).toEqual(["exp-1", "exp-2"]);
    expect(onExpired).toHaveBeenCalledTimes(2);
  });

  it("logs and continues when submit fails for one attempt (retry next scan)", async () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const submittedIds: string[] = [];
    const onExpired = vi.fn(async (id: string) => {
      if (id === "exp-fail") {
        throw new Error("transient db error");
      }
      submittedIds.push(id);
    });
    const onError = vi.fn();

    const result = await scanExpiredAttempts(
      [
        makeAttempt({
          id: "exp-fail",
          deadlineAt: new Date("2025-01-01T11:00:00Z"),
        }),
        makeAttempt({
          id: "exp-ok",
          deadlineAt: new Date("2025-01-01T11:00:00Z"),
        }),
      ],
      now,
      onExpired,
      { onError },
    );

    expect(submittedIds).toEqual(["exp-ok"]);
    expect(result.submittedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBe("exp-fail");
  });

  it("returns zero counts when no attempts are expired", async () => {
    const now = new Date("2025-01-01T11:00:00Z");
    const onExpired = vi.fn();

    const result = await scanExpiredAttempts(
      [
        makeAttempt({
          id: "live-1",
          deadlineAt: new Date("2025-01-01T13:00:00Z"),
        }),
      ],
      now,
      onExpired,
    );

    expect(result.submittedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(onExpired).not.toHaveBeenCalled();
  });
});
