import { describe, expect, it } from "vitest";
import type { createAttemptRepo } from "./attemptRepo.js";

/**
 * Compile-time pin for the EXSEM-014 public API boundary (F43).
 *
 * The concrete attempt repository's generic `update` input must exclude the
 * lifecycle columns (`status`, `gradingStatus`); the named
 * `updateIncludingLifecycleState` seam keeps the wide input for the engine
 * command funnel. Runtime write behavior is covered by the repository and
 * route suites; this file makes a dropped `Omit` (or a narrowed seam) fail
 * `tsc`, not just review.
 */
type AttemptRepo = ReturnType<typeof createAttemptRepo>;
type GenericUpdateInput = Parameters<AttemptRepo["update"]>[2];
type SeamUpdateInput = Parameters<
  AttemptRepo["updateIncludingLifecycleState"]
>[2];

type Assert<T extends true> = T;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type GenericExcludesStatus = Assert<
  "status" extends keyof GenericUpdateInput ? false : true
>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type GenericExcludesGradingStatus = Assert<
  "gradingStatus" extends keyof GenericUpdateInput ? false : true
>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type SeamAcceptsStatus = Assert<
  "status" extends keyof SeamUpdateInput ? true : false
>;

describe("attemptRepo lifecycle update boundary (compile-time)", () => {
  it("keeps lifecycle columns out of generic update and in the named seam", () => {
    // The assertions are the type aliases above; tsc evaluates them.
    expect(true).toBe(true);
  });
});
