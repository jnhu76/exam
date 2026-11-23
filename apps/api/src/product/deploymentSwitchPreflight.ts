import { and, inArray, isNull } from "drizzle-orm";
import { schema } from "@exam/db/schema/pg";
import type { Database } from "@exam/db/types";
import type {
  ProductCapabilityId,
  ResolvedProductConfiguration,
} from "@exam/domain";

/**
 * Deployment-switch outstanding-obligation audit (#678 / ADR-022 Phase 3,
 * r4 "切换静态预设"): BEFORE a static deployment ceiling takes effect, the
 * deployment audits the ACCEPTED execution obligations it would carry over
 * and rejects the switch only when the new configuration would cut a
 * concrete obligation — naming the objects and the obligation
 * (product-capability-composition.md §8, ADR-022 D5). With the bootstrap-only
 * static preset the switch moment IS a server start, so `server.ts` runs this
 * preflight after the DB connection is up and before listening.
 *
 * Fulfillment-requirement ruling (see deploymentSwitchPreflight.test.ts):
 * every outstanding obligation class runs on kernel paths (§4.1) with
 * retained decoders/renderers (§7) and candidate-self-service queue
 * reconcile, so NO known obligation requires any capability from the
 * ceiling — the rule table below is the SINGLE place where a future
 * capability-gated fulfillment (e.g. #645 result delivery) registers its
 * requirement. Entries must never be derived from question material (that
 * is `deriveQuestionRequiredCapabilities`' new-commitment authority); this
 * table owns execution-fulfillment requirements only.
 *
 * The audit is read-only: it derives obligations from persisted facts and
 * never reinterprets exam/attempt/grading truth (EXSEM authorities own
 * those facts; this module only enumerates them).
 */

/** r4's outstanding-obligation enumeration (切换静态预设 checklist). */
export type SwitchObligationKind =
  | "published_awaiting_start"
  | "open_eligible_without_attempt"
  | "queued_or_resumable"
  | "pending_manual_grading"
  | "finalized_awaiting_publication"
  | "historical_results_readable";

export interface OutstandingObligation {
  readonly kind: SwitchObligationKind;
  readonly examId: string;
  /** The resumable/pending/graded attempt, when the obligation is per-attempt. */
  readonly attemptId?: string;
  /** The outstanding participant (candidate profile), when per-participant. */
  readonly candidateProfileId?: string;
  /**
   * Capabilities whose ceiling omission would cut THIS obligation's
   * fulfillment path. Derived by the rule table below, never from preset
   * names.
   */
  readonly requiredCapabilities: readonly ProductCapabilityId[];
}

export interface DeploymentSwitchViolation {
  readonly kind: SwitchObligationKind;
  readonly capability: ProductCapabilityId;
  readonly objects: readonly {
    examId: string;
    attemptId?: string;
    candidateProfileId?: string;
  }[];
  readonly reason: string;
}

export interface DeploymentSwitchAudit {
  readonly allowed: boolean;
  readonly obligations: readonly OutstandingObligation[];
  readonly violations: readonly DeploymentSwitchViolation[];
}

/**
 * The single rule table: obligation class → capabilities required to FULFILL
 * it under the deployment ceiling. Empty for every known class (kernel
 * fulfillment — see module comment); a future capability-gated fulfillment
 * path adds its requirement HERE and nowhere else.
 */
const FULFILLMENT_REQUIREMENTS: Record<
  SwitchObligationKind,
  readonly ProductCapabilityId[]
> = {
  published_awaiting_start: [],
  open_eligible_without_attempt: [],
  queued_or_resumable: [],
  pending_manual_grading: [],
  finalized_awaiting_publication: [],
  historical_results_readable: [],
};

function obligation(
  kind: SwitchObligationKind,
  examId: string,
  ids: { attemptId?: string; candidateProfileId?: string } = {},
): OutstandingObligation {
  return {
    kind,
    examId,
    ...(ids.attemptId !== undefined ? { attemptId: ids.attemptId } : {}),
    ...(ids.candidateProfileId !== undefined
      ? { candidateProfileId: ids.candidateProfileId }
      : {}),
    requiredCapabilities: FULFILLMENT_REQUIREMENTS[kind],
  };
}

