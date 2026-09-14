/**
 * P3-L0-4: backfill `submitted_answers` for historical attempts.
 *
 * Scope (per exam-protocol.md §9.2): all attempts with submit semantics —
 * `submitted` / `graded` / `voided` (with non-null `submittedAt`).
 * Attempts without a frozen snapshot are filled by normalizing their draft
 * `answers` against the question snapshot via `buildSubmittedAnswersSnapshot`
 * (the same helper the live submit path uses — P3-L0-2).
 *
 * Preflight (#542): unresolved legacy `status='grading'` rows (historical
 * grading crash residue) FAIL CLOSED — the run refuses to start rather than
 * silently leaving them out of scope. Disposition them per the 0043 runbook
 * first; after the supported rewind disposition the row re-enters scope as
 * `submitted`.
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
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { loadRootEnv } from "../config/loadRootEnv.js";
import { resolveDatabaseUrlFromEnv } from "../config/runtimeConfig.js";

/** Statuses that carry submit semantics and are in backfill scope. */
const SUBMIT_STATUSES = ["submitted", "graded"] as const;

/** voided is in scope only when it has a submittedAt (was submitted before void). */
const VOIDED = "voided";

/**
 * Historical persisted vocabulary, deliberately NOT spelled through the
 * current AttemptStatus enum (which cannot express it): `grading` was the
 * durable intermediate the pre-J2 grading writer persisted, and a crash
 * between its two writes left it behind as a residue row. Such rows ARE
 * submitted-but-never-graded data, so silently leaving them out of scope
 * would hide them; the preflight fails closed instead (#542).
 */
const LEGACY_GRADING_STATUS = "grading";

/** Runbook the preflight error points operators at. */
const LEGACY_GRADING_RUNBOOK =
  "packages/db/migrations/postgres/0043_persisted_state_status_checks.sql (operator runbook in the header)";

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
 * Loads the candidate attempts for backfill: submitted/graded (any
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
        // status in submitted/graded, OR (voided AND submittedAt not null)
        or(
          inArray(schema.examAttempts.status, ["submitted", "graded"]),
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
 * Counts unresolved legacy `status='grading'` rows using the raw historical
 * vocabulary (never the current enum). Pure DB read; no writes.
 */
export async function countUnresolvedLegacyGrading(
  db: Database,
): Promise<number> {
  const rows = (await db.execute(
    sql`SELECT count(*)::int AS n FROM exam_attempts WHERE status = ${LEGACY_GRADING_STATUS}`,
  )) as unknown as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Runs the backfill against the resolved database.
 *
 * - Preflight: any unresolved legacy `grading` row FAILS CLOSED before a
 *   single candidate is read or written — legacy crash residue is never
 *   silently skipped. Disposition those rows per the 0043 runbook first.
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
  const unresolvedLegacyGrading = await countUnresolvedLegacyGrading(db);
  if (unresolvedLegacyGrading > 0) {
    throw new Error(
      `backfill: ${unresolvedLegacyGrading} attempt(s) still carry the legacy status='grading' (historical grading crash residue). ` +
        `Refusing to run so the row(s) cannot be silently skipped. Disposition them explicitly first (offline legacy data repair — see the operator runbook in ${LEGACY_GRADING_RUNBOOK}), then re-run.`,
    );
  }

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
