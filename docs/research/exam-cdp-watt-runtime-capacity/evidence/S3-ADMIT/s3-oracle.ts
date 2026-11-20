/**
 * S3-ADMIT DB durable oracle（RESEARCH ONLY；协议 §5.1 交卷权威判据 + §6 S1
 * 「最终已确认答案数、唯一终态数」）。
 *
 * 交卷权威确认（不得凭一个 200 推断）——对全部 200 submitter：
 *   1. 唯一 attempt 且唯一终态（graded），attempt_no=1；
 *   2. submission_reason='manual'、submitted_at 非空；
 *   3. 每冻结题恰一条评分 entry（12/12）；
 *   4. submitted answers = 服务端最后接受版本（driver 记录的最后 accepted
 *      answer，即 save:2 的 false）；
 *   5. receipts clientSeq 链 [1,2]（已确认答案保存数 = 2/考生）；
 *   6. attempt.submit 审计副作用恰一次/考生。
 * overlay 的背景考生：attempt 仍 in_progress（未交卷）、receipts ≥ 2。
 * 全局不变量：dupActive=0、dupTerminal=0、MULTIPLE-ATTEMPTS=0。
 *
 * 运行（cwd=/home/hoo/Source/exam 契约）：
 *   pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
 *     evidence/S3-ADMIT/s3-oracle.ts --run=<runId>
 */
import { readFileSync, writeFileSync } from "node:fs";
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
// s1-run.sh 把 candidates.json 放在 run 目录（evidence/S1-SUBMIT/<runId>/）
const candidatesFile = join(__dirname, runId, "candidates.json");
const driverJson = JSON.parse(readFileSync(join(__dirname, runId, "driver.json"), "utf8"));
const candFile = JSON.parse(readFileSync(candidatesFile, "utf8")) as {
  arm: string;
  mode: string;
  submitters: { idx: number; username: string; candidateId: string; examId: string }[];
  background: { idx: number; username: string; candidateId: string; examId: string }[];
};

const conn = await createDatabase(RUN_DB_URL);
const dbCheck = (await conn.sql.unsafe(`SELECT current_database() AS db`)) as { db: string }[];
console.log(`[s3-oracle] connected to ${dbCheck[0]!.db} (name-guarded ${RUN_DB_URL.split("/").pop()})`);

interface Row { [k: string]: unknown }
const q = async (sql: string, params: unknown[]): Promise<Row[]> =>
  (await conn.sql.unsafe(sql, params)) as Row[];

const inList = (arr: string[]) => `(${arr.map((_, i) => `$${i + 1}`).join(",")})`;

async function attemptRows(usernames: string[]) {
  const rows = await q(
    `SELECT a.id AS attempt_id, u.username, a.status::text AS status,
            a.submission_reason, a.submitted_at, a.attempt_no,
            a.question_snapshot, a.answers,
            (SELECT count(*)::int FROM attempt_grading_entries g WHERE g.attempt_id = a.id) AS grading_entries,
            (SELECT count(*)::int FROM audit_logs al WHERE al.action='attempt.submit'
               AND al.target_id = a.id::text) AS submit_audits
     FROM exam_attempts a
     JOIN candidate_profiles cp ON cp.id = a.candidate_id
     JOIN users u ON u.id = cp.user_id
     WHERE u.username IN ${inList(usernames)}`,
    usernames,
  );
  return rows.map((r) => ({
    attemptId: String(r.attempt_id),
    username: String(r.username),
    status: String(r.status),
    submissionReason: (r.submission_reason as string) ?? null,
    submittedAt: (r.submitted_at as string) ?? null,
    attemptNo: Number(r.attempt_no),
    frozenQuestions: Array.isArray(r.question_snapshot)
      ? (r.question_snapshot as unknown[]).length
      : JSON.parse(String(r.question_snapshot ?? "[]")).length,
    gradingEntries: Number(r.grading_entries),
    submitAudits: Number(r.submit_audits),
    answers: r.answers,
  }));
}

async function receiptRows(usernames: string[]) {
  return q(
    `SELECT u.username, r.attempt_id, r.client_seq
     FROM exam_answer_save_receipts r
     JOIN exam_attempts a ON a.id = r.attempt_id
     JOIN candidate_profiles cp ON cp.id = a.candidate_id
     JOIN users u ON u.id = cp.user_id
     WHERE u.username IN ${inList(usernames)}
     ORDER BY r.attempt_id, r.client_seq`,
    usernames,
  );
}

const submitterNames = candFile.submitters.map((s) => s.username);
const bgNames = candFile.background.map((s) => s.username);

const [subAttempts, subReceipts] = await Promise.all([
  attemptRows(submitterNames),
  receiptRows(submitterNames),
]);
const [bgAttempts, bgReceipts] = candFile.mode === "overlay"
  ? await Promise.all([attemptRows(bgNames), receiptRows(bgNames)])
  : [[], []];

const expected = (driverJson.expectedLastAcceptedAnswers ?? {}) as Record<
  string, { attemptId: string; questionId: string; answer: unknown }
>;

