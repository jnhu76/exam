/**
 * LEGACY-ONLY, OPERATOR-ONLY workset recovery for historical grading crash
 * residue (operator runbook: 0043_persisted_state_status_checks.sql, Option A).
 *
 * AUTHORITY BOUNDARY (INVARIANT — do not widen):
 *
 *   Historical repair authority (this script):
 *     may reconstruct a MISSING current durable grading workset
 *     (attempt_grading_entries) from already-frozen submitted truth
 *     (submitted_answers + questionSnapshot), using the CURRENT canonical
 *     derivation (`computeExpectedGradingEntries` — the same scorer,
 *     manual/auto classifier, maxScore, and answer extraction the fresh
 *     submit freeze barrier uses). No second scoring implementation exists
 *     here and none may be added.
 *
 *   Runtime transition authority: UNCHANGED. Engine-locked commands only
 *     (submitAttempt / gradeQuestion / finalizeTerminalGrading). This script
 *     is NOT a runtime transition and is NOT callable from any route.
 *
 *   REPAIR THE MISSING INPUT, NEVER THE TERMINAL OUTPUT: the script writes
 *     only attempt_grading_entries (+ the submit-freeze lifecycle label
 *     `grading_status`, re-derived from the same canonical classifier). It
 *     NEVER writes attempt score/passed/gradingResult/gradedAt and NEVER
 *     writes enrollment finalScore/finalPassed/finalAttemptId — those remain
 *     owned by the normal terminal grading closure. After recovery the
 *     attempt is submitted-with-complete-workset; terminalization happens
 *     exclusively through the normal grading surfaces.
 *
 * DISPOSITION PRECONDITION: the residue row must already hold
 * status='submitted' via the runbook Option A rewind (the script REFUSES
 * status='grading' — the offline migration disposition and this repair are
 * deliberately separate steps), and submitted_answers must already be
 * backfilled (`pnpm --filter @exam/api backfill:submitted-answers`).
 *
 * FAIL-CLOSED MATRIX:
 *   status != 'submitted'                        → refuse
 *   any terminal attempt fact already present    → refuse (contradictory data)
 *   grading_status = 'fully_graded'              → refuse (terminal lifecycle
 *                                                  label on a non-graded attempt)
 *   submitted_answers IS NULL                    → refuse (run the backfill)
 *   questionSnapshot absent/empty/malformed      → refuse
 *   ZERO workset                                 → MAY MATERIALIZE (exactly
 *                                                   once, canonical derivation
 *                                                   + label alignment)
 *   EXACT COMPLETE workset + matching label      → validate + NO-OP (idempotent)
 *   EXACT COMPLETE workset + mismatched label    → refuse (contradictory mixed
 *                                                   state — the zero-workset
 *                                                   label alignment does NOT
 *                                                   extend to the non-zero
 *                                                   branch)
 *   PARTIAL / MISMATCHED / EXTRA workset         → refuse via
 *                                                   validateGradingWorksetConsistency,
 *                                                   no insert, no overwrite
 *
 * Manual-freeze lifecycle note: a residue row carries the migration-default
 * grading_status='auto_graded' (0004 column default) even when its frozen
 * snapshot contains manual (text_response) questions — the historical writer
 * predates the grading_status lifecycle. Without realignment the manual
 * grading command (`gradeQuestion`) refuses the attempt forever. The
 * materialize branch therefore re-derives the label from the same canonical
 * freeze-barrier classification (`requiresManualGrading`), the exact expression
 * the fresh submit path persists.
 *
 * Concurrency: the real run takes the attempt row lock (FOR UPDATE) and
 * performs all reads + writes inside ONE transaction, so the materialized
 * workset and the lifecycle label land atomically. Run while the deployment
 * is quiesced (migration window), like the 0043 rewind itself.
 *
 * Usage:
 *   pnpm --filter @exam/api recover:legacy-grading-workset -- <attemptId> [--dry-run]
 *
 * Target database is resolved from .env via resolveDatabaseUrlFromEnv (same
 * rule as migrate.ts / backfill-submitted-answers.ts). Never point this at
 * exam_test or exam_e2e — the shared database-name guard
 * (`isForbiddenRepairTarget`) refuses the test territories and exits non-zero.
 */

import {
  computeExpectedGradingEntries,
  validateGradingWorksetConsistency,
} from "@exam/exam-engine";
import { requiresManualGrading } from "@exam/domain";
import type {
  AttemptGradingEntry,
  ExamAttempt,
  GradingStatus,
} from "@exam/domain";
import {
  createDatabase,
  executeInTransaction,
  isForbiddenRepairTarget,
  parseDatabaseName,
  refuseRepairTargetMessage,
} from "@exam/db";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { loadRootEnv } from "../config/loadRootEnv.js";
import { resolveDatabaseUrlFromEnv } from "../config/runtimeConfig.js";

