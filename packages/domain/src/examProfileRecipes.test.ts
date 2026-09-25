import { describe, expect, it } from "vitest";
import {
  STARTER_PROFILE_RECIPES,
  findStarterRecipe,
} from "./examProfileRecipes.js";

/**
 * P7-M truthfulness guard (closeout task §53) — data half. A starter recipe
 * is a promise to authors; these tests pin WHAT the shipped recipes declare
 * (which recipes exist, that they carry policy data only — no product copy —
 * and the exact honest values per recipe).
 *
 * The structural half of the promise (every default is a profile-safe
 * dimension inside the wire schema's ranges, and the ADR-013 interruption
 * caps rule holds per recipe) is owned by the schema-parse suite in
 * `@exam/contracts` (`examProfile.test.ts`), where `CreateExamProfileRequestSchema`
 * and `normalizeInterruptionPolicyConfiguration` live; re-checking it here
 * would duplicate the schema by hand.
 */

describe("STARTER_PROFILE_RECIPES — truthfulness guard", () => {
  it("ships exactly the two honest recipes (basic_quiz, standard_online)", () => {
    const keys = STARTER_PROFILE_RECIPES.map((r) => r.key);
    expect(keys).toEqual(["basic_quiz", "standard_online"]);
  });

  it("carries NO product copy (name/description) — copy lives in i18n", () => {
    for (const recipe of STARTER_PROFILE_RECIPES) {
      expect(recipe).not.toHaveProperty("name");
      expect(recipe).not.toHaveProperty("description");
    }
  });

  it("basic_quiz is the simplest honest profile (single attempt, strict, no caps)", () => {
    const basic = findStarterRecipe("basic_quiz");
    expect(basic).not.toBeNull();
    // "Single attempt" must be max_attempts + 1 — under `unlimited` the
    // engine ignores maxAttempts and retakes are free (truthfulness guard).
    expect(basic!.defaults.retakePolicy).toBe("max_attempts");
    expect(basic!.defaults.maxAttempts).toBe(1);
    expect(basic!.defaults.interruptionTimePolicy).toBe("strict");
    expect(basic!.defaults.interruptionGracePerIncidentSeconds).toBeNull();
    expect(basic!.defaults.interruptionGracePerAttemptSeconds).toBeNull();
  });

  it("standard_online uses bounded grace with sensible caps", () => {
    const std = findStarterRecipe("standard_online");
    expect(std).not.toBeNull();
    expect(std!.defaults.interruptionTimePolicy).toBe("bounded_grace");
    expect(std!.defaults.interruptionGracePerIncidentSeconds).toBe(300);
    expect(std!.defaults.interruptionGracePerAttemptSeconds).toBe(600);
  });
});

describe("findStarterRecipe", () => {
  it("returns the recipe for a known key", () => {
    expect(findStarterRecipe("basic_quiz")?.key).toBe("basic_quiz");
    expect(findStarterRecipe("standard_online")?.key).toBe("standard_online");
  });

  it("returns null for an unknown key (no guessing, no fake Strict/Controlled)", () => {
    expect(findStarterRecipe("strict")).toBeNull();
    expect(findStarterRecipe("controlled")).toBeNull();
    expect(findStarterRecipe("Strict")).toBeNull();
    expect(findStarterRecipe("")).toBeNull();
  });
});
