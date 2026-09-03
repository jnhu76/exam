// ── P7-M1: canonical exam policy resolver + conflict validator ─────
//
// Authority: P7-M1 design (`docs/contracts/exam-policy-authority.md`).
//
// This module is the ONE canonical owner of cross-field exam-policy semantic
// validation (design §9, §10). It is:
//   - PURE: no DB, no time, no env, no Redis, no request context.
//   - DETERMINISTIC: same input ⇒ same output; does not mutate input.
// Resource-existence checks (question existence, standardAnswer/rubric
// presence, totalScore==sum) stay in `publishExam` orchestration — they need
// DB facts and are NOT policy semantics.
//
// The validator is called from create, update (draft), and publish (revalidate
// whole policy). Runtime (attempt/grading) does NOT re-run it — publish is the
// acceptance gate (design §34).

import type {
  ControlFlags,
  Exam,
  ExamPolicyConflict,
  InterruptionTimePolicy,
  ResolvedExamPolicy,
} from "@exam/domain";
import {
  ExamPolicyConflictCode,
  ValidationError,
  validateInterruptionPolicyCaps,
} from "@exam/domain";

/**
 * Project a published (or draft) Exam row into the typed resolved-policy value.
 *
 * This is a VALUE, not persistence. It normalizes the Exam row's optional
 * interruption fields (which are `?:` on the domain type) into the resolved
 * shape (defaulting to `strict` / `null` caps, matching
 * `normalizeInterruptionPolicyConfiguration` and the DB column defaults).
 *
 * P7-M2 will feed this same projection from `profile defaults + exam overrides`
 * — runtime consumers never depend on a mutable profile row.
 */
export function resolveExamPolicy(exam: Exam): ResolvedExamPolicy {
  const interruptionTimePolicy: InterruptionTimePolicy =
    exam.interruptionTimePolicy ?? "strict";
  return {
    timing: {
      timingMode: exam.timingMode,
      durationMinutes: exam.durationMinutes,
      openAt: exam.openAt,
      closeAt: exam.closeAt,
      latestStartOffsetMinutes: exam.latestStartOffsetMinutes,
      minSubmitAfterStartMinutes: exam.minSubmitAfterStartMinutes,
    },
    questions: {
      questionSelectionMode: exam.questionSelectionMode,
      questionIds: exam.questionIds,
    },
    attempt: {
      retakePolicy: exam.retakePolicy,
      maxAttempts: exam.maxAttempts,
      scoreStrategy: exam.scoreStrategy,
    },
    grading: {
      passingScore: exam.passingScore,
      totalScore: exam.totalScore,
    },
    results: {
      resultPublicationMode: exam.resultPublicationMode,
    },
    interruption: {
      interruptionTimePolicy,
      interruptionGracePerIncidentSeconds:
        exam.interruptionGracePerIncidentSeconds ?? null,
      interruptionGracePerAttemptSeconds:
        exam.interruptionGracePerAttemptSeconds ?? null,
    },
    control: {
      controlFlags: exam.controlFlags,
    },
  };
}

/**
 * Validate the cross-field semantic consistency of a resolved exam policy.
 *
 * Returns a list of structured conflict findings (empty ⇒ valid). Pure and
 * deterministic; does not throw on policy conflicts — callers decide whether
 * to throw `ValidationError` (authoring/publish) or treat as advisory.
 *
 * Owns the Phase A timing-mode matrix (#291): which (timingMode,
 * durationMinutes, closeAt, interruptionTimePolicy) combinations may be
 * persisted/published. This is the FINAL acceptance authority — Zod may
 * reject shapes early at the API boundary, but every create / draft-update /
 * publish path funnels through here.
 */
