// ── P7-M: wizard resolved-policy preview (THIN WRAPPER, NO MIRROR) ──
//
// Authority: the user's P7-M review decision — the frontend MUST NOT
// re-implement profile resolution precedence. We reuse the pure domain
// resolver `applyExamProfileDefaults` from `@exam/domain` for BOTH the
// backend create path and this frontend preview, so the two cannot drift.
//
// This module is a thin adapter: it locates the selected profile, calls the
// domain resolver with the wizard's explicit overrides, and returns the
// resolved defaults plus per-field "source" provenance for display. It owns
// NO precedence logic of its own.
//
// State authority in the wizard is a SINGLE `overrides` object:
//   - property absent        → inherit from selected profile (or code default
//                              when no profile is selected)
//   - property present (any) → explicit override; explicit `null` is a real
//                              semantic value ("disabled") and is preserved
// This mirrors the M2 route's `rawBody[field] !== undefined` contract exactly.

import {
  applyExamProfileDefaults,
  type ExamProfilePolicyDefaults,
} from "@exam/domain";

/** A profile row shape sufficient for preview resolution. */
export interface WizardProfileLike {
  id: string;
  name: string;
  defaults: ExamProfilePolicyDefaults;
}

/**
 * Where a resolved field's value came from. Used only for UI provenance
 * badges (来自模板 / 已自定义). NEVER persisted; NEVER submitted to the API.
 */
export type WizardFieldSource = "profile" | "override";

/** Per-field resolution result for display. */
export interface WizardPolicyPreview {
  /** Fully resolved policy (profile + overrides applied). */
  resolved: ExamProfilePolicyDefaults;
  /** Per-field source provenance for UI badges. */
  sources: Record<keyof ExamProfilePolicyDefaults, WizardFieldSource>;
  /** The profile name used for "来自「…」" badges, or null if no profile. */
  profileName: string | null;
}

/** The set of profile-safe fields, for iteration. */
export const PROFILE_POLICY_FIELDS = [
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
] as const satisfies readonly (keyof ExamProfilePolicyDefaults)[];

/**
 * Build the resolved-policy preview by delegating precedence to the domain
 * resolver. `overrides` uses single-state authority: a present key (incl.
 * explicit `null`) is an override; an absent key inherits the profile.
 *
 * When `profile` is null, the preview falls back to a baseline built from the
 * supplied code defaults (so the UI still has something to show); in that
 * case every field's source is "override" only if explicitly overridden,
 * otherwise it reflects the code default.
 */
export function buildWizardPolicyPreview(args: {
  profile: WizardProfileLike | null;
  overrides: Partial<ExamProfilePolicyDefaults>;
  /** Code defaults used when no profile is selected (mirror of contract defaults). */
  codeDefaults: ExamProfilePolicyDefaults;
}): WizardPolicyPreview {
  const { profile, overrides, codeDefaults } = args;

  // Delegate precedence to the domain resolver. When a profile is selected,
  // applyExamProfileDefaults(profile.defaults, overrides) yields the exact
  // resolution the backend will compute at POST /api/exams time (minus
  // code-default fill-in for still-undefined fields, which the backend does
  // during canonical re-parse).
  const base: ExamProfilePolicyDefaults = profile
    ? applyExamProfileDefaults(profile.defaults, overrides)
    : applyExamProfileDefaults(codeDefaults, overrides);

  const sources = {} as Record<
    keyof ExamProfilePolicyDefaults,
    WizardFieldSource
  >;
  for (const field of PROFILE_POLICY_FIELDS) {
    // An explicitly-overridden field (present in overrides, incl. null) is
    // "override"; otherwise it comes from the profile (or code default).
    sources[field] = Object.prototype.hasOwnProperty.call(overrides, field)
      ? "override"
      : profile
        ? "profile"
        : "override";
  }

  return {
    resolved: base,
    sources,
    profileName: profile ? profile.name : null,
  };
}

/**
 * Build the explicit-override payload to send in the final POST /api/exams.
 * Returns ONLY the keys the user explicitly set (present in `overrides`),
 * preserving explicit `null`. Absent keys are omitted so the backend applies
 * the profile default. This is the wire-faithful subset of `overrides`.
 */
export function buildExplicitOverridesPayload(
  overrides: Partial<ExamProfilePolicyDefaults>,
): Partial<ExamProfilePolicyDefaults> {
  const payload: Partial<ExamProfilePolicyDefaults> = {};
  for (const field of PROFILE_POLICY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(overrides, field)) {
      // Preserve explicit values INCLUDING null; never coerce.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload as any)[field] = overrides[field];
    }
  }
  return payload;
}

/**
 * Whether a given field is explicitly overridden (present in `overrides`,
 * including explicit `null`). Use this to decide whether to show the
 * "恢复模板值" affordance.
 */
export function isOverridden(
  overrides: Partial<ExamProfilePolicyDefaults>,
  field: keyof ExamProfilePolicyDefaults,
): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, field);
}
