// ── Starter exam profile recipes (truthful authoring defaults) ────────
//
// A starter recipe is a RECOMMENDED AUTHORING DEFAULT only. It is NOT runtime
// authority, NOT a second profile kind, and NOT a special id. The UI offers
// these as "from starter template" affordances: selecting one prefills the
// ordinary profile editor; the user then saves an everyday organization-owned
// profile row via POST /api/exam-profiles. No runtime code may branch on
// `key`.
//
// Recipes whose names would promise a capability the canonical validator
// rejects (device binding, lockdown, IP restriction, random question
// selection, continuous monitoring) are NOT shipped.
//
// Truthfulness gate: every field in `defaults` MUST be a profile-safe
// dimension the engine actually enforces (the `ExamProfilePolicyDefaults`
// subset). Only recipes whose promises the runtime honors end-to-end are
// shipped; a recipe name must never promise a capability the canonical
// validator rejects (see `UNSUPPORTED_CONTROL_FLAGS` in
// `@exam/exam-engine` `validateExamPolicy`).
//
// Language-free: this module carries only a stable identity `key` plus the
// typed defaults. Display name/description live in the web i18n catalog
// (`admin.starterProfiles.*`), so `@exam/domain` never owns product copy.

import type { ExamProfilePolicyDefaults } from "./examProfile.js";

/**
 * Stable identity for a starter recipe. The UI maps this key to localized
 * display text. Adding a key is a product/truthfulness decision, not a code
 * refactor.
 */
export type StarterProfileRecipeKey = "basic_quiz" | "standard_online";

/**
 * A starter recipe: stable key + the profile-safe defaults it prefills.
 * `name`/`description` are intentionally absent — they live in i18n.
 * `readonly` is compile-time only: treat the shared recipe as immutable, it is
 * not runtime-frozen.
 */
export interface StarterProfileRecipe {
  readonly key: StarterProfileRecipeKey;
  readonly defaults: Readonly<ExamProfilePolicyDefaults>;
}

/**
 * The shipped starter recipes. Ordered as the UI should present them
 * (simplest → richest).
 *
 * These values were chosen as honest defaults over the SUPPORTED_AND_ENFORCED
 * policy dimensions only; see the product-reality audit in the closeout doc.
 */
export const STARTER_PROFILE_RECIPES: readonly StarterProfileRecipe[] = [
  {
    key: "basic_quiz",
    defaults: {
      timingMode: "timed_window",
      durationMinutes: 30,
      latestStartOffsetMinutes: null,
      minSubmitAfterStartMinutes: null,
      // "Single attempt" is an honest promise only as max_attempts + 1:
      // under `unlimited` the engine ignores maxAttempts and retakes freely.
      retakePolicy: "max_attempts",
      maxAttempts: 1,
      scoreStrategy: "highest",
      resultPublicationMode: "immediate",
      interruptionTimePolicy: "strict",
      interruptionGracePerIncidentSeconds: null,
      interruptionGracePerAttemptSeconds: null,
    },
  },
  {
    key: "standard_online",
    defaults: {
      timingMode: "timed_window",
      durationMinutes: 60,
      latestStartOffsetMinutes: 15,
      minSubmitAfterStartMinutes: 10,
      retakePolicy: "max_attempts",
      maxAttempts: 2,
      scoreStrategy: "highest",
      resultPublicationMode: "after_grading",
      interruptionTimePolicy: "bounded_grace",
      interruptionGracePerIncidentSeconds: 300,
      interruptionGracePerAttemptSeconds: 600,
    },
  },
] as const;

/**
 * Look up a starter recipe by key. Returns `null` if the key is unknown so the
 * UI can fail gracefully rather than guessing. Pure, total.
 */
export function findStarterRecipe(key: string): StarterProfileRecipe | null {
  return STARTER_PROFILE_RECIPES.find((recipe) => recipe.key === key) ?? null;
}
