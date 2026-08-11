import { describe, expect, it } from "vitest";
import {
  STARTER_PROFILE_RECIPES,
  findStarterRecipe,
  type StarterProfileRecipeKey,
} from "./examProfileRecipes.js";
import type { ExamProfilePolicyDefaults } from "./examProfile.js";

/**
 * P7-M truthfulness guard (closeout task §53). A starter recipe is a promise
 * to authors: every value it carries MUST be (a) a profile-safe dimension
 * (one of the 10 ExamProfilePolicyDefaults fields) and (b) honored by the
 * current runtime. These tests assert the structural half of that promise —
 * that the recipes carry only supported fields and obey the ADR-013
 * interruption invariant. The runtime-enforcement half is proven by the M1/M2
 * evidence catalog and the runtime-independence test, not re-proven here.
 */

const PROFILE_SAFE_FIELDS = new Set<keyof ExamProfilePolicyDefaults>([
  "durationMinutes",
  "latestStartOffsetMinutes",
  "minSubmitAfterStartMinutes",
  "retakePolicy",
  "maxAttempts",
  "scoreStrategy",
  "resultPublicationMode",
  "interruptionTimePolicy",
  "interruptionGracePerIncidentSeconds",
  "interruptionGracePerAttemptSeconds",
]);

const SUPPORTED_RETAKE_POLICIES = new Set([
  "unlimited",
  "max_attempts",
  "pass_then_stop",
]);
const SUPPORTED_SCORE_STRATEGIES = new Set(["highest", "latest", "first"]);
const SUPPORTED_RESULT_MODES = new Set([
  "immediate",
  "after_grading",
  "manual",
]);
const SUPPORTED_INTERRUPTION_POLICIES = new Set([
  "strict",
  "bounded_grace",
  "operator_incident",
]);

describe("STARTER_PROFILE_RECIPES — truthfulness guard", () => {
  it("ships exactly the two honest recipes (basic_quiz, standard_online)", () => {
    const keys = STARTER_PROFILE_RECIPES.map((r) => r.key);
    expect(keys).toEqual(["basic_quiz", "standard_online"]);
  });

  it("every recipe carries a stable key", () => {
    for (const recipe of STARTER_PROFILE_RECIPES) {
      expect(typeof recipe.key).toBe("string");
      expect(recipe.key.length).toBeGreaterThan(0);
    }
  });

  it("carries NO product copy (name/description) — copy lives in i18n", () => {
    for (const recipe of STARTER_PROFILE_RECIPES) {
      expect(recipe).not.toHaveProperty("name");
      expect(recipe).not.toHaveProperty("description");
    }
  });

  it("each recipe.defaults has exactly the 10 profile-safe fields, nothing more", () => {
    for (const recipe of STARTER_PROFILE_RECIPES) {
      const keys = Object.keys(recipe.defaults);
      expect(new Set(keys)).toEqual(PROFILE_SAFE_FIELDS);
    }
  });

  it("durationMinutes is a positive integer", () => {
    for (const recipe of STARTER_PROFILE_RECIPES) {
      const d = recipe.defaults.durationMinutes;
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThan(0);
    }
  });

  it("latestStartOffsetMinutes / minSubmitAfterStartMinutes are null or non-negative integers", () => {
    for (const recipe of STARTER_PROFILE_RECIPES) {
      for (const f of [
        "latestStartOffsetMinutes",
        "minSubmitAfterStartMinutes",
      ] as const) {
        const v = recipe.defaults[f];
        expect(v === null || (Number.isInteger(v) && v >= 0)).toBe(true);
      }
    }
  });

  it("retakePolicy / scoreStrategy / resultPublicationMode / interruptionTimePolicy use only supported enum values", () => {
    for (const recipe of STARTER_PROFILE_RECIPES) {
      expect(SUPPORTED_RETAKE_POLICIES).toContain(recipe.defaults.retakePolicy);
      expect(SUPPORTED_SCORE_STRATEGIES).toContain(
        recipe.defaults.scoreStrategy,
      );
      expect(SUPPORTED_RESULT_MODES).toContain(
        recipe.defaults.resultPublicationMode,
      );
      expect(SUPPORTED_INTERRUPTION_POLICIES).toContain(
        recipe.defaults.interruptionTimePolicy,
      );
    }
  });

  it("maxAttempts is a positive integer", () => {
    for (const recipe of STARTER_PROFILE_RECIPES) {
      expect(Number.isInteger(recipe.defaults.maxAttempts)).toBe(true);
      expect(recipe.defaults.maxAttempts).toBeGreaterThanOrEqual(1);
    }
  });

  it("obeys the ADR-013 interruption caps invariant per recipe", () => {
    for (const recipe of STARTER_PROFILE_RECIPES) {
      const {
        interruptionTimePolicy: policy,
        interruptionGracePerIncidentSeconds: perIncident,
        interruptionGracePerAttemptSeconds: perAttempt,
      } = recipe.defaults;
      if (policy === "strict" || policy === "operator_incident") {
        // Strict / operator_incident ⇒ both caps MUST be null.
        expect(perIncident).toBeNull();
        expect(perAttempt).toBeNull();
      } else {
        // bounded_grace ⇒ both caps present, positive, per-incident ≤ per-attempt.
        expect(perIncident).not.toBeNull();
        expect(perAttempt).not.toBeNull();
        expect(perIncident! > 0).toBe(true);
        expect(perAttempt! > 0).toBe(true);
        expect(perIncident! <= perAttempt!).toBe(true);
      }
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

  it("every shipped key is a valid StarterProfileRecipeKey", () => {
    for (const recipe of STARTER_PROFILE_RECIPES) {
      const key: StarterProfileRecipeKey = recipe.key;
      expect(typeof key).toBe("string");
    }
  });
});
