// ── P7-M: human-readable summary of an exam policy profile ──
//
// Pure formatter. Produces a concise, author-friendly one-line summary of a
// profile (or any ExamProfilePolicyDefaults-shaped value), e.g.:
//   "60 分钟 · 最晚进入 15 分钟 · 最多 2 次 · 取最高分 · 阅卷完成后公布 · 断线有限补时"
//
// Used by: profile list row, wizard resolved-policy preview, wizard review.
// It carries NO policy authority — it only renders values that already exist.
//
// To stay testable and i18n-coupling-free, the formatter takes a label source
// (`ProfileSummaryLabels`) the caller resolves from i18n at the call site.

import type { ExamProfilePolicyDefaults } from "@exam/domain";

/**
 * Localized labels the summary formatter needs. The caller resolves these
 * from the i18n catalog (e.g. `t("admin.examProfilePages.enumLabels.*")`) and
 * passes them in, keeping this module pure and free of i18next coupling.
 */
export interface ProfileSummaryLabels {
  durationMinutes: (m: number) => string;
  latestStart: (m: number) => string;
  minSubmit: (m: number) => string;
  retake: {
    unlimited: string;
    maxAttempts: (n: number) => string;
    passThenStop: string;
  };
  scoreStrategy: {
    highest: string;
    latest: string;
    first: string;
  };
  resultPublication: {
    immediate: string;
    afterGrading: string;
    manual: string;
  };
  interruption: {
    strict: string;
    boundedGrace: string;
    operatorIncident: string;
  };
  /** Separator inserted between segments. */
  separator: string;
}

/** The policy subset this formatter knows how to render. */
export type ProfileSummarySource = ExamProfilePolicyDefaults;

/** Exhaustive-case guard: a new enum member fails to compile instead of being silently omitted. */
function assertNever(value: never): never {
  throw new Error(`Unhandled summary case: ${String(value)}`);
}

/**
 * Build a concise human-readable summary string of a profile's policy fields.
 * Returns segments joined by the configured separator. Empty/irrelevant
 * segments are omitted (e.g. maxAttempts is only shown for max_attempts
 * retake policy).
 */
export function summarizeProfile(
  src: ProfileSummarySource,
  labels: ProfileSummaryLabels,
): string {
  const segments: string[] = [];

  segments.push(labels.durationMinutes(src.durationMinutes));

  if (src.latestStartOffsetMinutes !== null) {
    segments.push(labels.latestStart(src.latestStartOffsetMinutes));
  }
  if (src.minSubmitAfterStartMinutes !== null) {
    segments.push(labels.minSubmit(src.minSubmitAfterStartMinutes));
  }

  switch (src.retakePolicy) {
    case "unlimited":
      segments.push(labels.retake.unlimited);
      break;
    case "max_attempts":
      segments.push(labels.retake.maxAttempts(src.maxAttempts));
      break;
    case "pass_then_stop":
      segments.push(labels.retake.passThenStop);
      break;
    default:
      return assertNever(src.retakePolicy);
  }

  segments.push(labels.scoreStrategy[src.scoreStrategy]);
  switch (src.resultPublicationMode) {
    case "immediate":
      segments.push(labels.resultPublication.immediate);
      break;
    case "after_grading":
      segments.push(labels.resultPublication.afterGrading);
      break;
    case "manual":
      segments.push(labels.resultPublication.manual);
      break;
    default:
      return assertNever(src.resultPublicationMode);
  }
  switch (src.interruptionTimePolicy) {
    case "strict":
      segments.push(labels.interruption.strict);
      break;
    case "bounded_grace":
      segments.push(labels.interruption.boundedGrace);
      break;
    case "operator_incident":
      segments.push(labels.interruption.operatorIncident);
      break;
    default:
      return assertNever(src.interruptionTimePolicy);
  }

  return segments.join(labels.separator);
}
