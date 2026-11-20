/**
 * G1.2 driver run 的 DB durable oracle（RESEARCH ONLY，宿主机侧）。
 *
 * 对账范围（协议 §5.1 achieved-success 判据 + §2.4 一律 DB oracle）：
 *   1. login.success 审计行：本 run 考生数、distinct 源 IP（G1.3 Fastify 侧
 *      request.ip 观测——limiter 与审计同源）；
 *   2. attempt 终态：唯一终态、submission_reason、归属（candidateId 匹配）、
 *      attempt_no、12 条评分 entry、无重复终态/无 in_progress 重复 attempt；
 *   3. 答案版本链：receipts 的 clientSeq 链与最后接受答案 == driver 记录值
 *      （driver.json expectedLastAcceptedAnswers）；
 *   4. 流程完整性：started 未 submitted 的 attempt 单列（flowIncomplete）。
 *
 * 运行（cwd=/home/hoo/Source/exam 契约）：
 *   pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
 *     /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/driver/oracle.ts \
 *     --run=<runId>
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../../../../packages/db/src/database.js";
import { RUN_DB_URL } from "../../harness/lib/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => /^--([^=]+)=(.*)$/.exec(a)?.slice(1, 3) ?? [a.slice(2), "true"]),
);
const runId = args.run;
if (!runId) throw new Error("--run=<runId> required");
const runDir = join(__dirname, "runs", runId);
const candidatesFile = join(runDir, "candidates.json");
const driverJson = JSON.parse(readFileSync(join(runDir, "driver.json"), "utf8"));
const candidates = existsSync(candidatesFile)
  ? (JSON.parse(readFileSync(candidatesFile, "utf8")) as { examId: string; candidates: string[]; candidateIds: string[] })
  : null;

const conn = await createDatabase(RUN_DB_URL);
const dbCheck = await conn.sql.unsafe(`SELECT current_database() AS db`);
console.log(`[oracle] connected to ${dbCheck[0]!.db} (name-guarded ${RUN_DB_URL.split("/").pop()})`);

interface Row {
  [k: string]: unknown;
}
const q = async (sql: string, params: unknown[]): Promise<Row[]> =>
  (await conn.sql.unsafe(sql, params)) as Row[];

// ── 1. login.success 审计（Fastify 侧 request.ip 观测） ─────────────────────
const userFilter = candidates
  ? candidates.candidates
  : [];
const inList = (arr: string[]) => `(${arr.map((_, i) => `$${i + 1}`).join(",")})`;

const auditRows = candidates
  ? await q(
      `SELECT u.username, a.ip_address::text AS ip, a.created_at
       FROM audit_logs a JOIN users u ON u.id = a.actor_id
       WHERE a.action = 'login.success' AND u.username IN ${inList(userFilter)}
       ORDER BY a.created_at`,
      userFilter,
    )
  : [];
const ipTally = new Map<string, number>();
for (const r of auditRows) {
  const ip = String(r.ip);
  ipTally.set(ip, (ipTally.get(ip) ?? 0) + 1);
}

// ── 2/3/4. attempts + receipts + grading ────────────────────────────────────
interface AttemptRow {
  attempt_id: string;
  username: string;
  candidate_id: string;
  user_id: string;
  attempt_no: number;
  status: string;
  submission_reason: string | null;
  submitted_at: string | null;
  grading_entries: number;
  frozen_questions: number;
  answers: unknown;
}
const attemptRows: AttemptRow[] = candidates
  ? await q(
      `SELECT a.id AS attempt_id, u.username, a.candidate_id, cp.user_id,
              a.attempt_no, a.status::text AS status, a.submission_reason,
              a.submitted_at, a.question_snapshot,
              (SELECT count(*)::int FROM attempt_grading_entries g WHERE g.attempt_id = a.id) AS grading_entries,
              a.answers
       FROM exam_attempts a
       JOIN candidate_profiles cp ON cp.id = a.candidate_id
       JOIN users u ON u.id = cp.user_id
       WHERE u.username IN ${inList(userFilter)}`,
      userFilter,
    ).then((rows) =>
      rows.map((r) => ({
        attempt_id: String(r.attempt_id),
        username: String(r.username),
        candidate_id: String(r.candidate_id),
        user_id: String(r.user_id),
        attempt_no: Number(r.attempt_no),
        status: String(r.status),
        submission_reason: (r.submission_reason as string) ?? null,
        submitted_at: (r.submitted_at as string) ?? null,
        grading_entries: Number(r.grading_entries),
        frozen_questions: Array.isArray(r.question_snapshot) ? (r.question_snapshot as unknown[]).length : JSON.parse(String(r.question_snapshot ?? "[]")).length,
        answers: r.answers,
      })),
    )
  : [];

const receiptRows = candidates
  ? await q(
      `SELECT u.username, r.attempt_id, r.client_seq, r.accepted_version, r.saved_at
       FROM exam_answer_save_receipts r
       JOIN exam_attempts a ON a.id = r.attempt_id
       JOIN candidate_profiles cp ON cp.id = a.candidate_id
       JOIN users u ON u.id = cp.user_id
       WHERE u.username IN ${inList(userFilter)}
       ORDER BY r.attempt_id, r.client_seq`,
      userFilter,
    )
  : [];

// per-candidate 判定
const expected = (driverJson.expectedLastAcceptedAnswers ?? {}) as Record<
  string,
  { attemptId: string; questionId: string; answer: unknown }
>;
const candidateOutcome: Record<string, unknown>[] = [];
let mismatch = 0;
for (const u of userFilter) {
  const at = attemptRows.filter((r) => r.username === u);
  const rec = receiptRows.filter((r) => r.username === u);
  const exp = expected[u] ?? null;
  const row: Record<string, unknown> = { candidate: u };
  if (at.length === 0) {
    row.outcome = "no-attempt";
  } else if (at.length > 1) {
    row.outcome = "MULTIPLE-ATTEMPTS";
    mismatch += 1;
  } else {
    const a = at[0]!;
    row.status = a.status;
    row.submissionReason = a.submission_reason;
    row.gradingEntries = a.grading_entries;
    row.frozenQuestions = a.frozen_questions;
    if (["submitted", "graded", "auto_submitted"].includes(a.status)) {
      // 终态检查
      if (a.submission_reason !== "manual") { row.outcome = "UNEXPECTED-REASON"; mismatch += 1; }
      else if (a.grading_entries !== a.frozen_questions) { row.outcome = "GRADING-ENTRY-MISMATCH"; mismatch += 1; }
      else row.outcome = "terminal-ok";
    } else {
      row.outcome = `flow-incomplete:${a.status}`;
    }
    // 答案链 vs driver 最后接受值
    if (exp) {
      let answers: Array<{ questionId: string; answer: unknown }> = [];
      try {
        answers = typeof a.answers === "string" ? JSON.parse(a.answers) : ((a.answers ?? []) as typeof answers);
      } catch { answers = []; }
      const found = answers.find((x) => x.questionId === exp.questionId);
      const answersMatch = found !== undefined && JSON.stringify(found.answer) === JSON.stringify(exp.answer);
      const receiptsSorted = rec.map((r) => Number(r.client_seq));
      row.answersMatchDriver = answersMatch;
      row.receiptClientSeqs = receiptsSorted;
      if (!answersMatch) { row.outcome = `${row.outcome}+ANSWER-MISMATCH`; mismatch += 1; }
    }
  }
  candidateOutcome.push(row);
}

const dupActive = await q(
  `SELECT count(*)::int AS n FROM (
     SELECT candidate_id FROM exam_attempts
     WHERE status = 'in_progress' GROUP BY candidate_id HAVING count(*) > 1
   ) d`,
  [],
);
const dupTerminal = await q(
  `SELECT count(*)::int AS n FROM (
     SELECT candidate_id, attempt_no FROM exam_attempts
     WHERE status IN ('submitted','graded','auto_submitted')
     GROUP BY candidate_id, attempt_no HAVING count(*) > 1
   ) d`,
  [],
);

const oracle = {
  runId,
  loginAudit: {
    successRows: auditRows.length,
    distinctCandidates: new Set(auditRows.map((r) => r.username)).size,
    ipTally: Object.fromEntries([...ipTally.entries()].sort()),
  },
  attempts: {
    total: attemptRows.length,
    byStatus: attemptRows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {}),
    terminalOk: candidateOutcome.filter((r) => r.outcome === "terminal-ok").length,
    flowIncomplete: candidateOutcome.filter((r) => String(r.outcome).startsWith("flow-incomplete")).length,
    mismatches: candidateOutcome.filter((r) => String(r.outcome).includes("MISMATCH") || String(r.outcome).startsWith("MULTIPLE") || String(r.outcome).startsWith("UNEXPECTED")),
    noAttempt: candidateOutcome.filter((r) => r.outcome === "no-attempt").length,
  },
  invariants: {
    duplicateActiveAttempts: dupActive[0]?.n ?? 0,
    duplicateTerminalTransitions: dupTerminal[0]?.n ?? 0,
  },
  perCandidate: candidateOutcome,
};
const outPath = join(runDir, "oracle.json");
writeFileSync(outPath, JSON.stringify(oracle, null, 2) + "\n");
console.log(`[oracle] login.success rows=${oracle.loginAudit.successRows} distinctIPs=${Object.keys(oracle.loginAudit.ipTally).length}`);
console.log(`[oracle] attempts: ${JSON.stringify(oracle.attempts.byStatus)} terminalOk=${oracle.attempts.terminalOk} incomplete=${oracle.attempts.flowIncomplete}`);
console.log(`[oracle] invariants: dupActive=${oracle.invariants.duplicateActiveAttempts} dupTerminal=${oracle.invariants.duplicateTerminalTransitions} mismatchCount=${mismatch}`);
console.log(`[oracle] written: ${outPath}`);
await conn.sql.end();