/**
 * Enumerates every outstanding accepted obligation from persisted facts.
 * Classification reads lifecycle/material authorities only through their
 * persisted projections (exam status, attempt status/gradingStatus,
 * admission consumption, resultsPublishedAt); legacy NULL grading_status
 * rows are classified at read time by the grading authority, not here.
 */
export async function collectOutstandingObligations(
  db: Database,
): Promise<OutstandingObligation[]> {
  const exams = await db
    .select({
      id: schema.exams.id,
      status: schema.exams.status,
      controlFlags: schema.exams.controlFlags,
      resultPublicationMode: schema.exams.resultPublicationMode,
      resultsPublishedAt: schema.exams.resultsPublishedAt,
    })
    .from(schema.exams);
  const examById = new Map(exams.map((exam) => [exam.id, exam]));

  const attempts = await db
    .select({
      id: schema.examAttempts.id,
      examId: schema.examAttempts.examId,
      candidateId: schema.examAttempts.candidateId,
      status: schema.examAttempts.status,
      gradingStatus: schema.examAttempts.gradingStatus,
    })
    .from(schema.examAttempts);

  const openExamIds = exams
    .filter((exam) => exam.status === "open")
    .map((exam) => exam.id);

  // Active (unconsumed) queue memberships on open exams: the participant is
  // in the queue path — joined, waiting/ready, not yet holding an attempt.
  const activeAdmissions = openExamIds.length
    ? await db
        .select({
          examId: schema.examAdmissions.examId,
          candidateId: schema.examAdmissions.candidateId,
        })
        .from(schema.examAdmissions)
        .where(
          and(
            inArray(schema.examAdmissions.examId, openExamIds),
            isNull(schema.examAdmissions.consumedAt),
          ),
        )
    : [];
  const queuedByExamCandidate = new Set(
    activeAdmissions.map((a) => `${a.examId}\u0000${a.candidateId}`),
  );

  const obligations: OutstandingObligation[] = [];
  const attemptKeysByExam = new Map<string, Set<string>>();

  for (const attempt of attempts) {
    const key = attempt.examId + "\u0000" + attempt.candidateId;
    let keys = attemptKeysByExam.get(attempt.examId);
    if (!keys) {
      keys = new Set();
      attemptKeysByExam.set(attempt.examId, keys);
    }
    keys.add(key);

    switch (attempt.status) {
      case "in_progress":
      case "disrupted":
      case "queued":
        // Resumable execution: restore/reconcile runs on kernel recovery.
        obligations.push(
          obligation("queued_or_resumable", attempt.examId, {
            attemptId: attempt.id,
          }),
        );
        break;
      case "submitted":
        if (attempt.gradingStatus === "pending_manual") {
          obligations.push(
            obligation("pending_manual_grading", attempt.examId, {
              attemptId: attempt.id,
            }),
          );
        }
        break;
      case "graded": {
        const exam = examById.get(attempt.examId);
        // 已定稿待统一发布: terminal grading is complete while the manual
        // unified publication has not happened yet. The publication command
        // itself is kernel (§4.1) — this enumerates the obligation, it does
        // not gate it.
        if (
          attempt.gradingStatus !== null &&
          attempt.gradingStatus !== "pending_manual" &&
          exam?.resultPublicationMode === "manual" &&
          exam.resultsPublishedAt === null
        ) {
          obligations.push(
            obligation("finalized_awaiting_publication", attempt.examId, {
              attemptId: attempt.id,
            }),
          );
        }
        break;
      }
      default:
        // not_started/voided: no outstanding execution obligation.
        break;
    }
  }

  for (const exam of exams) {
    if (exam.status === "published") {
      // 已发布待考: frozen, awaiting its window (participants implied).
      obligations.push(obligation("published_awaiting_start", exam.id));
    }
    if (exam.resultsPublishedAt !== null) {
      // 历史读取: published results stay readable (kernel reads; Rich
      // decoder/renderer retained per §7).
      obligations.push(obligation("historical_results_readable", exam.id));
    }
  }

  if (openExamIds.length > 0) {
    const enrollments = await db
      .select({
        examId: schema.examEnrollments.examId,
        candidateId: schema.examEnrollments.candidateId,
        status: schema.examEnrollments.status,
      })
      .from(schema.examEnrollments)
      .where(inArray(schema.examEnrollments.examId, openExamIds));

    for (const enrollment of enrollments) {
      if (enrollment.status === "blocked") continue;
      const hasAttempt = attemptKeysByExam
        .get(enrollment.examId)
        ?.has(enrollment.examId + "\u0000" + enrollment.candidateId);
      if (hasAttempt) continue;
      if (
        queuedByExamCandidate.has(
          enrollment.examId + "\u0000" + enrollment.candidateId,
        )
      ) {
        // Queue-path participant: enumerated once via its active admission
        // below, not as a bare eligible-without-attempt.
        continue;
      }
      obligations.push(
        obligation("open_eligible_without_attempt", enrollment.examId, {
          candidateProfileId: enrollment.candidateId,
        }),
      );
    }

    for (const admission of activeAdmissions) {
      obligations.push(
        obligation("queued_or_resumable", admission.examId, {
          candidateProfileId: admission.candidateId,
        }),
      );
    }
  }

  return obligations.sort((a, b) =>
    a.kind === b.kind
      ? a.examId === b.examId
        ? (a.attemptId ?? a.candidateProfileId ?? "").localeCompare(
            b.attemptId ?? b.candidateProfileId ?? "",
          )
        : a.examId.localeCompare(b.examId)
      : a.kind.localeCompare(b.kind),
  );
}

