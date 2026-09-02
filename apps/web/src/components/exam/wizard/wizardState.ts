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
import { buildExplicitOverridesPayload } from "@/lib/wizardPolicyPreview";

/** Code defaults mirroring the contract's canonical CreateExamRequest defaults. */
export const WIZARD_CODE_DEFAULTS: ExamProfilePolicyDefaults = {
  timingMode: "timed_window",
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
 * offset/cap fields, and is preserved. The value type binds to the selected
 * field, so a non-nullable field (e.g. durationMinutes) rejects `null` at
 * compile time.
 */
export function setOverride<K extends keyof ExamProfilePolicyDefaults>(
  state: WizardState,
  field: K,
  value: ExamProfilePolicyDefaults[K],
): WizardState {
  return {
    ...state,
    overrides: { ...state.overrides, [field]: value },
  };
}

/**
 * Set the interruption policy override ATOMICALLY. Leaving `bounded_grace`
 * (strict / operator_incident) also writes explicit `null` for both grace
 * caps, so profile-supplied caps cannot survive into a policy that forbids
 * them (ADR-013 / M1 INVALID_INTERRUPTION_POLICY). This mirrors the
 * ExamProfileEditPage semantics for the same transition.
 */
export function setInterruptionPolicyOverride(
  state: WizardState,
  value: ExamProfilePolicyDefaults["interruptionTimePolicy"],
): WizardState {
  if (value === "bounded_grace") {
    return setOverride(state, "interruptionTimePolicy", value);
  }
  return {
    ...state,
    overrides: {
      ...state.overrides,
      interruptionTimePolicy: value,
      interruptionGracePerIncidentSeconds: null,
      interruptionGracePerAttemptSeconds: null,
    },
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
 * `durationMinutes` follows the same wire rule: an explicit override is always
 * sent; with a profile and no override it is OMITTED (backend applies the
 * profile value); only the no-profile path sends the code default. The code
 * default must never overwrite a profile value (explicit > profile > default).
 *
 * The schedule is a required user decision — missing openAt/closeAt FAILS
 * CLOSED instead of silently inventing "now" / "now + 24h" authority.
 *
 * Per M2 P2-1: when a profile supplies resultPublicationMode, the wizard does
 * NOT send controlFlags.showResultImmediately (it sends no controlFlags at
 * all — control flags are not part of the supported policy surface).
 */
export function buildCreateExamPayload(
  state: WizardState,
  resolved: ExamProfilePolicyDefaults = WIZARD_CODE_DEFAULTS,
): Record<string, unknown> {
  // Resolved timing mode (override > profile > code default) decides which
  // schedule/duration fields are legal on the wire (Phase A2 (Issue 291)).
  const untimed = resolved.timingMode === "untimed";
  if (!state.openAt || (!state.closeAt && !untimed)) {
    throw new Error(
      "Exam schedule (openAt/closeAt) is required before creating an exam",
    );
  }
  const payload: Record<string, unknown> = {
    title: state.title.trim(),
    description: state.description,
    courseId: state.courseId,
    timingMode: resolved.timingMode,
    questionSelectionMode: "manual",
    openAt: new Date(state.openAt).toISOString(),
    // Untimed is open-ended: explicit semantic null, never a fabricated date.
    closeAt:
      untimed || !state.closeAt ? null : new Date(state.closeAt).toISOString(),
    passingScore: state.passingScore,
    totalScore: state.totalScore,
    questionIds: state.questionIds,
  };
  if (state.profileId) {
    payload.profileId = state.profileId;
  }
  if (resolved.timingMode === "timed_window") {
    const duration = resolveOverrideOrPlaceholder(state, "durationMinutes");
    if (duration !== undefined) {
      payload.durationMinutes = duration;
    } else if (!state.profileId) {
      payload.durationMinutes = WIZARD_CODE_DEFAULTS.durationMinutes;
    }
  } else {
    // deadline/untimed: explicit semantic null. Omitting would let a profile
    // duration survive into an illegal combination (M2 wire rule §161).
    payload.durationMinutes = null;
  }
  // Send ONLY the explicit overrides (own keys, preserving null) via the
  // shared wire-faithful helper. Absent keys are omitted so the backend
  // applies the profile (or code default). timingMode/durationMinutes above
  // are already resolved — drop override keys that would double-write them.
  const {
    timingMode: _timingMode,
    durationMinutes: _duration,
    ...restOverrides
  } = state.overrides;
  void _timingMode;
  void _duration;
  Object.assign(payload, buildExplicitOverridesPayload(restOverrides));
  return payload;
}

/**
 * Helper: returns the explicit override value for a field if present, else
 * undefined (meaning "inherit profile/code default"). The value type binds to
 * the selected field. Used only by buildCreateExamPayload to supply
 * durationMinutes as a top-level field for the no-profile path; the backend
 * re-resolves everything anyway.
 */
function resolveOverrideOrPlaceholder<
  K extends keyof ExamProfilePolicyDefaults,
>(state: WizardState, field: K): ExamProfilePolicyDefaults[K] | undefined {
  if (Object.prototype.hasOwnProperty.call(state.overrides, field)) {
    return state.overrides[field];
  }
  return undefined;
}
