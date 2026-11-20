/**
 * #550 harness database lifecycle, seeding and durable oracles (RESEARCH ONLY).
 *
 * DB safety (AGENTS.md §6): the ONLY database touched is the name-guarded
 * `exam_550*` run database, recreated from scratch for each run group via the
 * repo's own migration path. No dev database is ever read or written.
 */
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../../../../packages/db/src/database.js";
import { migratePostgres } from "../../../../../packages/db/src/postgres.js";
import { seed } from "../../../../../packages/db/src/seed.js";
import { schema } from "../../../../../packages/db/src/schema/pg.js";
import { hashPassword } from "../../../../../packages/auth/src/password.js";
import { CANDIDATE_PASSWORD, MAINT_URL, RUN_DB, RUN_DB_URL } from "./config.js";

export type DbConn = Awaited<ReturnType<typeof createDatabase>>;

function assertRunDb(name: string): void {
  if (!name.startsWith("exam_550")) {
    throw new Error(`refusing to use non-run database: ${name}`);
  }
}

/** Drop + recreate the run database, apply migrations, run the canonical seed. */
export async function freshRunDatabase(): Promise<DbConn> {
  assertRunDb(RUN_DB);
  const maint = await createDatabase(MAINT_URL);
  try {
    await maint.sql.unsafe(`DROP DATABASE IF EXISTS ${RUN_DB} WITH (FORCE)`);
    await maint.sql.unsafe(`CREATE DATABASE ${RUN_DB}`);
  } finally {
    await maint.sql.end();
  }
  const conn = await createDatabase(RUN_DB_URL);
  await migratePostgres(conn.db, {});
  await seed(conn.db, hashPassword);
  return conn;
}

export async function dropRunDatabase(): Promise<void> {
  assertRunDb(RUN_DB);
  const maint = await createDatabase(MAINT_URL);
  try {
    await maint.sql.unsafe(`DROP DATABASE IF EXISTS ${RUN_DB} WITH (FORCE)`);
  } finally {
    await maint.sql.end();
  }
}

export interface SeededCandidates {
  candidateIds: string[];
  userIds: string[];
  usernames: string[];
  enrollmentIds: string[];
  /** One argon2id hash shared by every fixture row. */
  passwordHash: string;
}

/**
 * Bulk-seed candidate fixtures (users + profiles + enrollments) via direct DB
 * inserts — pure fixture creation, never a measured path. The password hash is
 * computed ONCE and reused for every row.
 */