export function validateExamPolicy(
  policy: ResolvedExamPolicy,
): ExamPolicyConflict[] {
  const conflicts: ExamPolicyConflict[] = [];

  // ── Timing window: openAt must strictly precede closeAt (when present). ──
  // Null closeAt (untimed) has no window to invert.
  if (
    policy.timing.closeAt !== null &&
    policy.timing.openAt >= policy.timing.closeAt
  ) {
    conflicts.push({
      code: ExamPolicyConflictCode.ExamWindowInvalid,
      fields: ["openAt", "closeAt"],
      message: "Exam openAt must be before closeAt",
    });
  }

  // ── Phase A timing-mode matrix (#291). ──
  // One authority for mode legality; runtime (start/save/scanner) may rely on
  // these invariants for reachable published exams.
  conflicts.push(
    ...validateTimingModeMatrix(
      policy.timing,
      policy.interruption.interruptionTimePolicy,
    ),
  );

  // ── Passing score must not exceed total score. ──
  // Today this is checked in 4 drifting places; this is the canonical owner.
  // (publishExam additionally checks passingScore against the question-sum
  // totalScore at snapshot materialization — that resource-integrity check
  // stays in publishExam; this is the policy-semantic check.)
  if (policy.grading.passingScore > policy.grading.totalScore) {
    conflicts.push({
      code: ExamPolicyConflictCode.PassingScoreExceedsTotal,
      fields: ["passingScore", "totalScore"],
      message: "Passing score cannot exceed total score",
    });
  }

  // ── Retake policy / maxAttempts sanity. ──
  // `max_attempts` must carry a positive maxAttempts (the gate at
  // attemptCommands reads exam.maxAttempts; a nonsensical value is a real
  // conflict, not just shape — Zod only enforces maxAttempts >= 1).
  if (
    policy.attempt.retakePolicy === "max_attempts" &&
    !(policy.attempt.maxAttempts >= 1)
  ) {
    conflicts.push({
      code: ExamPolicyConflictCode.RetakeMaxAttemptsInvalid,
      fields: ["retakePolicy", "maxAttempts"],
      message: "retakePolicy 'max_attempts' requires maxAttempts >= 1",
    });
  }

  // ── Interruption policy cross-field rules (ADR-013). ──
  // strict/operator_incident ⇒ caps null; bounded_grace ⇒ both caps > 0;
  // per-incident <= per-attempt. Delegates to the SHARED leaf rule in
  // `@exam/domain` (`validateInterruptionPolicyCaps`) — the same semantics
  // the contracts-layer normalizer enforces at authoring, so publish
  // revalidation cannot drift from authoring (design §19).
  for (const finding of validateInterruptionPolicyCaps(
    policy.interruption.interruptionTimePolicy,
    policy.interruption.interruptionGracePerIncidentSeconds,
    policy.interruption.interruptionGracePerAttemptSeconds,
  )) {
    conflicts.push({
      code: ExamPolicyConflictCode.InterruptionPolicyCapsInvalid,
      fields:
        finding.capField === "perIncidentCapSeconds"
          ? ["interruptionGracePerIncidentSeconds"]
          : [
              "interruptionTimePolicy",
              "interruptionGracePerIncidentSeconds",
              "interruptionGracePerAttemptSeconds",
            ],
      message: finding.message,
    });
  }

  return conflicts;
}

/**
 * Convenience: resolve + validate an Exam row in one call. Returns conflicts.
 * Callers that need the resolved value separately should call the two steps.
 */
export function validateExamPolicyForExam(exam: Exam): ExamPolicyConflict[] {
  return validateExamPolicy(resolveExamPolicy(exam));
}

/**
 * Phase A timing-mode matrix (#291) — the ONE authority for which
 * (timingMode, durationMinutes, closeAt, interruptionTimePolicy) combinations
 * are legal. Pure; emits at most one `EXAM_TIMING_MODE_INVALID` conflict
 * naming every implicated field.
 *
 *   timed_window  duration > 0, closeAt present; interruption policies
 *                 unchanged (strict / bounded_grace / operator_incident)
 *   deadline      duration null (global cutoff, no personal time), closeAt
 *                 present, strict only — bounded_grace/operator_incident are
 *                 modelled around a personal attempt deadline and could
 *                 exceed the global closeAt
 *   untimed       duration null, closeAt null (open-ended), strict only —
 *                 there is no deadline to compensate
 *   timed_sync    rejected in Phase A: no admission/queue runtime exists
 */
function validateTimingModeMatrix(
  timing: ResolvedExamPolicy["timing"],
  interruptionTimePolicy: InterruptionTimePolicy,
): ExamPolicyConflict[] {
  const mode = timing.timingMode;

  const invalid = (fields: string[], message: string): ExamPolicyConflict[] => [
    { code: ExamPolicyConflictCode.ExamTimingModeInvalid, fields, message },
  ];

  if (mode === "timed_window") {
    if (timing.durationMinutes === null) {
      return invalid(
        ["timingMode", "durationMinutes"],
        "timed_window exams require a positive durationMinutes",
      );
    }
    if (timing.closeAt === null) {
      return invalid(
        ["timingMode", "closeAt"],
        "timed_window exams require closeAt",
      );
    }
    return [];
  }

  if (mode === "deadline") {
    if (timing.durationMinutes !== null) {
      return invalid(
        ["timingMode", "durationMinutes"],
        "deadline exams must not set durationMinutes",
      );
    }
    if (timing.closeAt === null) {
      return invalid(
        ["timingMode", "closeAt"],
        "deadline exams require closeAt",
      );
    }
    if (interruptionTimePolicy !== "strict") {
      return invalid(
        ["timingMode", "interruptionTimePolicy"],
        "deadline exams only support the strict interruption policy",
      );
    }
    return [];
  }

  if (mode === "untimed") {
    if (timing.durationMinutes !== null) {
      return invalid(
        ["timingMode", "durationMinutes"],
        "untimed exams must not set durationMinutes",
      );
    }
    if (timing.closeAt !== null) {
      return invalid(
        ["timingMode", "closeAt"],
        "untimed exams must not set closeAt",
      );
    }
    if (interruptionTimePolicy !== "strict") {
      return invalid(
        ["timingMode", "interruptionTimePolicy"],
        "untimed exams only support the strict interruption policy",
      );
    }
    return [];
  }

  // timed_sync — latent until the #292 admission/queue runtime exists.
  return invalid(["timingMode"], "timed_sync is not supported yet");
}

