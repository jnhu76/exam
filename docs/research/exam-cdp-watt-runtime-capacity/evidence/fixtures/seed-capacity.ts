/**
 * [ARCHIVE DERIVED COPY] #900/#1021 归档脱敏副本：第 139 行的合成 proctor 口令字面量已替换为
 * "<redacted-for-archive>"；原字节版本仅研究机保留（研究 worktree
 * docs/research/exam-cdp-watt-runtime-capacity/evidence/fixtures/seed-capacity.ts）。
 */
/**
 * #900/#1021 容量战役合成 fixture 播种（RESEARCH ONLY）。
 *
 * 可重跑契约：
 *   --phase=db    完整重建研究库（name-guard 内 loud DROP/CREATE →
 *                 migratePostgres → canonical seed）。API 必须已停止
 *                 （DROP DATABASE ... WITH (FORCE) 会切断其连接池）。
 *   --phase=data  业务 fixture 重建：course/questions/exams/publish/proctors
 *                 经 canonical admin HTTP API（领域 command，非测量路径），
 *                 合成考生经 DB 批量直插（#550 seedCandidates 副本）。
 *                 前置：API 已在 --api（默认 http://127.0.0.1:3300）监听，
 *                 且库已处于 --phase=db 之后的干净状态。
 *
 * 只允许合成数据（协议 §2.1：cohort 全部为合成考生，仅存在于可重置
 * 研究库 exam_550_e2e）。fixture 规模（协议 §2.3）：
 *   同场组 1 场 × 200 合成考生；跨场组 10 场 × 20（同蓝图：同 course、
 *   同 12 题、同评分配比）；1 admin（canonical seed）+ 2 proctor。
 *
 * AGENTS.md §6 四步前置在 topology.sh 与 evidence/topology.md 中落实：
 * name-guard（exam_550 前缀）+ 实际连接库的 SELECT current_database() 验证。
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshRunDatabase, seedCandidates, type DbConn } from "../../harness/lib/db.js";
import { Client } from "../../harness/lib/http.js";
import {
  ADMIN,
  API_BASE_URL,
  args,
  FIXTURES_DIR,
  PUBLIC_ORIGIN,
  RUN_DB,
  RUN_DB_URL,
} from "../../harness/lib/config.js";
import { createDatabase } from "../../../../../packages/db/src/database.js";

const SAME_FIELD_CANDIDATES = 200;
const CROSS_FIELD_EXAMS = 10;
const CROSS_FIELD_CANDIDATES_PER_EXAM = 20;
const QUESTIONS_PER_BLUEPRINT = 12;

interface ExamFixture {
  examId: string;
  title: string;
  candidates: string[];
  candidateIds: string[];
}

async function expectStatus(
  what: string,
  res: { status: number; body: string },
  ...ok: number[]
): Promise<void> {
  if (!ok.includes(res.status)) {
    throw new Error(`${what}: ${res.status} ${res.body.slice(0, 300)}`);
  }
}

async function orgIdOf(conn: DbConn): Promise<string> {
  const rows = await conn.sql.unsafe(
    `SELECT id::text AS id FROM organizations ORDER BY created_at LIMIT 1`,
  );
  return rows[0]!.id as string;
}

async function createCourseAndQuestions(
  admin: Client,
  label: string,
): Promise<{ courseId: string; questionIds: string[] }> {
  const course = await admin.json("POST", "/api/courses", {
    name: `cap900-${label}`,
    code: `cap900-${label}-${Date.now()}`,
    description: "",
  });
  await expectStatus(`course(${label})`, course, 201);
  const courseId = (course.parsed as { id: string }).id;
  const questionIds: string[] = [];
  for (let i = 0; i < QUESTIONS_PER_BLUEPRINT; i++) {
    const q = await admin.json("POST", "/api/questions", {
      courseId,
      type: "true_false",
      content: `Q${i}`,
      standardAnswer: i % 2 === 0,
      score: 10,
    });
    await expectStatus(`question(${label}#${i})`, q, 201);
    questionIds.push((q.parsed as { id: string }).id);
  }
  return { courseId, questionIds };
}

async function createPublishedExam(
  admin: Client,
  courseId: string,
  questionIds: string[],
  title: string,
): Promise<string> {
  const res = await admin.json("POST", "/api/exams", {
    title,
    description: "",
    courseId,
    timingMode: "timed_window",
    durationMinutes: 90,
    openAt: new Date(Date.now() - 3600_000).toISOString(),
    closeAt: new Date(Date.now() + 86_400_000).toISOString(),
    passingScore: 60,
    totalScore: 120,
    questionSelectionMode: "manual",
    questionIds,
    resultPublicationMode: "immediate",
    controlFlags: {
      shuffleQuestions: false,
      shuffleOptions: false,
      detectTabSwitch: false,
      disableCopyPaste: false,
      requireQueue: false,
      showResultImmediately: true,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 1,
    interruptionTimePolicy: "strict",
  });
  await expectStatus(`exam(${title})`, res, 201);
  const examId = (res.parsed as { id: string }).id;
  const pub = await admin.json("POST", `/api/exams/${examId}/publish`, {});
  await expectStatus(`publish(${title})`, pub, 200);
  return examId;
}

async function createProctor(
  admin: Client,
  name: string,
): Promise<string> {
  const username = `cap900p${Date.now()}${name.slice(-1)}`;
  const created = await admin.json("POST", "/api/users", {
    username,
    password: "<redacted-for-archive>", // 脱敏；见文件头
    name,
    role: "Proctor",
  });
  await expectStatus(`proctor create(${name})`, created, 201);
  return (created.parsed as { id: string }).id;
}

async function assignProctor(
  admin: Client,
  examId: string,
  proctorUserId: string,
): Promise<void> {
  const assigned = await admin.json(
    "POST",
    `/api/admin/exams/${examId}/proctors`,
    { operationId: randomUUID(), proctorUserId },
  );
  await expectStatus(`proctor assign(${examId})`, assigned, 200, 201);
}

async function phaseDb(): Promise<void> {
  // freshRunDatabase 内含 name-guard（assertRunDb：exam_550 前缀）、loud
  // DROP/CREATE WITH (FORCE)、migratePostgres、canonical seed（org+admin）。
  const conn = await freshRunDatabase();
  const db = await conn.sql.unsafe(`SELECT current_database() AS db`);
  console.log(
    `[seed] rebuilt ${db[0]!.db} (name-guarded ${RUN_DB}); migrations + canonical seed applied`,
  );
  await conn.sql.end();
}

async function phaseData(apiBaseUrl: string): Promise<void> {
  const conn = await createDatabase(RUN_DB_URL);
  const db = await conn.sql.unsafe(`SELECT current_database() AS db`);
  console.log(`[seed] data phase connected to ${db[0]!.db}`);
  const orgId = await orgIdOf(conn);

  const admin = new Client({ baseUrl: apiBaseUrl, id: "seed-admin", origin: PUBLIC_ORIGIN });
  const login = await admin.login(ADMIN.username, ADMIN.password);
  await expectStatus("admin login", login, 200);

  // ── 蓝图 A：同场组（1 场 × 200）────────────────────────────────────────
  const sameBp = await createCourseAndQuestions(admin, "same");
  const sameExamId = await createPublishedExam(
    admin,
    sameBp.courseId,
    sameBp.questionIds,
    "cap900 same-field S200",
  );
  const sameProctorId = await createProctor(admin, "cap900 proctor same");
  await assignProctor(admin, sameExamId, sameProctorId);
  const sameSeeded = await seedCandidates(conn, {
    orgId,
    examId: sameExamId,
    count: SAME_FIELD_CANDIDATES,
    prefix: "cap9same",
  });
  const sameFixture: ExamFixture = {
    examId: sameExamId,
    title: "cap900 same-field S200",
    candidates: sameSeeded.usernames,
    candidateIds: sameSeeded.candidateIds,
  };

  // ── 蓝图 B：跨场组（10 场 × 20，同 12 题同评分配比）──────────────────
  const crossBp = await createCourseAndQuestions(admin, "cross");
  const crossProctorId = await createProctor(admin, "cap900 proctor cross");
  const crossFixtures: ExamFixture[] = [];
  for (let k = 1; k <= CROSS_FIELD_EXAMS; k++) {
    const examId = await createPublishedExam(
      admin,
      crossBp.courseId,
      crossBp.questionIds,
      `cap900 cross-field ${String(k).padStart(2, "0")}/10`,
    );
    await assignProctor(admin, examId, crossProctorId);
    const seeded = await seedCandidates(conn, {
      orgId,
      examId,
      count: CROSS_FIELD_CANDIDATES_PER_EXAM,
      prefix: `cap9x${String(k).padStart(2, "0")}`,
    });
    crossFixtures.push({
      examId,
      title: `cap900 cross-field ${String(k).padStart(2, "0")}/10`,
      candidates: seeded.usernames,
      candidateIds: seeded.candidateIds,
    });
  }

  // ── manifest（无凭据：合成密码为 config.ts 常量；哈希只记算法与参数）─
  const manifest = {
    campaign: "exam-cdp-watt-runtime-capacity (#900/#1021)",
    generatedAt: new Date().toISOString(),
    database: RUN_DB,
    sameField: sameFixture,
    crossField: crossFixtures,
    totals: {
      syntheticCandidates:
        SAME_FIELD_CANDIDATES + CROSS_FIELD_EXAMS * CROSS_FIELD_CANDIDATES_PER_EXAM,
      exams: 1 + CROSS_FIELD_EXAMS,
      questionsPerExam: QUESTIONS_PER_BLUEPRINT,
      blueprintCourses: 2,
      proctors: 2,
      adminViaCanonicalSeed: 1,
    },
    candidateCredentials: {
      passwordConstant: "CANDIDATE_PASSWORD in harness/lib/config.ts (synthetic)",
      passwordHash: {
        algorithm: "argon2id",
        library: "argon2 (repo dependency)",
        params: { memoryCost: 65536, timeCost: 3, parallelism: 4 },
      },
    },
    examShape: {
      timingMode: "timed_window",
      durationMinutes: 90,
      questionType: "true_false",
      scorePerQuestion: 10,
      totalScore: 120,
      maxAttempts: 1,
      requireQueue: false,
    },
  };
  const manifestPath = join(FIXTURES_DIR, "seed-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(
    `[seed] data phase complete: ` +
      `${manifest.totals.syntheticCandidates} synthetic candidates, ` +
      `${manifest.totals.exams} exams (${QUESTIONS_PER_BLUEPRINT} questions each), ` +
      `${manifest.totals.proctors} proctors; manifest: ${manifestPath}`,
  );
  await admin.close();
  await conn.sql.end();
}

const phase = args().phase ?? "all";
const api = args().api ?? API_BASE_URL;
if (phase === "db") {
  await phaseDb();
} else if (phase === "data") {
  await phaseData(api);
} else {
  throw new Error(`--phase=db|data required (got: ${phase})`);
}