export interface LegacyWorksetRecoveryResult {
  attemptId: string;
  /** materialized / validated_no_op (would_* in dry-run mode). */
  action:
    | "materialized"
    | "validated_no_op"
    | "would_materialize"
    | "would_validate";
  /** Entries now on the attempt (created or validated). */
  entryCount: number;
  /**
   * grading_status realignment performed (or required) by the materialize
   * branch, from the migration-default/legacy label to the canonical
   * freeze-barrier classification. Always null in the validate branch.
   */
  gradingStatusAlignment: { from: string | null; to: GradingStatus } | null;
}

export interface LegacyWorksetRecoveryOptions {
  dryRun?: boolean;
}

/**
 * Recovers the missing durable grading workset for ONE legacy residue attempt.
 * See the file header for the authority boundary and fail-closed matrix.
 */
export async function recoverLegacyGradingWorkset(
  db: Database,
  attemptId: string,
  options: LegacyWorksetRecoveryOptions = {},
): Promise<LegacyWorksetRecoveryResult> {
  if (options.dryRun) {
    return recoverInTx(db, attemptId, { dryRun: true });
  }
  return executeInTransaction(db, (tx) => recoverInTx(tx, attemptId, {}));
}

async function recoverInTx(
  db: Database,
  attemptId: string,
  options: { dryRun?: boolean },
): Promise<LegacyWorksetRecoveryResult> {
  // Preflight reads. In a real run the caller transaction holds the attempt
  // row lock so the read → decide → write sequence is atomic (dry-run is
  // read-only and takes no lock).
  if (!options.dryRun) {
    await db.execute(
      sql`SELECT id FROM exam_attempts WHERE id = ${attemptId} FOR UPDATE`,
    );
  }
  const attempt = (
    await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId))
      .limit(1)
  )[0] as unknown as ExamAttempt | undefined;

  if (!attempt) {
    throw new Error(`recover: attempt ${attemptId} not found`);
  }

  // 1. Disposition precondition: the runbook rewind must already have run.
  //    'grading' is historical vocabulary the CURRENT enum cannot express —
  //    compare against the raw value, never through AttemptStatus.
  if ((attempt.status as string) !== "submitted") {
    throw new Error(
      `recover: attempt ${attemptId} has status='${attempt.status}'. ` +
        "Refusing: the script only accepts the post-disposition shape " +
        "status='submitted'. Disposition unresolved legacy 'grading' rows " +
        "per the 0043 operator runbook first, then re-run.",
    );
  }

  // 2. No terminal facts may exist — the recovery repairs the grading INPUT,
  //    never terminal output. A submitted row carrying any terminal fact is
  //    contradictory data outside the proven residue shape.
  const terminalFacts = [
    ["score", attempt.score],
    ["passed", attempt.passed],
    ["grading_result", attempt.gradingResult],
    ["graded_at", attempt.gradedAt],
  ] as const;
  const present = terminalFacts.filter(([, v]) => v !== null).map(([n]) => n);
  if (present.length > 0) {
    throw new Error(
      `recover: attempt ${attemptId} already carries terminal fact(s): ` +
        `${present.join(", ")}. Refusing: contradictory data is not proven ` +
        "crash residue — investigate its origin first (0043 runbook).",
    );
  }

  // 3. A 'fully_graded' lifecycle label on a non-graded attempt is the same
  //    contradictory class. Every other grading_status is realignable.
  if (attempt.gradingStatus === "fully_graded") {
    throw new Error(
      `recover: attempt ${attemptId} carries grading_status='fully_graded' ` +
        "while status='submitted'. Refusing: contradictory terminal grading " +
        "lifecycle data is not proven crash residue.",
    );
  }

  // 4. Frozen inputs must already exist. submitted_answers is populated by
  //    the backfill script; the questionSnapshot is the frozen question
  //    universe the derivation reads.
  if (!attempt.submittedAnswers) {
    throw new Error(
      `recover: attempt ${attemptId} has no frozen submitted_answers. ` +
        "Refusing: run `pnpm --filter @exam/api backfill:submitted-answers` " +
        "first — the workset is derived ONLY from frozen submitted truth.",
    );
  }
  if (
    !Array.isArray(attempt.questionSnapshot) ||
    attempt.questionSnapshot.length === 0
  ) {
    throw new Error(
      `recover: attempt ${attemptId} has an absent or empty questionSnapshot. ` +
        "Refusing: canonical derivation requires the frozen question universe.",
    );
  }

  // Canonical freeze-barrier classification (same expression the fresh
  // submit path persists at the freeze barrier).
  const canonicalGradingStatus: GradingStatus = requiresManualGrading(
    attempt.questionSnapshot,
  )
    ? "pending_manual"
    : "auto_graded";

  const existingEntries = (await db
    .select()
    .from(schema.attemptGradingEntries)
    .where(
      eq(schema.attemptGradingEntries.attemptId, attemptId),
    )) as unknown as AttemptGradingEntry[];

  if (existingEntries.length === 0) {
    // ZERO WORKSET → MAY MATERIALIZE. The entries are derived by the CURRENT
    // canonical derivation (computeExpectedGradingEntries — canonical
    // gradeQuestion scoring + isManualGradedQuestion classification) and
    // inserted exactly once in the repo bulkCreate row shape. The UNIQUE
    // (attempt_id, question_id) constraint makes any double-insert throw.
    const expected = computeExpectedGradingEntries(attempt);
    const gradingStatusAlignment =
      attempt.gradingStatus === canonicalGradingStatus
        ? null
        : {
            from: attempt.gradingStatus ?? null,
            to: canonicalGradingStatus,
          };

    if (!options.dryRun) {
      await db.insert(schema.attemptGradingEntries).values(
        expected.map((e) => ({
          id: randomUUID(),
          organizationId: attempt.organizationId,
          attemptId: attempt.id,
          questionId: e.questionId,
          gradingMode: e.gradingMode,
          status: e.status,
          maxScore: e.maxScore,
          earnedScore: e.earnedScore,
          candidateAnswer: e.candidateAnswer,
          standardAnswer: e.standardAnswer,
          correct: e.correct,
          comment: "",
          gradedBy: null,
          gradedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
      if (gradingStatusAlignment) {
        await db
          .update(schema.examAttempts)
          .set({
            gradingStatus: gradingStatusAlignment.to,
            updatedAt: new Date(),
          })
          .where(eq(schema.examAttempts.id, attemptId));
      }
    }

    return {
      attemptId,
      action: options.dryRun ? "would_materialize" : "materialized",
      entryCount: expected.length,
      gradingStatusAlignment,
    };
  }

  // PARTIAL / MISMATCHED / EXTRA workset → validateGradingWorksetConsistency
  // throws and NOTHING is written (no fill-gaps, no overwrite).
  // EXACT COMPLETE workset → validation passes → idempotent NO-OP, but only
  // when the lifecycle label also matches the canonical frozen classification:
  // ZERO workset = proven legacy residue (the materialize branch may align the
  // label); NON-ZERO workset + mismatched label = contradictory, unexplained
  // mixed state — investigate before recovery, no auto-realign here.
  validateGradingWorksetConsistency(attempt, existingEntries);

  if (attempt.gradingStatus !== canonicalGradingStatus) {
    throw new Error(
      `recover: attempt ${attemptId} workset is structurally valid but ` +
        `grading_status does not match the canonical frozen classification ` +
        `('${attempt.gradingStatus ?? "NULL"}' != '${canonicalGradingStatus}'). ` +
        "Refusing to return validated_no_op: a non-zero workset with a " +
        "mismatched lifecycle label is contradictory data, not proven crash " +
        "residue — investigate before recovery.",
    );
  }

  return {
    attemptId,
    action: options.dryRun ? "would_validate" : "validated_no_op",
    entryCount: existingEntries.length,
    gradingStatusAlignment: null,
  };
}

function formatResult(r: LegacyWorksetRecoveryResult, dryRun: boolean): string {
  const lines = [
    `Legacy grading-workset recovery ${dryRun ? "(dry-run) " : ""}complete.`,
    `  attempt:               ${r.attemptId}`,
    `  action:                ${r.action}`,
    `  entries:               ${r.entryCount}`,
  ];
  if (r.gradingStatusAlignment) {
    lines.push(
      `  grading_status:        ${r.gradingStatusAlignment.from ?? "NULL"} → ${r.gradingStatusAlignment.to}`,
    );
  }
  lines.push(
    "  The recovery wrote NO terminal grading or enrollment facts; terminalize through the normal grading surfaces.",
  );
  return lines.join("\n");
}

// ── CLI entrypoint ────────────────────────────────────────────────

async function main() {
  loadRootEnv();
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const attemptId = argv.find((a) => !a.startsWith("--"));
  if (!attemptId) {
    process.stderr.write(
      "Usage: recover-legacy-grading-workset <attemptId> [--dry-run]\n",
    );
    process.exit(1);
  }

  const databaseUrl = resolveDatabaseUrlFromEnv(process.env);

  // Database-name safety guard: this repair mutates business rows in place,
  // so the documented "never exam_test or exam_e2e" boundary must fail closed.
  // URL-based parsing (not string matching) so query params / trailing slashes
  // cannot confuse the name; the territory rules live in the shared guard.
  let dbName: string;
  try {
    dbName = parseDatabaseName(databaseUrl);
  } catch (err) {
    process.stderr.write(`Invalid DATABASE_URL: ${(err as Error).message}\n`);
    process.exitCode = 2;
    return;
  }
  if (isForbiddenRepairTarget(dbName)) {
    process.stderr.write(`${refuseRepairTargetMessage(dbName)}\n`);
    process.exitCode = 2;
    return;
  }

  const conn = await createDatabase(databaseUrl);
  try {
    const result = await recoverLegacyGradingWorkset(conn.db, attemptId, {
      dryRun,
    });
    process.stdout.write(formatResult(result, dryRun) + "\n");
  } finally {
    await conn.sql.end();
  }
}

// Run CLI only when invoked directly, not when imported by tests
const isDirectInvocation =
  process.argv[1]?.endsWith("recover-legacy-grading-workset.ts") ||
  process.argv[1]?.endsWith("recover-legacy-grading-workset.js");
if (isDirectInvocation) {
  void main().catch((err) => {
    process.stderr.write(
      `Recovery failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
