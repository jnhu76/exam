// ── P7-M: exam creation wizard state (single overrides authority) ──
//
// Authority: user review decision — single-state `overrides` authority, no
// parallel explicitNulls Set. Property absent ⇒ inherit selected profile
// (or code default when no profile). Property present (incl. explicit null) ⇒
// explicit override. This mirrors the M2 route's `rawBody[field] !==
// undefined` contract byte-for-byte.
//
// The preview reuses `applyExamProfileDefaults` from `@exam/domain` via
// `buildWizardPolicyPreview` — the frontend NEVER re-implements precedence.

import type { ExamProfilePolicyDefaults } from "@exam/domain";

/** Code defaults mirroring the contract's canonical CreateExamRequest defaults. */
export const WIZARD_CODE_DEFAULTS: ExamProfilePolicyDefaults = {
  durationMinutes: 60,
  latestStartOffsetMinutes: null,
  minSubmitAfterStartMinutes: null,
  retakePolicy: "unlimited",
  maxAttempts: 1,
  scoreStrategy: "highest",
  resultPublicationMode: "immediate",
  interruptionTimePolicy: "strict",
  interruptionGracePerIncidentSeconds: null,
  interruptionGracePerAttemptSeconds: null,
};

/** Wizard step index (1-based for display). */
export type WizardStep = 1 | 2 | 3 | 4 | 5;

/** Total step count. */
export const WIZARD_TOTAL_STEPS = 5;

/**
 * The wizard's complete client state. `overrides` is the single authority for
 * policy fields: a key's presence (incl. explicit null) is an override; its
 * absence means inherit the selected profile (or code default if no profile).
 *
 * Instance-specific fields (title/description/course/schedule/questions/score)
 * live in separate named slots — they are never profile-owned.
 */
export interface WizardState {
  step: WizardStep;
  profileId: string | null;
  overrides: Partial<ExamProfilePolicyDefaults>;
  // Instance-specific fields (never profile-owned):
  title: string;
  description: string;
  courseId: string;
  openAt: string;
  closeAt: string;
  totalScore: number;
  passingScore: number;
  questionIds: string[];
}

/** Initial wizard state. */
export function initialWizardState(): WizardState {
  return {
    step: 1,
    profileId: null,
    overrides: {},
    title: "",
    description: "",
    courseId: "",
    openAt: "",
    closeAt: "",
    totalScore: 100,
    passingScore: 60,
    questionIds: [],
  };
}

/**
 * Set an explicit override for a policy field. To "clear" an override (revert
 * to inheriting the profile), call clearOverride instead — never set undefined
 * here, because that would erase the distinction the contract depends on.
 *
 * Explicit `null` is a real semantic value ("disabled") for the nullable
 * offset/cap fields, and is preserved.
 */
export function setOverride(
  state: WizardState,
  field: keyof ExamProfilePolicyDefaults,
  value: ExamProfilePolicyDefaults[typeof field] | null,
): WizardState {
  return {
    ...state,
    overrides: { ...state.overrides, [field]: value },
  };
}

/**
 * Remove an explicit override so the field inherits the selected profile (or
 * code default) again. This is the "恢复模板值" affordance.
 */
export function clearOverride(
  state: WizardState,
  field: keyof ExamProfilePolicyDefaults,
): WizardState {
  const next = { ...state.overrides };
  delete next[field];
  return { ...state, overrides: next };
}

/**
 * Selecting a profile preserves existing overrides (the user may have already
 * customized fields before choosing a profile). Per-field resolution then
 * flows: explicit override > profile > code default.
 */
export function selectProfile(
  state: WizardState,
  profileId: string | null,
): WizardState {
  return { ...state, profileId };
}

/** Move to a specific step (clamped to [1, WIZARD_TOTAL_STEPS]). */
export function goToStep(state: WizardState, step: number): WizardState {
  const clamped = Math.max(1, Math.min(WIZARD_TOTAL_STEPS, step));
  return { ...state, step: clamped as WizardStep };
}

/**
 * Build the final POST /api/exams payload from wizard state. Sends:
 *   - instance fields (title/description/course/schedule/score/questions)
 *   - profileId (if set)
 *   - ONLY the explicit overrides (own keys of `overrides`, preserving null)
 *
 * Omitted overrides are NOT sent, so the backend applies the profile default.
 * This is the wire-faithful subset — the server re-resolves canonically.
 *
 * Per M2 P2-1: when a profile supplies resultPublicationMode, the wizard does
 * NOT send controlFlags.showResultImmediately (it sends no controlFlags at
 * all — control flags are not part of the supported policy surface).
 */
export function buildCreateExamPayload(
  state: WizardState,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: state.title.trim(),
    description: state.description,
    courseId: state.courseId,
    timingMode: "timed_window",
    questionSelectionMode: "manual",
    durationMinutes:
      resolveOverrideOrPlaceholder(state, "durationMinutes") ??
      WIZARD_CODE_DEFAULTS.durationMinutes,
    openAt: state.openAt
      ? new Date(state.openAt).toISOString()
      : new Date().toISOString(),
    closeAt: state.closeAt
      ? new Date(state.closeAt).toISOString()
      : new Date(Date.now() + 86400000).toISOString(),
    passingScore: state.passingScore,
    totalScore: state.totalScore,
    questionIds: state.questionIds,
  };
  if (state.profileId) {
    payload.profileId = state.profileId;
  }
  // Send ONLY explicit overrides (own keys), preserving null. Absent keys are
  // omitted so the backend applies the profile (or code default).
  for (const field of Object.keys(state.overrides) as Array<
    keyof ExamProfilePolicyDefaults
  >) {
    if (Object.prototype.hasOwnProperty.call(state.overrides, field)) {
      payload[field] = state.overrides[field];
    }
  }
  return payload;
}

/**
 * Helper: returns the explicit override value for a field if present, else
 * undefined (meaning "inherit profile/code default"). Used only by
 * buildCreateExamPayload to supply durationMinutes as a top-level field for
 * the no-profile path; the backend re-resolves everything anyway.
 */
function resolveOverrideOrPlaceholder(
  state: WizardState,
  field: keyof ExamProfilePolicyDefaults,
): ExamProfilePolicyDefaults[typeof field] | undefined {
  if (Object.prototype.hasOwnProperty.call(state.overrides, field)) {
    return state.overrides[field];
  }
  return undefined;
}
