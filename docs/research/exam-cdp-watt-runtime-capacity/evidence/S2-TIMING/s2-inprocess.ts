/**
 * S2-TIMING in-process runner — class ② cross-deadline interleavings
 * (RESEARCH ONLY; PROTOCOL §10 S2-TIMING「受控服务端时钟、确定性 barrier 与
 * 真实 PG 事务」; ADDENDUM §2.3 四类各一遍，①②浏览器面由事务测试覆盖).
 *
 * Instrument = REAL production routes driven in-process against a REAL
 * PostgreSQL database (dedicated `exam_test_s2`, created/dropped by this
 * harness; name-guarded; the live A process never touches it — its background
 * deadline scanner therefore cannot interfere):
 *   - buildTestApp registers the real attempt routes + auth + audit lifecycle
 *     (apps/api/src/routes/testHelpers.ts);
 *   - the REAL server clock seam fastify.now() is controlled via the plugin's
 *     own setNowOverride hook (apps/api/src/plugins/now.ts:28) — the manual
 *     submit/save routes sample it at route entry exactly as in production
 *     (attempts.candidate.ts:986/:1207);
 *   - deterministic serialization barrier = a second real PG connection
 *     holding `exam_enrollments.id FOR UPDATE` (the EA lock seam every
 *     save/submit transaction takes first);
 *   - the scanner side invokes the REAL per-candidate scanner function
 *     autoSubmitAndGrade (apps/api/src/plugins/deadlineScanner.ts:215) with a
 *     controlled per-candidate `now` (the tick's nowFn re-sample, :419).
 *
 * Run (cwd=/home/hoo/Source/exam contract):
 *   pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/api exec tsx \
 *     /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S2-TIMING/s2-inprocess.ts \
 *     --run-id=S2-INPROCESS-r1
 *
 * Assertions encode evidence/S2-TIMING/expected.md §2 (pre-registered).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const argz = Object.fromEntries(
  process.argv.slice(2).map((a) => /^--([^=]+)=(.*)$/.exec(a)?.slice(1, 3) ?? [a.slice(2), "true"]),
);
const RUN_ID = argz["run-id"] ?? `S2-INPROCESS-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13)}`;
const OUT_DIR = join(__dirname, RUN_ID);
mkdirSync(OUT_DIR, { recursive: true });

// ── env BEFORE any config-reading module body runs (dynamic imports below) ──
const S2_DB = "exam_test_s2"; // name-guard: literal; contains "test" (testing.md §2.2/§2.8)
const MAINT_URL = "postgres://exam:exam@127.0.0.1:5432/postgres";
const S2_DB_URL = `postgres://exam:exam@127.0.0.1:5432/${S2_DB}`;
process.env.APP_MODE = "test";
process.env.NODE_ENV = "test";
process.env.TEST_DATABASE_URL = S2_DB_URL;
// dedicated throw-away DB owned by THIS harness: per-file schema isolation is
// pointless and would hide the tables from harness-side raw SQL.
process.env.TEST_DB_ISOLATION = "0";

const t0 = performance.now();
const mono = () => Math.round((performance.now() - t0) * 1000) / 1000;
const wall = () => new Date().toISOString();
const results: Array<{ case: string; assertion: string; expected: unknown; actual: unknown; pass: boolean }> = [];
const samples: unknown[] = [];
function log(m: string) { console.log(`[${RUN_ID}] ${m}`); }
function record(ev: unknown) { const r = { ...(ev as object), monoAt: mono(), wallAt: wall() }; samples.push(r); log(JSON.stringify(r)); }
function assert(caseName: string, name: string, expected: unknown, actual: unknown, pass: boolean) {
  results.push({ case: caseName, assertion: name, expected, actual, pass });
  log(`${pass ? "PASS" : "FAIL"} ${caseName}·${name}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

async function main() {
  if (process.env.CAPACITY_DB && !process.env.CAPACITY_DB.startsWith("exam_550")) {
    throw new Error("guard: refusing to run alongside a non-campaign DB env");
  }
  // 1) fresh dedicated test database (loud, guarded)
  const { createDatabase } = await import("../../../../../packages/db/src/database.js");
  const maint = await createDatabase(MAINT_URL);
  await maint.sql.unsafe(`DROP DATABASE IF EXISTS ${S2_DB} WITH (FORCE)`);
  await maint.sql.unsafe(`CREATE DATABASE ${S2_DB}`);
  await maint.sql.end();
  record({ ev: "db-rebuilt", db: S2_DB });

  // 2) real app on the fresh DB
  const modHelpers = await import("../../../../../apps/api/src/routes/testHelpers.js");
  const examRoutesMod = await import("../../../../../apps/api/src/routes/exam.js");
  const attemptRoutesMod = await import("../../../../../apps/api/src/routes/attempts.js");
  const deadlineScannerMod = await import("../../../../../apps/api/src/plugins/deadlineScanner.js");
  // bare workspace specifiers don't resolve from the research dir — relative src imports
  const authzMod = await import("../../../../../packages/authz/src/index.js");
  const dbSchemaMod = await import("../../../../../packages/db/src/schema/pg.js");

  const ctx = await modHelpers.buildTestApp(
    async (fastify) => {
      await fastify.register(examRoutesMod.default, { prefix: "" });
      await fastify.register(attemptRoutesMod.default, { prefix: "" });
    },
    { databaseUrl: S2_DB_URL },
  );
  const { schema } = dbSchemaMod;
  const db = ctx.db;

  // 3) fixture: ONE exam (12 × true_false, mirrors the capacity seed blueprint),
  //    five candidates, five started attempts (real start route).
  const QUESTION_COUNT = 12;
  const now0 = new Date();
  const orgId = ctx.org.id;
  const course = (await db.insert(schema.courses).values({
    id: randomUUID(), organizationId: orgId, name: "S2 course", code: `S2-${Date.now()}`,
    description: "", createdAt: now0, updatedAt: now0,
  }).returning())[0]!;
  const questions = [] as { id: string }[];
  for (let i = 0; i < QUESTION_COUNT; i++) {
    const q = (await db.insert(schema.questions).values({
      id: randomUUID(), organizationId: orgId, courseId: course.id,
      type: "true_false" as const, content: `S2 Q${i}`, options: [] as {id:string;content:string}[],
      standardAnswer: i % 2 === 0, attachments: [], score: 10, difficulty: 1, tags: [],
      gradingRule: { multiSelectScoring: "all_correct_full", fillBlankMatchMode: "exact" },
      createdAt: now0, updatedAt: now0,
    }).returning())[0]!;
    questions.push({ id: q.id });
  }
  const exam = (await db.insert(schema.exams).values({
    id: randomUUID(), organizationId: orgId, title: "S2 timing exam", description: "",
    courseId: course.id, status: "published",
    timingMode: "timed_window" as const, durationMinutes: 90,
    openAt: new Date(now0.getTime() - 3_600_000), closeAt: new Date(now0.getTime() + 86_400_000),
    passingScore: 60, totalScore: 120, questionSelectionMode: "manual",
    questionIds: questions.map((q) => q.id),
    questionSnapshot: questions.map((q, i) => ({
      originalQuestionId: q.id, type: "true_false" as const, content: `S2 Q${i}`,
      contentDocument: null, answerMode: null, attachments: [], options: [],
      standardAnswer: i % 2 === 0, score: 10,
      gradingRule: { multiSelectScoring: "all_correct_full", fillBlankMatchMode: "exact" },
      order: i, rubric: null,
    })),
    controlFlags: {
      shuffleQuestions: false, shuffleOptions: false, detectTabSwitch: false,
      disableCopyPaste: false, requireQueue: false, batchSize: 10, batchInterval: 3,
      restrictIp: false, requireLockdown: false, showResultImmediately: true,
    },
    retakePolicy: "unlimited", scoreStrategy: "highest", maxAttempts: 1,
    interruptionTimePolicy: "strict",
    interruptionGracePerIncidentSeconds: null, interruptionGracePerAttemptSeconds: null,
    createdAt: now0, updatedAt: now0,
  }).returning())[0]!;

  interface CaseFix { username: string; userId: string; profileId: string; enrollmentId: string; attemptId: string; cookieToken: string; }
  const fixtures: CaseFix[] = [];
  for (let i = 0; i < 6; i++) {
    const u = await modHelpers.createAssignedUserForTest(db, orgId, "Candidate", `s2c${i}`);
    const profile = (await db.insert(schema.candidateProfiles).values({
      id: randomUUID(), organizationId: orgId, userId: u.user.id, fields: {},
      createdAt: now0, updatedAt: now0,
    }).returning())[0]!;
    const enrollRes = await ctx.app.inject({
      method: "POST", url: `/api/exams/${exam.id}/enrollments`,
      payload: { candidateIds: [profile.id] }, cookies: { "auth-token": ctx.adminToken },
    });
    if (enrollRes.statusCode !== 200) throw new Error(`enroll failed: ${enrollRes.statusCode} ${enrollRes.body}`);
    const startRes = await ctx.app.inject({
      method: "POST", url: `/api/attempts/${exam.id}/start`,
      cookies: { "auth-token": u.token },
    });
    if (startRes.statusCode !== 201) throw new Error(`start failed: ${startRes.statusCode} ${startRes.body}`);
    const attemptId = (startRes.json() as { id: string }).id;
    const enr = await ctx.conn.sql`SELECT id::text FROM exam_enrollments WHERE exam_id=${exam.id} AND candidate_id=${profile.id}`;
    fixtures.push({ username: u.user.username, userId: u.user.id, profileId: profile.id, enrollmentId: String(enr[0]!.id), attemptId, cookieToken: u.token });
  }
  record({ ev: "fixture-ready", examId: exam.id, candidates: fixtures.map((f) => f.username), questions: QUESTION_COUNT });

  // ── shared helpers ──────────────────────────────────────────────────────
  const setDeadline = async (attemptId: string, d: Date) => {
    await ctx.conn.sql`UPDATE exam_attempts SET deadline_at=${d.toISOString()}::timestamptz WHERE id=${attemptId}`;
  };
  async function saveAnswer(f: CaseFix, answer: boolean, clientSeq: number, baseVersion: number) {
    const q1 = questions[0]!.id;
    const res = await ctx.app.inject({
      method: "POST", url: `/api/attempts/${f.attemptId}/answers/${q1}`,
      payload: { attemptId: f.attemptId, questionId: q1, answer, clientSeq, clientSavedAt: new Date().toISOString(), baseVersion },
      cookies: { "auth-token": f.cookieToken },
    });
    return { status: res.statusCode, body: res.json() as { accepted: boolean; reason?: string; serverVersion?: number } };
  }
  async function submit(f: CaseFix) {
    const res = await ctx.app.inject({ method: "POST", url: `/api/attempts/${f.attemptId}/submit`, cookies: { "auth-token": f.cookieToken } });
    return { status: res.statusCode, body: res.json() as { status: string; submittedAt?: string; serverNow: string } };
  }
  async function oracle(attemptId: string) {
    const r = await ctx.conn.sql`
      SELECT status::text AS status, coalesce(submission_reason,'') AS reason,
             CASE WHEN submitted_at IS NULL THEN NULL ELSE (extract(epoch from submitted_at)*1000)::bigint END AS submitted_ms,
             (SELECT count(*)::int FROM attempt_grading_entries g WHERE g.attempt_id=a.id) AS entries,
             (SELECT count(*)::int FROM audit_logs al WHERE al.action='attempt.submit' AND al.target_id=a.id::text) AS audits,
             coalesce((SELECT e.final_score::text FROM exam_enrollments e WHERE e.id=a.enrollment_id),'') AS final_score
      FROM exam_attempts a WHERE id=${attemptId}`;
    const row = r[0] as unknown as { status: string; reason: string; submitted_ms: string | null; entries: number; audits: number; final_score: string };
    const rec = await ctx.conn.sql`SELECT coalesce(string_agg(client_seq::text, ',' ORDER BY client_seq),'') AS saved FROM exam_answer_save_receipts WHERE attempt_id=${attemptId}`;
    return { status: row.status, reason: row.reason, submittedMs: row.submitted_ms === null ? null : Number(row.submitted_ms), entries: row.entries, audits: row.audits, finalScore: row.final_score, saved: String(rec[0]!.saved) };
  }
  const sleepUntil = async (tMs: number) => { const d = tMs - Date.now(); if (d > 0) await new Promise((r) => setTimeout(r, d)); };

  // Barrier: second real PG connection holding the enrollment row FOR UPDATE.
  const barrierConn = await createDatabase(S2_DB_URL);
  async function holdLock(enrollmentId: string) {
    const c = await barrierConn.sql.reserve();
    await c`BEGIN`;
    await c`SELECT id FROM exam_enrollments WHERE id=${enrollmentId} FOR UPDATE`;
    record({ ev: "barrier-held", enrollmentId });
    return {
      release: async () => { await c`ROLLBACK`; c.release(); record({ ev: "barrier-released", enrollmentId }); },
    };
  }

  // ═══ ②-a manual submit took server time BEFORE deadline; processing crosses it; MANUAL holds the lock queue first ═══
  {
    const C = "②-a manual-first-cross-deadline";
    const f = fixtures[0]!;
    ctx.setNow(null);
    const s1 = await saveAnswer(f, true, 1, 0);
    const T = new Date(Date.now() + 4_000);
    await setDeadline(f.attemptId, T);
    const barrier = await holdLock(f.enrollmentId);
    ctx.setNow(new Date(T.getTime() - 2_000)); // route-entry sample: T-2s (< deadline)
    const submitP = submit(f);
    await sleepUntil(T.getTime() + 1_000); // real clock crosses the deadline while parked
    record({ ev: "case2a-deadline-crossed", realNow: wall(), deadlineMs: T.getTime() });
    await barrier.release();
    const r = await submitP;
    await ctx.drainAuditWritesStrict();
    const o = await oracle(f.attemptId);
    record({ ev: "case2a-done", http: { status: r.status, bodySubmittedAt: r.body.submittedAt }, db: o });
    assert(C, "save v1 accepted before schedule", true, s1.body.accepted === true, s1.body.accepted === true);
    assert(C, "submit 200 after barrier release", 200, r.status, r.status === 200);
    assert(C, "submissionReason manual (pre-deadline route sample governs)", "manual", o.reason, o.reason === "manual");
    assert(C, "submittedAt == route-entry sample (T-2s) not wall clock", T.getTime() - 2_000, o.submittedMs, o.submittedMs === T.getTime() - 2_000);
    assert(C, "status graded", "graded", o.status, o.status === "graded");
    assert(C, "grading entries 12", 12, o.entries, o.entries === QUESTION_COUNT);
    assert(C, "attempt.submit audit exactly 1", 1, o.audits, o.audits === 1);
    assert(C, "finalScore written (已评分)", true, o.finalScore !== "", o.finalScore !== "");
  }

  // ═══ ②-b SCANNER acquires the locks first (past deadline); late manual request with pre-deadline sample ═══
  {
    const C = "②-b scanner-first";
    const f = fixtures[1]!;
    ctx.setNow(null);
    await saveAnswer(f, true, 1, 0);
    const T = new Date(Date.now() + 2_000);
    await setDeadline(f.attemptId, T);
    await sleepUntil(T.getTime() + 1_000);
    // REAL scanner per-candidate function, controlled per-candidate now (deadlineScanner.ts:419)
    const systemCtx = authzMod.createSystemRequestContext(orgId, authzMod.SYSTEM_ACTOR_IDS.DeadlineScanner);
    const changed = await deadlineScannerMod.autoSubmitAndGrade(
      ctx.db as never, systemCtx, f.attemptId, new Date(T.getTime() + 1_000),
    );
    const oAfterScan = await oracle(f.attemptId);
    record({ ev: "case2b-scanner-ran", changed, db: oAfterScan });
    ctx.setNow(new Date(T.getTime() - 500)); // manual route-entry sample predates deadline…
    const r = await submit(f); // …but the scanner already committed: locks acquired later
    ctx.setNow(null);
    await ctx.drainAuditWritesStrict();
    const o = await oracle(f.attemptId);
    record({ ev: "case2b-done", http: { status: r.status, bodyStatus: r.body.status }, db: o });
    assert(C, "scanner stateChanged=true", true, changed === true, changed === true);
    assert(C, "scanner submittedAt == effectiveDeadline T (backdated)", T.getTime(), oAfterScan.submittedMs, oAfterScan.submittedMs === T.getTime());
    assert(C, "submissionReason deadline", "deadline", oAfterScan.reason, oAfterScan.reason === "deadline");
    assert(C, "late manual POST → 200 (merged, no error)", 200, r.status, r.status === 200);
    assert(C, "manual merge: reason stays deadline", "deadline", o.reason, o.reason === "deadline");
    assert(C, "submittedAt unchanged (still T)", T.getTime(), o.submittedMs, o.submittedMs === T.getTime());
    assert(C, "attempt.submit audit stays 0 (no manual submit executed)", 0, o.audits, o.audits === 0);
    assert(C, "grading entries 12", 12, o.entries, o.entries === QUESTION_COUNT);
  }

  // ═══ ②-c boundary equality: route now == effectiveDeadline exactly ═══
  {
    const C = "②-c boundary now==T";
    const f = fixtures[2]!;
    ctx.setNow(null);
    await saveAnswer(f, true, 1, 0);
    const T = new Date(Date.now() + 3_000);
    await setDeadline(f.attemptId, T);
    ctx.setNow(T); // EXACT equality with effectiveDeadline (ms)
    const r = await submit(f);
    ctx.setNow(null);
    await ctx.drainAuditWritesStrict();
    const o = await oracle(f.attemptId);
    record({ ev: "case2c-done", http: { status: r.status }, db: o, Tms: T.getTime() });
    assert(C, "submit 200", 200, r.status, r.status === 200);
    assert(C, "≥ operator: equality EXPIRED → deadline freeze", "deadline", o.reason, o.reason === "deadline");
    assert(C, "submittedAt == T (business deadline backfill)", T.getTime(), o.submittedMs, o.submittedMs === T.getTime());
    assert(C, "audit 0 (no manual submit ran)", 0, o.audits, o.audits === 0);
    assert(C, "graded with 12 entries", 12, o.entries, o.entries === QUESTION_COUNT);
  }

  // ═══ ②-d boundary: route now == effectiveDeadline − 1ms ═══
  {
    const C = "②-d boundary now==T-1ms";
    const f = fixtures[3]!;
    ctx.setNow(null);
    await saveAnswer(f, true, 1, 0);
    const T = new Date(Date.now() + 3_000);
    await setDeadline(f.attemptId, T);
    ctx.setNow(new Date(T.getTime() - 1));
    const r = await submit(f);
    ctx.setNow(null);
    await ctx.drainAuditWritesStrict();
    const o = await oracle(f.attemptId);
    record({ ev: "case2d-done", http: { status: r.status }, db: o, Tms: T.getTime() });
    assert(C, "submit 200", 200, r.status, r.status === 200);
    assert(C, "manual submit at T-1ms", "manual", o.reason, o.reason === "manual");
    assert(C, "submittedAt == T-1ms (route sample)", T.getTime() - 1, o.submittedMs, o.submittedMs === T.getTime() - 1);
    assert(C, "audit 1", 1, o.audits, o.audits === 1);
    assert(C, "graded with 12 entries", 12, o.entries, o.entries === QUESTION_COUNT);
  }

  // ═══ ②-e save-side boundary (same ≥ operator) — CORRECTED layout ═══
  // PREDICTION-CORRECTED (r1): expected.md §2②-e assumed a save at now==T is
  // rejected by the pure deadline guard (DEADLINE_EXCEEDED). Measured r1: the
  // save route's inline reconciliation (prepareReconciledAttemptMutation →
  // ensureAttemptDeadlineReconciled) freezes the attempt FIRST in the same
  // transaction; saveAnswer then sees status=submitted → the status guard
  // wins and returns ATTEMPT_ALREADY_SUBMITTED. DEADLINE_EXCEEDED is only
  // reachable for direct engine callers that bypass reconciliation. Layout
  // corrected below: e1 on a fresh attempt, e2 on a separate fresh attempt,
  // plus the pure-seam boundary check.
  {
    const C = "②-e1 save at now==T (inline reconcile freezes first)";
    const f = fixtures[4]!;
    ctx.setNow(null);
    const T = new Date(Date.now() + 3_000);
    await setDeadline(f.attemptId, T);
    ctx.setNow(T); // exact equality
    const e1 = await saveAnswer(f, true, 1, 0);
    ctx.setNow(null);
    await ctx.drainAuditWritesStrict();
    const o = await oracle(f.attemptId);
    record({ ev: "case2e1-done", e1, db: o, Tms: T.getTime() });
    assert(C, "save at now==T → 200 accepted:false", { accepted: false }, { accepted: e1.body.accepted }, e1.status === 200 && e1.body.accepted === false);
    assert(C, "rejection surfaces ATTEMPT_ALREADY_SUBMITTED (inline freeze precedes pure guard)",
      "ATTEMPT_ALREADY_SUBMITTED", e1.body.reason, e1.body.reason === "ATTEMPT_ALREADY_SUBMITTED");
    assert(C, "inline reconcile froze: reason=deadline", "deadline", o.reason, o.reason === "deadline");
    assert(C, "frozen submittedAt == T", T.getTime(), o.submittedMs, o.submittedMs === T.getTime());
    assert(C, "graded with 12 entries / audit 0", "12|0", `${o.entries}|${o.audits}`, o.entries === QUESTION_COUNT && o.audits === 0);
  }
  {
    const C = "②-e2 save at now==T-1ms (accepted)";
    const f = fixtures[5]!;
    ctx.setNow(null);
    const T = new Date(Date.now() + 3_000);
    await setDeadline(f.attemptId, T);
    ctx.setNow(new Date(T.getTime() - 1));
    const e2 = await saveAnswer(f, true, 1, 0);
    ctx.setNow(null);
    const o = await oracle(f.attemptId);
    record({ ev: "case2e2-done", e2, db: o });
    assert(C, "save at now==T-1ms → accepted", true, e2.body.accepted === true, e2.body.accepted === true);
    assert(C, "receipt [1] written (已保存)", "1", o.saved, o.saved === "1");
    assert(C, "attempt stays in_progress (no freeze)", "in_progress", o.status, o.status === "in_progress");
  }
  {
    // pure canonical seam boundary (direct engine caller — pins ≥ on the save-side decision itself)
    const C = "②-e3 pure save decision boundary";
    const eng = await import("../../../../../packages/exam-engine/src/answerProtocol.js");
    const qid = questions[0]!.id;
    const baseState = { attemptStatus: "in_progress" as const, answers: [] as never[], knownReceipt: null };
    const req = { attemptId: "00000000-0000-4000-8000-000000000000", questionId: qid, answer: true, clientSeq: 1, clientSavedAt: new Date().toISOString(), baseVersion: 0 };
    const T = new Date(Date.now() + 60_000);
    const atBoundary = eng.processSaveAnswer({ ...baseState, deadlineAt: T, now: T }, req);
    const beforeBoundary = eng.processSaveAnswer({ ...baseState, deadlineAt: T, now: new Date(T.getTime() - 1) }, req);
    record({ ev: "case2e3-done", atBoundary: { accepted: atBoundary.accepted, reason: atBoundary.conflict?.reason }, beforeBoundary: { accepted: beforeBoundary.accepted } });
    assert(C, "processSaveAnswer at now==deadline → DEADLINE_EXCEEDED (≥)", true,
      !atBoundary.accepted && atBoundary.conflict?.reason === "DEADLINE_EXCEEDED",
      !atBoundary.accepted && atBoundary.conflict?.reason === "DEADLINE_EXCEEDED");
    assert(C, "processSaveAnswer at now==deadline-1ms → accepted", true, beforeBoundary.accepted === true, beforeBoundary.accepted === true);
  }

  // ── teardown ─────────────────────────────────────────────────────────────
  await ctx.cleanup();
  await barrierConn.sql.end();
  const failed = results.filter((r) => !r.pass);
  writeFileSync(join(OUT_DIR, "assertions.json"), JSON.stringify({ runId: RUN_ID, db: S2_DB, total: results.length, failed: failed.length, results }, null, 2) + "\n");
  writeFileSync(join(OUT_DIR, "samples.jsonl"), samples.map((s) => JSON.stringify(s)).join("\n") + "\n");
  log(`SUMMARY total=${results.length} failed=${failed.length} db=${S2_DB}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
  // drop the dedicated test database (归还：loud drop, guarded name)
  const maint2 = await createDatabase(MAINT_URL);
  await maint2.sql.unsafe(`DROP DATABASE IF EXISTS ${S2_DB} WITH (FORCE)`);
  await maint2.sql.end();
  record({ ev: "db-dropped", db: S2_DB });
}

main().catch(async (e) => {
  log(`FATAL ${String(e?.stack ?? e)}`);
  writeFileSync(join(OUT_DIR, "fatal.txt"), String(e?.stack ?? e) + "\n");
  try {
    const { createDatabase } = await import("../../../../../packages/db/src/database.js");
    const maint2 = await createDatabase(MAINT_URL);
    await maint2.sql.unsafe(`DROP DATABASE IF EXISTS ${S2_DB} WITH (FORCE)`);
    await maint2.sql.end();
  } catch { /* best-effort cleanup */ }
  process.exit(2);
});
