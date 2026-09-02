// ── P7-M1: Resolved Exam Policy (typed value) ──────────────────────
//
// A typed semantic projection of the published Exam row's policy fields.
// This is a VALUE, not persistence (P7-M1 design §8, §14: existing typed
// `exams` columns remain the authority; no `resolved_policy` jsonb column).
//
// The resolver (`resolveExamPolicy`) and the canonical cross-field validator
// (`validateExamPolicy`) live in `@exam/exam-engine`. This module owns only
// the policy value types and the stable conflict-identifier codes so they can
// be consumed by engine, routes, and tests without a back-dependency.
//
// Groups reflect real current semantic ownership — not the future P7-M2
// dimension wishlist. Empty future abstractions are intentionally absent.

import type {
  QuestionSelectionMode,
  ResultPublicationMode,
  RetakePolicy,
  ScoreStrategy,
  TimingMode,
} from "./enums.js";
import type { ControlFlags, InterruptionTimePolicy } from "./types.js";

/**
 * Timing + schedule policy. Phase A supports `timed_window`, `deadline` and
 * `untimed`; `timed_sync` stays a latent enum value rejected by the canonical
 * validator until the admission/queue runtime exists. `durationMinutes` is
 * null for modes without a personal duration (deadline/untimed); `closeAt`
 * is null only for `untimed`.
 */
export interface TimingPolicy {
  timingMode: TimingMode;
  durationMinutes: number | null;
  openAt: Date;
  closeAt: Date | null;
  latestStartOffsetMinutes: number | null;
  minSubmitAfterStartMinutes: number | null;
}

/**
 * Question selection policy. `manual` is the only supported mode in Phase 1.
 */
export interface QuestionSelectionPolicy {
  questionSelectionMode: QuestionSelectionMode;
  questionIds: string[];
}

/**
 * Attempt/retake policy. Spans Exam + Enrollment semantics (selects among
 * multiple attempts), so this is published-row authority, not attempt-local.
 */
export interface AttemptPolicy {
  retakePolicy: RetakePolicy;
  maxAttempts: number;
  scoreStrategy: ScoreStrategy;
}

/**
 * Grading policy. Published-row authority (grading reads `exam.passingScore`).
 */
export interface GradingPolicy {
  passingScore: number;
  totalScore: number;
}

/**
 * Result visibility policy. Published-row authority (candidate result view
 * reads `exam.resultPublicationMode` live).
 */
export interface ResultPublicationPolicy {
  resultPublicationMode: ResultPublicationMode;
}

/**
 * Interruption time-compensation policy. This is the ONE policy family that
 * IS frozen into the attempt (ADR-013), but the resolved value here is the
 * Exam-row authority from which the attempt snapshot is derived at creation.
 */
export interface InterruptionPolicy {
  interruptionTimePolicy: InterruptionTimePolicy;
  interruptionGracePerIncidentSeconds: number | null;
  interruptionGracePerAttemptSeconds: number | null;
}

/**
 * Control flags. P7-M1 does NOT refactor these into typed columns. Most flags
 * are latent/unenforced today (see P7-M1 design §13); they are carried through
 * as-is so the validator does not invent rules for unimplemented dimensions.
 */
export interface ControlFlagPolicy {
  controlFlags: ControlFlags;
}

/**
 * The resolved policy value — a typed projection of the published Exam row.
 *
 * NOT persistence. Produced by `resolveExamPolicy(exam)` and consumed by the
 * canonical validator. Provides the P7-M2 seam (profile defaults + exam
 * overrides → resolve → validate → publish) without making runtime consumers
 * depend on mutable profile rows.
 */
export interface ResolvedExamPolicy {
  timing: TimingPolicy;
  questions: QuestionSelectionPolicy;
  attempt: AttemptPolicy;
  grading: GradingPolicy;
  results: ResultPublicationPolicy;
  interruption: InterruptionPolicy;
  control: ControlFlagPolicy;
}

/**
 * Stable, machine-testable conflict identifiers emitted by the canonical
 * validator. Kept domain-internal initially (no public HTTP contract beyond
 * the existing `VALIDATION_ERROR` envelope); routes map these to field errors.
 *
 * Only supported current conflicts are modelled — no codes for unimplemented
 * P7-M2+ dimensions (device binding, admission queue, etc.).
 */
export const ExamPolicyConflictCode = {
  ExamWindowInvalid: "EXAM_WINDOW_INVALID",
  ExamTimingModeInvalid: "EXAM_TIMING_MODE_INVALID",
  PassingScoreExceedsTotal: "PASSING_SCORE_EXCEEDS_TOTAL",
  RetakeMaxAttemptsInvalid: "RETAKE_MAX_ATTEMPTS_INVALID",
  InterruptionPolicyCapsInvalid: "INVALID_INTERRUPTION_POLICY",
} as const;

export type ExamPolicyConflictCode =
  (typeof ExamPolicyConflictCode)[keyof typeof ExamPolicyConflictCode];

/**
 * One structured policy-conflict finding. `fields` are the Exam authoring
 * field names the conflict involves (e.g. ["openAt","closeAt"]), so route
 * adapters can map them to HTTP field errors without re-deriving.
 */
export interface ExamPolicyConflict {
  code: ExamPolicyConflictCode;
  fields: string[];
  message: string;
}

/**
 * A finding from the shared interruption-caps leaf rule. `capField` names the
 * implicated input key so callers can map it onto their own error shape (Zod
 * issue path vs ExamPolicyConflict fields); null means a policy-level finding.
 */
export interface InterruptionCapConflict {
  capField: "perIncidentCapSeconds" | "perAttemptAggregateCapSeconds" | null;
  message: string;
}

/**
 * Shared leaf rule for interruption-policy caps (ADR-013).
 *
 * ONE semantic source for the caps cross-field rules, used by BOTH:
 *  - `contracts/interruption.ts` `validatePolicyCaps` (authoring normalizer),
 *    and
 *  - `exam-engine/examPolicy.ts` (canonical validator, incl. publish
 *    revalidation, which the contracts layer does not reach).
 *
 * Pure and deterministic. Lives here (the leaf package) so both consumers
 * share the semantics instead of "mirroring" each other.
 */
export function validateInterruptionPolicyCaps(
  policy: InterruptionTimePolicy,
  perIncidentCapSeconds: number | null,
  perAttemptAggregateCapSeconds: number | null,
): InterruptionCapConflict[] {
  if (policy !== "bounded_grace") {
    if (
      perIncidentCapSeconds !== null ||
      perAttemptAggregateCapSeconds !== null
    ) {
      return [
        {
          capField: null,
          message: "strict and operator_incident policies require null caps",
        },
      ];
    }
    return [];
  }

  // bounded_grace
  if (
    perIncidentCapSeconds === null ||
    perAttemptAggregateCapSeconds === null
  ) {
    return [{ capField: null, message: "bounded_grace requires both caps" }];
  }
  if (perIncidentCapSeconds <= 0 || perAttemptAggregateCapSeconds <= 0) {
    return [{ capField: null, message: "bounded_grace caps must be positive" }];
  }
  if (perIncidentCapSeconds > perAttemptAggregateCapSeconds) {
    return [
      {
        capField: "perIncidentCapSeconds",
        message: "per-incident cap cannot exceed the aggregate cap",
      },
    ];
  }
  return [];
}
