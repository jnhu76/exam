// ── P7-M: starter exam profile recipes (truthful authoring defaults) ──
//
// Authority: P7-M closeout (`docs/audits/P7-M-CONFIGURABLE-EXAM-MODES-CLOSEOUT.md`).
//
// A starter recipe is a RECOMMENDED AUTHORING DEFAULT only. It is NOT runtime
// authority, NOT a second profile kind, and NOT a special id. The UI offers
// these as "from starter template" affordances: selecting one prefills the
// ordinary profile editor; the user then saves an everyday organization-owned
// profile row via POST /api/exam-profiles. No runtime code may branch on
// `key`.
//
// Truthfulness gate (P7-M task §4/§14): every field in `defaults` MUST be a
// profile-safe dimension the engine actually enforces today (the
// `ExamProfilePolicyDefaults` subset). We deliberately ship only the two
// recipes whose promises the current runtime honors end-to-end:
//
//   basic_quiz       — single attempt, immediate publish, strict interruption
//   standard_online  — retake allowed, highest score, after-grading publish,
//                       bounded interruption grace
//
// `Controlled` / `Strict` profiles are intentionally NOT shipped: their
// promised capabilities (queue admission, device binding, lockdown, IP
// restriction, randomization, continuous monitoring) are unimplemented today
// and would make the recipe names dishonest. See the closeout doc §10.
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
 */
export interface StarterProfileRecipe {
  key: StarterProfileRecipeKey;
  defaults: ExamProfilePolicyDefaults;
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
      durationMinutes: 30,
      latestStartOffsetMinutes: null,
      minSubmitAfterStartMinutes: null,
      retakePolicy: "unlimited",
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