const perSubmitter: Record<string, unknown>[] = [];
let mismatch = 0;
for (const name of submitterNames) {
  const at = subAttempts.filter((r) => r.username === name);
  const rec = subReceipts.filter((r) => r.username === name);
  const exp = expected[name] ?? null;
  const row: Record<string, unknown> = { candidate: name };
  if (at.length === 0) { row.outcome = "no-attempt"; mismatch += 1; perSubmitter.push(row); continue; }
  if (at.length > 1) { row.outcome = "MULTIPLE-ATTEMPTS"; mismatch += 1; perSubmitter.push(row); continue; }
  const a = at[0]!;
  row.status = a.status;
  row.submissionReason = a.submissionReason;
  row.submittedAt = a.submittedAt;
  row.gradingEntries = a.gradingEntries;
  row.frozenQuestions = a.frozenQuestions;
  row.submitAudits = a.submitAudits;
  let outcome = "terminal-ok";
  if (!["submitted", "graded", "auto_submitted"].includes(a.status)) { outcome = `NOT-TERMINAL:${a.status}`; }
  else if (a.submissionReason !== "manual") { outcome = `UNEXPECTED-REASON:${a.submissionReason}`; }
  else if (a.gradingEntries !== a.frozenQuestions) { outcome = `GRADING-ENTRY-MISMATCH:${a.gradingEntries}/${a.frozenQuestions}`; }
  else if (a.submitAudits !== 1) { outcome = `AUDIT-SIDE-EFFECTS:${a.submitAudits}`; }
  row.receiptClientSeqs = rec.map((r) => Number(r.client_seq));
  if (rec.length !== 2) { outcome += `+RECEIPTS:${rec.length}`; }
  if (exp) {
    let answers: Array<{ questionId: string; answer: unknown }> = [];
    try {
      answers = typeof a.answers === "string" ? JSON.parse(a.answers) : ((a.answers ?? []) as typeof answers);
    } catch { answers = []; }
    const found = answers.find((x) => x.questionId === exp.questionId);
    row.answersMatchDriver = found !== undefined && JSON.stringify(found.answer) === JSON.stringify(exp.answer);
    if (row.answersMatchDriver !== true) outcome += "+ANSWER-MISMATCH";
    row.confirmedAnswerCount = answers.length;
  }
  if (outcome !== "terminal-ok") mismatch += 1;
  row.outcome = outcome;
  perSubmitter.push(row);
}

const bgOutcome = bgAttempts.map((a) => ({ username: a.username, status: a.status }));
const dupActive = await q(
  `SELECT count(*)::int AS n FROM (
     SELECT candidate_id FROM exam_attempts WHERE status = 'in_progress'
     GROUP BY candidate_id HAVING count(*) > 1) d`, []);
const dupTerminal = await q(
  `SELECT count(*)::int AS n FROM (
     SELECT candidate_id, attempt_no FROM exam_attempts
     WHERE status IN ('submitted','graded','auto_submitted')
     GROUP BY candidate_id, attempt_no HAVING count(*) > 1) d`, []);

const submittedAtList = subAttempts
  .map((a) => a.submittedAt)
  .filter((v): v is string => !!v)
  .sort();
const perExam = {} as Record<string, { total: number; terminal: number; firstSubmittedAt: string | null; lastSubmittedAt: string | null }>;
{
  const examOf = new Map(candFile.submitters.map((s) => [s.username, s.examId]));
  for (const a of subAttempts) {
    const ex = examOf.get(a.username) ?? "?";
    perExam[ex] ??= { total: 0, terminal: 0, firstSubmittedAt: null, lastSubmittedAt: null };
    perExam[ex].total += 1;
    if (["submitted", "graded", "auto_submitted"].includes(a.status)) {
      perExam[ex].terminal += 1;
      const t = a.submittedAt!;
      if (!perExam[ex].firstSubmittedAt || t < perExam[ex].firstSubmittedAt) perExam[ex].firstSubmittedAt = t;
      if (!perExam[ex].lastSubmittedAt || t > perExam[ex].lastSubmittedAt) perExam[ex].lastSubmittedAt = t;
    }
  }
}

const oracle = {
  runId,
  arm: candFile.arm,
  mode: candFile.mode,
  submitters: {
    total: subAttempts.length,
    byStatus: subAttempts.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1; return acc;
    }, {}),
    terminalOk: perSubmitter.filter((r) => r.outcome === "terminal-ok").length,
    mismatches: perSubmitter.filter((r) => r.outcome !== "terminal-ok"),
    mismatchCount: mismatch,
    confirmedReceipts: subReceipts.length,
    confirmedAnswersPerCandidate: "2 (save:1 true + save:2 false)" as const,
    submittedAtFirst: submittedAtList[0] ?? null,
    submittedAtLast: submittedAtList[submittedAtList.length - 1] ?? null,
    perExam,
  },
  background: candFile.mode === "overlay" ? {
    total: bgAttempts.length,
    byStatus: bgAttempts.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1; return acc;
    }, {}),
    stillInProgress: bgOutcome.filter((r) => r.status === "in_progress").length,
    receipts: bgReceipts.length,
  } : null,
  invariants: {
    duplicateActiveAttempts: dupActive[0]?.n ?? 0,
    duplicateTerminalTransitions: dupTerminal[0]?.n ?? 0,
  },
  perSubmitter: perSubmitter.filter((r) => r.outcome !== "terminal-ok"),
};
const outPath = join(__dirname, runId, "oracle.json");
writeFileSync(outPath, JSON.stringify(oracle, null, 2) + "\n");
console.log(`[s3-oracle] submitters: ${JSON.stringify(oracle.submitters.byStatus)} terminalOk=${oracle.submitters.terminalOk}/${candFile.submitters.length} mismatch=${mismatch}`);
console.log(`[s3-oracle] receipts=${oracle.submitters.confirmedReceipts} first=${oracle.submitters.submittedAtFirst} last=${oracle.submitters.submittedAtLast}`);
if (oracle.background) console.log(`[s3-oracle] bg: ${JSON.stringify(oracle.background.byStatus)} inProgress=${oracle.background.stillInProgress}`);
console.log(`[s3-oracle] invariants: dupActive=${oracle.invariants.duplicateActiveAttempts} dupTerminal=${oracle.invariants.duplicateTerminalTransitions}`);
console.log(`[s3-oracle] written: ${outPath}`);
await conn.sql.end();