/**
 * Pure comparator: judges collected obligations against the TARGET resolved
 * configuration (always the output of the one domain resolver). A violation
 * exists only when an obligation's fulfillment requirement is not admitted
 * by the ceiling; allowed === violations.length === 0. Known classes derive
 * no requirements today, so a Standard→bounded-subset or Minimal switch is
 * allowed whenever fulfillment stays kernel — that is the pairing
 * acceptance, not a rubber stamp: the rule table above is the fail-closed
 * place where cuts get declared.
 */
export function evaluateDeploymentSwitch(
  obligations: readonly OutstandingObligation[],
  target: ResolvedProductConfiguration,
): DeploymentSwitchAudit {
  /** Accumulation shape: mutable objects array, narrowed on return. */
  type ViolationAccumulator = Omit<DeploymentSwitchViolation, "objects"> & {
    objects: DeploymentSwitchViolation["objects"][number][];
  };
  const byKey = new Map<string, ViolationAccumulator>();
  for (const obligationItem of obligations) {
    for (const capability of obligationItem.requiredCapabilities) {
      if (target.allows(capability)) continue;
      const key = obligationItem.kind + "\u0000" + capability;
      const existing = byKey.get(key);
      const objectEntry = {
        examId: obligationItem.examId,
        ...(obligationItem.attemptId !== undefined
          ? { attemptId: obligationItem.attemptId }
          : {}),
        ...(obligationItem.candidateProfileId !== undefined
          ? { candidateProfileId: obligationItem.candidateProfileId }
          : {}),
      };
      if (existing) {
        existing.objects.push(objectEntry);
      } else {
        byKey.set(key, {
          kind: obligationItem.kind,
          capability,
          objects: [objectEntry],
          reason:
            `accepted ${obligationItem.kind} obligation requires ${capability}, ` +
            "which the target deployment ceiling does not admit (ADR-022 D5: " +
            "a capability switch must not cut accepted execution obligations)",
        });
      }
    }
  }
  return {
    allowed: byKey.size === 0,
    obligations,
    violations: [...byKey.values()],
  };
}

/**
 * Convenience wrapper for the startup preflight: collect + evaluate against
 * the deployment's resolved ceiling. Read-only.
 */
export async function auditDeploymentSwitch(
  db: Database,
  target: ResolvedProductConfiguration,
): Promise<DeploymentSwitchAudit> {
  return evaluateDeploymentSwitch(
    await collectOutstandingObligations(db),
    target,
  );
}
