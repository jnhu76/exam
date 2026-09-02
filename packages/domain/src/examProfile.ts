// ── P7-M2: exam policy profile defaults (typed authoring template) ──
//
// Authority: P7-M2 design (`docs/audits/P7-M2-PROFILE-TEMPLATES-AND-RESOLUTION.md`).
//
// An exam policy profile is an editable, organization-owned AUTHORING
// convenience: a reusable subset of exam-policy defaults that may be applied
// while creating an exam. It is deliberately NOT execution authority — the
// created exam materializes concrete typed columns (copy-on-apply) and never
// reads a profile again. Runtime (attempt start, answer save, heartbeat,
// grading, results) must never load a profile.
//
// This module owns ONLY the profile value types and the pure apply resolver.
// Profile persistence lives in `@exam/db`, CRUD contracts in `@exam/contracts`,
// and the CRUD API in `apps/api`. `ResolvedExamPolicy` (exam-engine) remains
// the complete policy projection of an actual Exam row — this
// `ExamProfilePolicyDefaults` is the smaller reusable subset a profile may
// supply during authoring. The two concepts must not be collapsed.

import type {
  AuthoringTimingMode,
  ResultPublicationMode,
  ScoreStrategy,
} from "./enums.js";
import type { InterruptionTimePolicy } from "./types.js";

/**
 * Phase-1 retake policies only. `daily_limit` / `weekly_limit` exist in the
 * domain enum but are blocked at the contract layer; a profile must not
 * promise values the runtime cannot honor.
 */
export type ExamProfileRetakePolicy =
  | "unlimited"
  | "max_attempts"
  | "pass_then_stop";

/** Alias for persistence layers: profiles carry only the authoring modes. */
export type ExamProfileTimingMode = AuthoringTimingMode;

/**
 * The reusable policy subset a profile may supply during authoring.
 *
 * NOT `ResolvedExamPolicy`: profiles have no schedule, no scores, no question
 * selection, no control flags — those are either exam-instance-specific or
 * latent/unenforced dimensions (see the M2 design §5/§6).
 */
export interface ExamProfilePolicyDefaults {
  // Phase A (#291): the timing mode is a copied default. Profiles may carry
  // only the authoring modes (never `timed_sync`); `durationMinutes` is null
  // for deadline/untimed profiles and the copy-on-apply semantics below make
  // that null overwrite a stale target value.
  timingMode: AuthoringTimingMode;
  durationMinutes: number | null;
  latestStartOffsetMinutes: number | null;
  minSubmitAfterStartMinutes: number | null;
  retakePolicy: ExamProfileRetakePolicy;
  maxAttempts: number;
  scoreStrategy: ScoreStrategy;
  resultPublicationMode: ResultPublicationMode;
  interruptionTimePolicy: InterruptionTimePolicy;
  interruptionGracePerIncidentSeconds: number | null;
  interruptionGracePerAttemptSeconds: number | null;
}

/**
 * A persisted exam policy profile row: identity + the typed defaults.
 * Flat shape mirrors the `exam_policy_profiles` table columns.
 */
export interface ExamProfile extends ExamProfilePolicyDefaults {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Pure apply resolver (M2 design §18): overlay explicit Exam-authoring values
 * onto a profile's defaults, preserving explicit `null`.
 *
 * Precedence: explicit authoring value > profile value. Code defaults are NOT
 * part of this resolver — the no-profile path keeps the existing contract
 * schema defaults untouched, and the route feeds only RAW-present authoring
 * values in `explicitOverrides` (so a Zod-inserted default can never defeat a
 * profile default; design §20).
 *
 * Critical patch rule: `undefined` = no explicit override; `null` = explicit
 * semantic value. Every field uses `!== undefined` — never `??`, which would
 * erase an explicit null (the M1 `null ?? oldValue` bug class).
 */
export function applyExamProfileDefaults(
  profileDefaults: ExamProfilePolicyDefaults,
  explicitOverrides: Partial<ExamProfilePolicyDefaults>,
): ExamProfilePolicyDefaults {
  return {
    timingMode:
      explicitOverrides.timingMode !== undefined
        ? explicitOverrides.timingMode
        : profileDefaults.timingMode,
    durationMinutes:
      explicitOverrides.durationMinutes !== undefined
        ? explicitOverrides.durationMinutes
        : profileDefaults.durationMinutes,
    latestStartOffsetMinutes:
      explicitOverrides.latestStartOffsetMinutes !== undefined
        ? explicitOverrides.latestStartOffsetMinutes
        : profileDefaults.latestStartOffsetMinutes,
    minSubmitAfterStartMinutes:
      explicitOverrides.minSubmitAfterStartMinutes !== undefined
        ? explicitOverrides.minSubmitAfterStartMinutes
        : profileDefaults.minSubmitAfterStartMinutes,
    retakePolicy:
      explicitOverrides.retakePolicy !== undefined
        ? explicitOverrides.retakePolicy
        : profileDefaults.retakePolicy,
    maxAttempts:
      explicitOverrides.maxAttempts !== undefined
        ? explicitOverrides.maxAttempts
        : profileDefaults.maxAttempts,
    scoreStrategy:
      explicitOverrides.scoreStrategy !== undefined
        ? explicitOverrides.scoreStrategy
        : profileDefaults.scoreStrategy,
    resultPublicationMode:
      explicitOverrides.resultPublicationMode !== undefined
        ? explicitOverrides.resultPublicationMode
        : profileDefaults.resultPublicationMode,
    interruptionTimePolicy:
      explicitOverrides.interruptionTimePolicy !== undefined
        ? explicitOverrides.interruptionTimePolicy
        : profileDefaults.interruptionTimePolicy,
    interruptionGracePerIncidentSeconds:
      explicitOverrides.interruptionGracePerIncidentSeconds !== undefined
        ? explicitOverrides.interruptionGracePerIncidentSeconds
        : profileDefaults.interruptionGracePerIncidentSeconds,
    interruptionGracePerAttemptSeconds:
      explicitOverrides.interruptionGracePerAttemptSeconds !== undefined
        ? explicitOverrides.interruptionGracePerAttemptSeconds
        : profileDefaults.interruptionGracePerAttemptSeconds,
  };
}