export async function seedCandidates(
  conn: DbConn,
  opts: {
    orgId: string;
    examId: string;
    count: number;
    prefix: string;
  },
): Promise<SeededCandidates> {
  const passwordHash = await hashPassword(CANDIDATE_PASSWORD);
  const now = new Date();
  const ids = Array.from({ length: opts.count }, () => randomUUID());
  const userIds = ids.map(() => randomUUID());
  const usernames = ids.map(
    (id, i) =>
      `${opts.prefix}-c${String(i).padStart(4, "0")}-${id.slice(0, 6)}`,
  );

  const CHUNK = 500;
  const enrollmentIds = ids.map(() => randomUUID());
  for (let off = 0; off < ids.length; off += CHUNK) {
    const idxs = ids.map((_, i) => i).slice(off, off + CHUNK);
    await conn.db.insert(schema.users).values(
      idxs.map((idx) => ({
        id: userIds[idx],
        organizationId: opts.orgId,
        username: usernames[idx],
        passwordHash,
        name: `Candidate ${usernames[idx].slice(0, 12)}`,
        role: "Candidate" as const,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await conn.db.insert(schema.candidateProfiles).values(
      idxs.map((idx) => ({
        id: ids[idx],
        organizationId: opts.orgId,
        userId: userIds[idx],
        fields: {},
        createdAt: now,
        updatedAt: now,
      })),
    );
    // RBAC-M10-E: an identity without an ACTIVE PRIMARY role assignment row
    // cannot authenticate (zero-primary policy) — mirror the canonical
    // user-creation seam's paired write.
    await conn.db.insert(schema.userRoleAssignments).values(
      idxs.map((idx) => ({
        id: randomUUID(),
        organizationId: opts.orgId,
        userId: userIds[idx],
        role: "Candidate" as const,
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await conn.db.insert(schema.examEnrollments).values(
      idxs.map((idx) => ({
        id: enrollmentIds[idx],
        organizationId: opts.orgId,
        examId: opts.examId,
        candidateId: ids[idx],
        status: "assigned" as const,
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
  return { candidateIds: ids, userIds, usernames, enrollmentIds, passwordHash };
}

// ── Durable oracles (#9) — every check reads PostgreSQL truth directly ────

export interface AttemptStatusCounts {
  [status: string]: number;
}

export async function attemptStatusCounts(
  conn: DbConn,
  examId: string,
): Promise<AttemptStatusCounts> {
  const rows = await conn.sql.unsafe(
    `SELECT status, count(*)::int AS n FROM exam_attempts
     WHERE exam_id = $1 GROUP BY status`,
    [examId],
  );
  return Object.fromEntries(
    rows.map((r) => [r.status as string, r.n as number]),
  );
}

export async function countDuplicates(
  conn: DbConn,
  examId: string,
): Promise<number> {
  // duplicate ACTIVE attempts per candidate (must always be 0)
  const rows = await conn.sql.unsafe(
    `SELECT count(*)::int AS n FROM (
       SELECT candidate_id FROM exam_attempts
       WHERE exam_id = $1 AND status = 'in_progress'
       GROUP BY candidate_id HAVING count(*) > 1
     ) d`,
    [examId],
  );
  return rows[0]?.n ?? 0;
}

export async function examTiming(
  conn: DbConn,
  examId: string,
): Promise<{ openAt: string | null; closeAt: string | null; status: string }> {
  const rows = await conn.sql.unsafe(
    `SELECT open_at, close_at, status::text AS status FROM exams WHERE id = $1`,
    [examId],
  );
  const r = rows[0];
  return {
    openAt: r?.open_at ? new Date(r.open_at as string).toISOString() : null,
    closeAt: r?.close_at ? new Date(r.close_at as string).toISOString() : null,
    status: (r?.status as string) ?? "missing",
  };
}

/** Count attempts whose terminal transition duplicated (command receipts /
 * graded rows with the same attemptNo, per candidate). */
export async function duplicateTerminalTransitions(
  conn: DbConn,
  examId: string,
): Promise<number> {
  const rows = await conn.sql.unsafe(
    `SELECT count(*)::int AS n FROM (
       SELECT candidate_id, attempt_no FROM exam_attempts
       WHERE exam_id = $1 AND status IN ('submitted', 'graded', 'auto_submitted')
       GROUP BY candidate_id, attempt_no HAVING count(*) > 1
     ) d`,
    [examId],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Spot-check saved answers against what the driver sent. `expected` maps
 * candidateId → { attemptId, questionId, answer } (the driver's last accepted
 * save per candidate).
 */
export async function answersMatchDurable(
  conn: DbConn,
  expected: Map<
    string,
    { attemptId: string; questionId: string; answer: unknown }
  >,
): Promise<{ checked: number; mismatches: string[] }> {
  const mismatches: string[] = [];
  let checked = 0;
  for (const [candidateId, exp] of expected) {
    const rows = await conn.sql.unsafe(
      `SELECT answers FROM exam_attempts WHERE id = $1`,
      [exp.attemptId],
    );
    checked += 1;
    const raw = rows[0]?.answers;
    let answers: Array<Record<string, unknown>> = [];
    try {
      answers =
        typeof raw === "string" ? JSON.parse(raw) : (raw as typeof answers);
    } catch {
      mismatches.push(`${candidateId}: answers unreadable`);
      continue;
    }
    const found = (answers ?? []).find((a) => a.questionId === exp.questionId);
    if (!found) {
      mismatches.push(`${candidateId}: question ${exp.questionId} missing`);
      continue;
    }
    if (JSON.stringify(found.answer) !== JSON.stringify(exp.answer)) {
      mismatches.push(`${candidateId}: answer payload mismatch`);
    }
  }
  return { checked, mismatches: mismatches.slice(0, 10) };
}

/** Distinct login/audit IP evidence for the topology runs (#12). */
export async function auditIps(
  conn: DbConn,
  orgId: string,
): Promise<{ ip: string; n: number }[]> {
  const rows = await conn.sql.unsafe(
    `SELECT ip_address::text AS ip, count(*)::int AS n FROM audit_logs
     WHERE organization_id = $1 AND action LIKE '%login%' AND ip_address IS NOT NULL
     GROUP BY ip_address ORDER BY n DESC`,
    [orgId],
  );
  return rows.map((r) => ({ ip: r.ip as string, n: r.n as number }));
}

/** Admitted (materialized) admission rows for an exam. */
export async function admittedCount(
  conn: DbConn,
  examId: string,
): Promise<number> {
  const rows = await conn.sql.unsafe(
    `SELECT count(*)::int AS n FROM exam_admissions
     WHERE exam_id = $1 AND admitted_at IS NOT NULL`,
    [examId],
  );
  return rows[0]?.n ?? 0;
}

export async function admissionAnchor(
  conn: DbConn,
  examId: string,
): Promise<Date | null> {
  const rows = await conn.sql.unsafe(
    `SELECT min(joined_at) AS anchor FROM exam_admissions WHERE exam_id = $1`,
    [examId],
  );
  const v = rows[0]?.anchor;
  return v ? new Date(v as string) : null;
}

export async function waitingCount(
  conn: DbConn,
  examId: string,
): Promise<number> {
  const rows = await conn.sql.unsafe(
    `SELECT count(*)::int AS n FROM exam_admissions
     WHERE exam_id = $1 AND admitted_at IS NULL`,
    [examId],
  );
  return rows[0]?.n ?? 0;
}
