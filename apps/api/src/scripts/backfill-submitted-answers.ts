/**
 * P3-L0-4: backfill `submitted_answers` for historical attempts.
 *
 * Scope (per exam-protocol.md §9.2): all attempts with submit semantics —
 * `submitted` / `grading` / `graded` / `voided` (with non-null `submittedAt`).
 * Attempts without a frozen snapshot are filled by normalizing their draft
 * `answers` against the question snapshot via `buildSubmittedAnswersSnapshot`
 * (the same helper the live submit path uses — P3-L0-2).
 *
 * Modes:
 *   --dry-run        compute the plan + report stats, write nothing
 *   --allow-quarantine  on bad/legacy data, write to a quarantine report
 *                       instead of fail-fast (default: fail-fast)
 *
 * Idempotent: an attempt that already has non-null submitted_answers is
 * skipped (never overwritten).
 *
 * Usage:
 *   pnpm --filter @exam/api backfill:submitted-answers -- --dry-run
 *   pnpm --filter @exam/api backfill:submitted-answers
 *
 * Target database is resolved from .env via resolveDatabaseUrlFromEnv (same
 * rule as migrate.ts). Never point this at exam_test or exam_e2e.
 */

import { buildSubmittedAnswersSnapshot } from "@exam/exam-engine";
import { createDatabase } from "@exam/db";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import type {
  AnswerRecord,
  ExamAttempt,
  QuestionSnapshot,
  SubmittedAnswersSnapshot,
} from "@exam/domain";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { loadRootEnv } from "../config/loadRootEnv.js";
import { resolveDatabaseUrlFromEnv } from "../config/runtimeConfig.js";

/** Statuses that carry submit semantics and are in backfill scope. */
const SUBMIT_STATUSES = ["submitted", "grading", "graded"] as const;

/** voided is in scope only when it has a submittedAt (was submitted before void). */
const VOIDED = "voided";

export interface BackfillQuarantineItem {
  attemptId: string;
  reason: string;
}

export interface BackfillStats {
  total: number;
  backfilled: number;
  skippedNoSubmitSemantics: number;
  quarantined: number;
  quarantine: BackfillQuarantineItem[];
}

export interface BackfillOptions {
  dryRun?: boolean;
  allowQuarantine?: boolean;
}

/**
 * Loads the candidate attempts for backfill: submitted/grading/graded (any
 * submittedAt) + voided-with-submittedAt. Pure DB read; no writes.
 */
export async function loadBackfillCandidates(
  db: Database,
): Promise<ExamAttempt[]> {
  const rows = await db
    .select()
    .from(schema.examAttempts)
    .where(
      and(
        isNull(schema.examAttempts.submittedAnswers),
        // status in submitted/grading/graded, OR (voided AND submittedAt not null)
        or(
          inArray(schema.examAttempts.status, [
            "submitted",
            "grading",
            "graded",
          ]),
          and(
            eq(schema.examAttempts.status, "voided"),
            isNotNull(schema.examAttempts.submittedAt),
          ),
        ),
      ),
    );
  return rows as unknown as ExamAttempt[];
}

/**
 * Builds the frozen snapshot for a single attempt from its draft answers.
 * Throws on malformed input (callers decide fail-fast vs quarantine).
 */
export function buildSnapshotForAttempt(
  attempt: ExamAttempt,
): SubmittedAnswersSnapshot {
  const draft = (attempt.answers ?? []) as AnswerRecord[];
  const questionSnapshot = (attempt.questionSnapshot ??
    []) as QuestionSnapshot[];
  return buildSubmittedAnswersSnapshot(draft, questionSnapshot);
}

/**
 * Runs the backfill against the resolved database.
 *
 * - Idempotent: candidates already exclude rows with non-null
 *   submitted_answers; a re-run only processes newly-eligible rows.
 * - Dry-run: computes snapshots + stats but performs no writes.
 * - Fail-fast (default): a malformed answer/snapshot raises and halts. With
 *   --allow-quarantine, the attempt is recorded in the quarantine report and
 *   the run continues.
 */
export async function runBackfill(
  db: Database,
  options: BackfillOptions = {},
): Promise<BackfillStats> {
  const candidates = await loadBackfillCandidates(db);

  const stats: BackfillStats = {
    total: candidates.length,
    backfilled: 0,
    skippedNoSubmitSemantics: 0,
    quarantined: 0,
    quarantine: [],
  };

  for (const attempt of candidates) {
    // Defensive: loadBackfillCandidates already filters, but a status that
    // lacks submit semantics (e.g. not_started) should never be filled.
    const status = attempt.status;
    const hasSubmitSemantics =
      SUBMIT_STATUSES.includes(status as (typeof SUBMIT_STATUSES)[number]) ||
      (status === VOIDED && attempt.submittedAt !== null);
    if (!hasSubmitSemantics) {
      stats.skippedNoSubmitSemantics++;
      continue;
    }

    let snapshot: SubmittedAnswersSnapshot;
    try {
      snapshot = buildSnapshotForAttempt(attempt);
    } catch (err) {
      if (!options.allowQuarantine) throw err;
      stats.quarantined++;
      stats.quarantine.push({
        attemptId: attempt.id,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (!options.dryRun) {
      await db
        .update(schema.examAttempts)
        .set({ submittedAnswers: snapshot })
        .where(eq(schema.examAttempts.id, attempt.id));
    }
    stats.backfilled++;
  }

  return stats;
}

function formatStats(stats: BackfillStats, dryRun: boolean): string {
  const lines = [
    `Backfill ${dryRun ? "(dry-run) " : ""}complete.`,
    `  total candidates:      ${stats.total}`,
    `  backfilled:            ${stats.backfilled}`,
    `  skipped (no semantics):${stats.skippedNoSubmitSemantics}`,
    `  quarantined:           ${stats.quarantined}`,
  ];
  if (stats.quarantine.length > 0) {
    lines.push("  quarantine detail:");
    for (const q of stats.quarantine) {
      lines.push(`    ${q.attemptId}: ${q.reason}`);
    }
  }
  return lines.join("\n");
}

// ── CLI entrypoint ────────────────────────────────────────────────

async function main() {
  loadRootEnv();
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const allowQuarantine = args.has("--allow-quarantine");

  const databaseUrl = resolveDatabaseUrlFromEnv(process.env);
  if (
    !databaseUrl.includes("/exam") &&
    !databaseUrl.includes("/exam_") // dev/test/e2e — but this script targets dev
  ) {
    process.stderr.write(
      `Warning: database URL does not look like the dev DB: ${databaseUrl}\n`,
    );
  }

  const conn = await createDatabase(databaseUrl);
  try {
    const stats = await runBackfill(conn.db, { dryRun, allowQuarantine });
    process.stdout.write(formatStats(stats, dryRun) + "\n");
    if (stats.quarantined > 0 && !allowQuarantine) {
      // unreachable (quarantine only fills when allowQuarantine), defensive
      process.exitCode = 2;
    }
  } finally {
    await conn.sql.end();
  }
}

// Run CLI only when invoked directly, not when imported by tests
const isDirectInvocation =
  process.argv[1]?.endsWith("backfill-submitted-answers.ts") ||
  process.argv[1]?.endsWith("backfill-submitted-answers.js");
if (isDirectInvocation) {
  void main().catch((err) => {
    process.stderr.write(
      `Backfill failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
