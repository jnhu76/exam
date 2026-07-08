import { describe, expect, it, vi } from "vitest";
import {
  scanDeadlineCandidates,
  type DeadlineCandidate,
} from "./deadlineScanner.js";

function makeCandidate(
  overrides: Partial<DeadlineCandidate>,
): DeadlineCandidate {
  return {
    id: "att-1",
    status: "in_progress",
    organizationId: "org-1",
    ...overrides,
  };
}

// NOTE: there is deliberately NO "selectExpiredAttempts" / in-memory expiry
// filter test here. That function was removed — the DB query
// (listDeadlineCandidates) is the sole discovery authority, and the under-lock
// canonical recheck in autoSubmitAndGrade is the sole mutation authority.
// These tests cover ONLY the pure iterator contract of scanDeadlineCandidates.

describe("deadline scanner — scanDeadlineCandidates (iterator)", () => {
  it("invokes the callback for each candidate and returns submitted count", async () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const submittedIds: string[] = [];
    const onCandidate = vi.fn(async (id: string) => {
      submittedIds.push(id);
    });

    const result = await scanDeadlineCandidates(
      [
        makeCandidate({ id: "exp-1" }),
        makeCandidate({ id: "exp-2", status: "disrupted" }),
      ],
      now,
      onCandidate,
    );

    expect(result.submittedCount).toBe(2);
    expect(submittedIds.sort()).toEqual(["exp-1", "exp-2"]);
    expect(onCandidate).toHaveBeenCalledTimes(2);
  });

  it("logs and continues when submit fails for one candidate (retry next scan)", async () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const submittedIds: string[] = [];
    const onCandidate = vi.fn(async (id: string) => {
      if (id === "exp-fail") {
        throw new Error("transient db error");
      }
      submittedIds.push(id);
    });
    const onError = vi.fn();

    const result = await scanDeadlineCandidates(
      [makeCandidate({ id: "exp-fail" }), makeCandidate({ id: "exp-ok" })],
      now,
      onCandidate,
      { onError },
    );

    expect(submittedIds).toEqual(["exp-ok"]);
    expect(result.submittedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBe("exp-fail");
  });

  it("returns zero counts when there are no candidates", async () => {
    const now = new Date("2025-01-01T11:00:00Z");
    const onCandidate = vi.fn();

    const result = await scanDeadlineCandidates([], now, onCandidate);

    expect(result.submittedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(onCandidate).not.toHaveBeenCalled();
  });

  it("does NOT increment submittedCount when onCandidate returns false (under-lock no-op)", async () => {
    // T7 contract at the iterator level: a candidate that returns false from
    // onCandidate (autoSubmitAndGrade found it not-expired under lock) must
    // not be counted as a submission. The authoritative skip happens inside
    // autoSubmitAndGrade; the DB-backed linearization regression is in the
    // integration test (deadline-authority.structural.test.ts).
    const now = new Date("2025-01-01T11:30:00Z");
    const onCandidate = vi.fn(async () => false);

    const result = await scanDeadlineCandidates(
      [
        makeCandidate({ id: "noop-1" }),
        makeCandidate({ id: "noop-2", status: "disrupted" }),
      ],
      now,
      onCandidate,
    );

    expect(result.submittedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(onCandidate).toHaveBeenCalledTimes(2);
  });

  it("increments submittedCount when onCandidate returns true or void", async () => {
    const now = new Date("2025-01-01T11:30:00Z");
    const onCandidate = vi.fn(async (id: string) => {
      if (id === "ret-true") return true;
      if (id === "ret-void") return undefined;
      return false;
    });

    const result = await scanDeadlineCandidates(
      [
        makeCandidate({ id: "ret-true" }),
        makeCandidate({ id: "ret-void" }),
        makeCandidate({ id: "ret-false" }),
      ],
      now,
      onCandidate,
    );

    expect(result.submittedCount).toBe(2);
    expect(result.failedCount).toBe(0);
  });
});