/**
 * Throw a `ValidationError` carrying structured field details if the resolved
 * policy has any cross-field conflicts. Used by publish (the freeze/acceptance
 * gate) and may be used by authoring paths. No-op when the policy is valid.
 *
 * The thrown `details` shape mirrors the route-layer field-error envelope
 * (`{ fields: [{ field, code, message }] }`) so route adapters can pass it
 * through without re-deriving.
 */
export function assertExamPolicyValid(exam: Exam): void {
  const conflicts = validateExamPolicyForExam(exam);
  const first = conflicts[0];
  if (!first) return;
  throw new ValidationError(first.message, {
    fields: conflicts.map((c) => ({
      field: c.fields[0] ?? "exam",
      code: c.code,
      message: c.message,
    })),
  });
}

/**
 * Input shape for route-layer policy validation: the merged cross-field values
 * (create: full defaults-applied input; update: `{...existing, ...patch}` after
 * normalization). Carries the FULL resolved-policy values — including
 * questionIds and controlFlags — so the validator runs on exactly the policy
 * the persistence layer will see (design §21). Identity/resource/timestamp
 * fields are intentionally absent.
 */
export interface ExamPolicyInput {
  timingMode: Exam["timingMode"];
  durationMinutes: number | null;
  openAt: Date;
  closeAt: Date | null;
  latestStartOffsetMinutes: number | null;
  minSubmitAfterStartMinutes: number | null;
  questionSelectionMode: Exam["questionSelectionMode"];
  questionIds: string[];
  retakePolicy: Exam["retakePolicy"];
  maxAttempts: number;
  scoreStrategy: Exam["scoreStrategy"];
  passingScore: number;
  totalScore: number;
  resultPublicationMode: Exam["resultPublicationMode"];
  interruptionTimePolicy: InterruptionTimePolicy;
  interruptionGracePerIncidentSeconds: number | null;
  interruptionGracePerAttemptSeconds: number | null;
  controlFlags: ControlFlags;
}

/**
 * Validate a merged policy input (route-layer convenience). Returns conflicts.
 * Equivalent to `validateExamPolicy(resolveExamPolicy(exam))` but takes the
 * already-merged route values directly, avoiding the construction of a throwaway
 * full `Exam` object.
 */
export function validateExamPolicyInput(
  input: ExamPolicyInput,
): ExamPolicyConflict[] {
  return validateExamPolicy({
    timing: {
      timingMode: input.timingMode,
      durationMinutes: input.durationMinutes,
      openAt: input.openAt,
      closeAt: input.closeAt,
      latestStartOffsetMinutes: input.latestStartOffsetMinutes,
      minSubmitAfterStartMinutes: input.minSubmitAfterStartMinutes,
    },
    questions: {
      questionSelectionMode: input.questionSelectionMode,
      questionIds: input.questionIds,
    },
    attempt: {
      retakePolicy: input.retakePolicy,
      maxAttempts: input.maxAttempts,
      scoreStrategy: input.scoreStrategy,
    },
    grading: {
      passingScore: input.passingScore,
      totalScore: input.totalScore,
    },
    results: { resultPublicationMode: input.resultPublicationMode },
    interruption: {
      interruptionTimePolicy: input.interruptionTimePolicy,
      interruptionGracePerIncidentSeconds:
        input.interruptionGracePerIncidentSeconds,
      interruptionGracePerAttemptSeconds:
        input.interruptionGracePerAttemptSeconds,
    },
    control: {
      controlFlags: input.controlFlags,
    },
  });
}

/**
 * Throw `ValidationError` if the merged route-layer policy input has cross-field
 * conflicts. Route-layer counterpart of `assertExamPolicyValid` (which takes an
 * `Exam`). Used by create and draft-update paths so authoring rejects invalid
 * combinations early, before publish.
 */
export function assertExamPolicyInputValid(input: ExamPolicyInput): void {
  const conflicts = validateExamPolicyInput(input);
  const first = conflicts[0];
  if (!first) return;
  throw new ValidationError(first.message, {
    fields: conflicts.map((c) => ({
      field: c.fields[0] ?? "exam",
      code: c.code,
      message: c.message,
    })),
  });
}
