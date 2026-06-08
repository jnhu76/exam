import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { SqliteDatabase } from "./types.js";
import { sqliteSchema } from "./schema/sqlite.js";
import type {
  QuestionSnapshot,
  QuestionScoreResult,
  AnswerRecord,
  ControlFlags,
  GradingRule,
  AttemptStatus,
  EnrollmentStatus,
  ExamStatus,
  TimingMode,
  QuestionSelectionMode,
  RetakePolicy,
  ScoreStrategy,
} from "@exam/domain";
import { gradeAnswers } from "@exam/domain";

export type HashFunction = (password: string) => Promise<string>;

const DEMO_ORG_SLUG = "demo";
const DEMO_TAG = "demo-seed";

function ts(offsetMs = 0): Date {
  return new Date(Date.now() + offsetMs);
}

function uuid(tag: string): string {
  return randomUUID();
}

interface DemoIds {
  orgId: string;
  settingsId: string;
  users: Record<string, string>;
  candidateFields: Record<string, string>;
  courses: Record<string, string>;
  questions: Record<string, string>;
  exams: Record<string, string>;
  enrollments: Record<string, string>;
  attempts: Record<string, string>;
}

function makeDefaultControlFlags(): ControlFlags {
  return {
    shuffleQuestions: false,
    shuffleOptions: false,
    detectTabSwitch: false,
    disableCopyPaste: false,
    requireQueue: false,
    batchSize: 1,
    batchInterval: 60,
    restrictIp: false,
    requireLockdown: false,
    showResultImmediately: true,
  };
}

function makeStrictControlFlags(): ControlFlags {
  return {
    shuffleQuestions: true,
    shuffleOptions: true,
    detectTabSwitch: true,
    disableCopyPaste: true,
    requireQueue: false,
    batchSize: 1,
    batchInterval: 60,
    restrictIp: false,
    requireLockdown: true,
    showResultImmediately: false,
  };
}

function makeGradingRule(overrides: Partial<GradingRule> = {}): GradingRule {
  return {
    multiSelectScoring: "all_correct_full",
    fillBlankMatchMode: "exact",
    fillBlankCaseSensitive: false,
    ...overrides,
  };
}

export async function seedDemo(
  db: SqliteDatabase,
  hashFn: HashFunction,
): Promise<DemoIds> {
  const now = Date.now();
  const ids: DemoIds = {
    orgId: "",
    settingsId: "",
    users: {},
    candidateFields: {},
    courses: {},
    questions: {},
    exams: {},
    enrollments: {},
    attempts: {},
  };

  // ── Organization ──────────────────────────────────────────────
  const existingOrg = db
    .select()
    .from(sqliteSchema.organizations)
    .where(eq(sqliteSchema.organizations.slug, DEMO_ORG_SLUG))
    .get();

  if (existingOrg) {
    ids.orgId = existingOrg.id;
  } else {
    ids.orgId = uuid("org");
    db.insert(sqliteSchema.organizations)
      .values({
        id: ids.orgId,
        name: "Demo Organization",
        displayName: "Demo Organization",
        slug: DEMO_ORG_SLUG,
        createdAt: ts(),
        updatedAt: ts(),
      })
      .run();
  }

  // ── OrganizationSettings ──────────────────────────────────────
  const existingSettings = db
    .select()
    .from(sqliteSchema.organizationSettings)
    .where(eq(sqliteSchema.organizationSettings.organizationId, ids.orgId))
    .get();

  if (!existingSettings) {
    ids.settingsId = uuid("settings");
    db.insert(sqliteSchema.organizationSettings)
      .values({
        id: ids.settingsId,
        organizationId: ids.orgId,
        productName: "Exam Platform",
        productSubtitle: "Assessment & Certification",
        footerText: "Demo Instance",
        organizationDisplayName: "Demo Organization",
        timezone: "Asia/Shanghai",
        createdAt: ts(),
        updatedAt: ts(),
      })
      .run();
  } else {
    ids.settingsId = existingSettings.id;
  }

  // ── CandidateFields ───────────────────────────────────────────
  const fieldDefs = [
    {
      name: "employeeId",
      label: "工号",
      fieldType: "text" as const,
      required: true,
      unique: true,
      sortOrder: 0,
    },
    {
      name: "department",
      label: "部门",
      fieldType: "select" as const,
      required: true,
      unique: false,
      sortOrder: 1,
    },
    {
      name: "phone",
      label: "手机号",
      fieldType: "text" as const,
      required: false,
      unique: false,
      sortOrder: 2,
    },
  ];

  for (const fd of fieldDefs) {
    const existing = db
      .select()
      .from(sqliteSchema.candidateFields)
      .where(
        and(
          eq(sqliteSchema.candidateFields.organizationId, ids.orgId),
          eq(sqliteSchema.candidateFields.name, fd.name),
        ),
      )
      .get();
    if (existing) {
      ids.candidateFields[fd.name] = existing.id;
    } else {
      const fieldId = uuid("cf");
      ids.candidateFields[fd.name] = fieldId;
      db.insert(sqliteSchema.candidateFields)
        .values({
          id: fieldId,
          organizationId: ids.orgId,
          ...fd,
          createdAt: ts(),
        })
        .run();
    }
  }

  // ── Users ─────────────────────────────────────────────────────
  const userDefs = [
    { username: "superadmin", name: "超级管理员", role: "SuperAdmin" as const },
    { username: "admin", name: "管理员", role: "Admin" as const },
    { username: "teacher1", name: "教师甲", role: "Teacher" as const },
    { username: "teacher2", name: "教师乙", role: "Teacher" as const },
    { username: "candidate1", name: "考生甲", role: "Candidate" as const },
    { username: "candidate2", name: "考生乙", role: "Candidate" as const },
    { username: "candidate3", name: "考生丙", role: "Candidate" as const },
    { username: "candidate4", name: "考生丁", role: "Candidate" as const },
  ];

  for (const ud of userDefs) {
    const existing = db
      .select()
      .from(sqliteSchema.users)
      .where(
        and(
          eq(sqliteSchema.users.organizationId, ids.orgId),
          eq(sqliteSchema.users.username, ud.username),
        ),
      )
      .get();

    if (existing) {
      ids.users[ud.username] = existing.id;
    } else {
      const userId = uuid("user");
      ids.users[ud.username] = userId;
      const passwordHash = await hashFn(
        ud.role === "Candidate" ? "candidate123" : "admin123",
      );
      if (ud.role === "Teacher") {
        const hash = await hashFn("teacher123");
        db.insert(sqliteSchema.users)
          .values({
            id: userId,
            organizationId: ids.orgId,
            username: ud.username,
            passwordHash: hash,
            name: ud.name,
            role: ud.role,
            isActive: true,
            createdAt: ts(),
            updatedAt: ts(),
          })
          .run();
      } else {
        db.insert(sqliteSchema.users)
          .values({
            id: userId,
            organizationId: ids.orgId,
            username: ud.username,
            passwordHash,
            name: ud.name,
            role: ud.role,
            isActive: true,
            createdAt: ts(),
            updatedAt: ts(),
          })
          .run();
      }
    }
  }

  // ── CandidateProfiles ─────────────────────────────────────────
  const candidateFieldValues: Record<string, Record<string, unknown>> = {
    candidate1: {
      employeeId: "EMP001",
      department: "tech",
      phone: "13800001111",
    },
    candidate2: {
      employeeId: "EMP002",
      department: "hr",
      phone: "13800002222",
    },
    candidate3: {
      employeeId: "EMP003",
      department: "finance",
      phone: "13800003333",
    },
    candidate4: {
      employeeId: "EMP004",
      department: "operation",
      phone: "13800004444",
    },
  };

  for (const [username, fields] of Object.entries(candidateFieldValues)) {
    const userId = ids.users[username];
    if (!userId) continue;
    const existing = db
      .select()
      .from(sqliteSchema.candidateProfiles)
      .where(
        and(
          eq(sqliteSchema.candidateProfiles.organizationId, ids.orgId),
          eq(sqliteSchema.candidateProfiles.userId, userId),
        ),
      )
      .get();
    if (!existing) {
      db.insert(sqliteSchema.candidateProfiles)
        .values({
          id: uuid("cp"),
          organizationId: ids.orgId,
          userId,
          fields,
          createdAt: ts(),
          updatedAt: ts(),
        })
        .run();
    }
  }

  // Get candidate profile IDs (needed for enrollments)
  const candidateProfileIds: Record<string, string> = {};
  for (const username of [
    "candidate1",
    "candidate2",
    "candidate3",
    "candidate4",
  ]) {
    const userId = ids.users[username];
    if (!userId) continue;
    const profile = db
      .select()
      .from(sqliteSchema.candidateProfiles)
      .where(
        and(
          eq(sqliteSchema.candidateProfiles.organizationId, ids.orgId),
          eq(sqliteSchema.candidateProfiles.userId, userId),
        ),
      )
      .get();
    if (profile) {
      candidateProfileIds[username] = profile.id;
    }
  }

  // ── Courses ───────────────────────────────────────────────────
  const courseDefs = [
    {
      code: "SAFETY-101",
      name: "基础安全培训",
      description: "安全规范与操作培训课程",
    },
    {
      code: "SKILL-201",
      name: "技能认证考核",
      description: "专业技能等级认证考核",
    },
    {
      code: "EMPTY-001",
      name: "空课程测试",
      description: "用于测试空状态显示",
    },
  ];

  for (const cd of courseDefs) {
    const existing = db
      .select()
      .from(sqliteSchema.courses)
      .where(
        and(
          eq(sqliteSchema.courses.organizationId, ids.orgId),
          eq(sqliteSchema.courses.code, cd.code),
        ),
      )
      .get();
    if (existing) {
      ids.courses[cd.code] = existing.id;
    } else {
      const courseId = uuid("course");
      ids.courses[cd.code] = courseId;
      db.insert(sqliteSchema.courses)
        .values({
          id: courseId,
          organizationId: ids.orgId,
          name: cd.name,
          code: cd.code,
          description: cd.description,
          createdAt: ts(),
          updatedAt: ts(),
        })
        .run();
    }
  }

  // ── Questions ─────────────────────────────────────────────────
  const safetyCourseId = ids.courses["SAFETY-101"]!;
  const skillCourseId = ids.courses["SKILL-201"]!;

  const questionDefs = [
    // SAFETY-101 questions (6)
    {
      tag: "safety-sc1",
      courseId: safetyCourseId,
      type: "single_choice" as const,
      content: "灭火器的正确使用步骤是？",
      options: [
        { id: "A", content: "拔销、瞄准、压把、扫射", isCorrect: true },
        { id: "B", content: "直接压把喷射", isCorrect: false },
        { id: "C", content: "摇晃后喷射", isCorrect: false },
        { id: "D", content: "倒置后喷射", isCorrect: false },
      ],
      standardAnswer: "A",
      score: 5,
      difficulty: 2,
      tags: ["safety", "equipment"],
      gradingRule: makeGradingRule(),
    },
    {
      tag: "safety-mc1",
      courseId: safetyCourseId,
      type: "multiple_choice" as const,
      content: "以下哪些属于个人防护装备？",
      options: [
        { id: "A", content: "安全帽", isCorrect: true },
        { id: "B", content: "防护手套", isCorrect: true },
        { id: "C", content: "防护眼镜", isCorrect: true },
        { id: "D", content: "手机", isCorrect: false },
      ],
      standardAnswer: ["A", "B", "C"],
      score: 8,
      difficulty: 3,
      tags: ["safety", "ppe"],
      gradingRule: makeGradingRule({ multiSelectScoring: "partial_half" }),
    },
    {
      tag: "safety-tf1",
      courseId: safetyCourseId,
      type: "true_false" as const,
      content: "发生火灾时应乘坐电梯逃生",
      options: [
        { id: "T", content: "正确", isCorrect: false },
        { id: "F", content: "错误", isCorrect: true },
      ],
      standardAnswer: false,
      score: 3,
      difficulty: 1,
      tags: ["safety", "emergency"],
      gradingRule: makeGradingRule(),
    },
    {
      tag: "safety-fb1",
      courseId: safetyCourseId,
      type: "fill_blank" as const,
      content: "安全出口标识的颜色是___色",
      options: [],
      standardAnswer: "绿|green",
      score: 5,
      difficulty: 1,
      tags: ["safety", "signs"],
      gradingRule: makeGradingRule({ fillBlankMatchMode: "keyword" }),
    },
    {
      tag: "safety-sc2",
      courseId: safetyCourseId,
      type: "single_choice" as const,
      content: "发现火灾应首先拨打哪个电话？",
      options: [
        { id: "A", content: "119", isCorrect: true },
        { id: "B", content: "120", isCorrect: false },
        { id: "C", content: "110", isCorrect: false },
        { id: "D", content: "122", isCorrect: false },
      ],
      standardAnswer: "A",
      score: 5,
      difficulty: 1,
      tags: ["safety", "emergency"],
      gradingRule: makeGradingRule(),
    },
    {
      tag: "safety-fb2",
      courseId: safetyCourseId,
      type: "fill_blank" as const,
      content: "消防通道的宽度不得低于___米",
      options: [],
      standardAnswer: "1.2",
      score: 5,
      difficulty: 3,
      tags: ["safety", "regulation"],
      gradingRule: makeGradingRule({ fillBlankMatchMode: "exact" }),
    },
    // SKILL-201 questions (4)
    {
      tag: "skill-sc1",
      courseId: skillCourseId,
      type: "single_choice" as const,
      content: "以下哪种是正确的操作流程？",
      options: [
        { id: "A", content: "直接操作、记录、报告", isCorrect: false },
        { id: "B", content: "检查、操作、记录、报告", isCorrect: true },
        { id: "C", content: "操作、检查、报告", isCorrect: false },
        { id: "D", content: "报告、操作、记录", isCorrect: false },
      ],
      standardAnswer: "B",
      score: 5,
      difficulty: 3,
      tags: ["skill", "procedure"],
      gradingRule: makeGradingRule(),
    },
    {
      tag: "skill-mc1",
      courseId: skillCourseId,
      type: "multiple_choice" as const,
      content: "质量检查包括哪些环节？",
      options: [
        { id: "A", content: "来料检验", isCorrect: true },
        { id: "B", content: "过程检验", isCorrect: true },
        { id: "C", content: "随意抽查", isCorrect: false },
        { id: "D", content: "出厂检验", isCorrect: true },
      ],
      standardAnswer: ["A", "B", "D"],
      score: 10,
      difficulty: 4,
      tags: ["skill", "quality"],
      gradingRule: makeGradingRule({ multiSelectScoring: "partial_half" }),
    },
    {
      tag: "skill-tf1",
      courseId: skillCourseId,
      type: "true_false" as const,
      content: "操作前必须进行设备校验",
      options: [
        { id: "T", content: "正确", isCorrect: true },
        { id: "F", content: "错误", isCorrect: false },
      ],
      standardAnswer: true,
      score: 5,
      difficulty: 2,
      tags: ["skill", "equipment"],
      gradingRule: makeGradingRule(),
    },
    {
      tag: "skill-fb1",
      courseId: skillCourseId,
      type: "fill_blank" as const,
      content: "标准操作规程的缩写是___",
      options: [],
      standardAnswer: "SOP|sop",
      score: 5,
      difficulty: 2,
      tags: ["skill", "terminology"],
      gradingRule: makeGradingRule({ fillBlankMatchMode: "exact" }),
    },
  ];

  for (const qd of questionDefs) {
    const existing = db
      .select()
      .from(sqliteSchema.questions)
      .where(
        and(
          eq(sqliteSchema.questions.organizationId, ids.orgId),
          eq(sqliteSchema.questions.content, qd.content),
        ),
      )
      .get();
    if (existing) {
      ids.questions[qd.tag] = existing.id;
    } else {
      const qId = uuid("q");
      ids.questions[qd.tag] = qId;
      db.insert(sqliteSchema.questions)
        .values({
          id: qId,
          organizationId: ids.orgId,
          courseId: qd.courseId,
          type: qd.type,
          content: qd.content,
          options: qd.options,
          standardAnswer: qd.standardAnswer,
          attachments: [],
          score: qd.score,
          difficulty: qd.difficulty,
          tags: qd.tags,
          gradingRule: qd.gradingRule,
          createdAt: ts(),
          updatedAt: ts(),
        })
        .run();
    }
  }

  // ── Build Question Snapshots ──────────────────────────────────
  function qid(tag: string): string {
    const id = ids.questions[tag];
    if (!id) throw new Error(`Question tag '${tag}' not resolved`);
    return id;
  }

  function buildSnapshot(questionTags: string[]): QuestionSnapshot[] {
    const snapshots: QuestionSnapshot[] = [];
    for (let i = 0; i < questionTags.length; i++) {
      const tag = questionTags[i]!;
      const q = db
        .select()
        .from(sqliteSchema.questions)
        .where(eq(sqliteSchema.questions.id, qid(tag)))
        .get();
      if (!q) continue;
      snapshots.push({
        originalQuestionId: q.id,
        type: q.type as QuestionSnapshot["type"],
        content: q.content,
        attachments: (q.attachments as QuestionSnapshot["attachments"]) ?? [],
        options: (
          (q.options as Array<{ id: string; content: string }>) ?? []
        ).map((o) => ({ id: o.id, content: o.content })),
        standardAnswer: q.standardAnswer,
        score: q.score,
        gradingRule: q.gradingRule as GradingRule,
        order: i,
      });
    }
    return snapshots;
  }

  function snapshotTotalScore(snapshots: QuestionSnapshot[]): number {
    return snapshots.reduce((sum, s) => sum + s.score, 0);
  }

  // ── Helper: upsert exam ───────────────────────────────────────
  type ExamInsert = {
    description: string;
    courseId: string;
    status: ExamStatus;
    timingMode: TimingMode;
    durationMinutes: number;
    openAt: Date;
    closeAt: Date;
    passingScore: number;
    totalScore: number;
    questionSelectionMode: QuestionSelectionMode;
    questionIds: string[];
    questionSnapshot: QuestionSnapshot[];
    controlFlags: ControlFlags;
    retakePolicy: RetakePolicy;
    scoreStrategy: ScoreStrategy;
    maxAttempts: number;
    createdAt: Date;
    updatedAt: Date;
  };

  function upsertExam(title: string, data: ExamInsert): string {
    const existing = db
      .select()
      .from(sqliteSchema.exams)
      .where(
        and(
          eq(sqliteSchema.exams.organizationId, ids.orgId),
          eq(sqliteSchema.exams.title, title),
        ),
      )
      .get();
    if (existing) {
      db.update(sqliteSchema.exams)
        .set({ ...data, createdAt: existing.createdAt, updatedAt: ts() })
        .where(eq(sqliteSchema.exams.id, existing.id))
        .run();
      return existing.id;
    }
    const id = uuid("exam");
    db.insert(sqliteSchema.exams)
      .values({
        id,
        organizationId: ids.orgId,
        title,
        ...data,
      })
      .run();
    return id;
  }

  // ── Exams ─────────────────────────────────────────────────────
  const HOUR = 3600_000;
  const DAY = 86400_000;

  // Exam 1: 安全培训考核 A (open)
  const exam1Questions = [
    "safety-sc1",
    "safety-mc1",
    "safety-tf1",
    "safety-fb1",
    "safety-sc2",
    "safety-fb2",
  ];
  const exam1Snapshot = buildSnapshot(exam1Questions);
  const exam1TotalScore = snapshotTotalScore(exam1Snapshot);
  const exam1Id = upsertExam("安全培训考核 A", {
    description: "安全培训综合考核",
    courseId: safetyCourseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 30,
    openAt: ts(-1 * HOUR),
    closeAt: ts(24 * HOUR),
    passingScore: 20,
    totalScore: exam1TotalScore,
    questionSelectionMode: "manual",
    questionIds: exam1Questions.map((t) => qid(t)),
    questionSnapshot: exam1Snapshot,
    controlFlags: makeDefaultControlFlags(),
    retakePolicy: "max_attempts",
    scoreStrategy: "highest",
    maxAttempts: 2,
    createdAt: ts(-2 * DAY),
    updatedAt: ts(),
  });
  ids.exams["open"] = exam1Id;

  // Exam 2: 安全培训草稿考试 (draft)
  const exam2Questions = ["safety-sc1", "safety-tf1", "safety-sc2"];
  const exam2Snapshot: QuestionSnapshot[] = [];
  const exam2QIds = exam2Questions.map((t) => qid(t));
  const exam2TotalScore = exam2Questions.reduce((sum, tag) => {
    const q = db
      .select()
      .from(sqliteSchema.questions)
      .where(eq(sqliteSchema.questions.id, qid(tag)))
      .get();
    return sum + (q?.score ?? 0);
  }, 0);
  const exam2Id = upsertExam("安全培训草稿考试", {
    description: "草稿状态测试",
    courseId: safetyCourseId,
    status: "draft",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: ts(7 * DAY),
    closeAt: ts(8 * DAY),
    passingScore: 10,
    totalScore: exam2TotalScore,
    questionSelectionMode: "manual",
    questionIds: exam2QIds,
    questionSnapshot: [],
    controlFlags: makeDefaultControlFlags(),
    retakePolicy: "unlimited",
    scoreStrategy: "latest",
    maxAttempts: 99,
    createdAt: ts(-1 * DAY),
    updatedAt: ts(),
  });
  ids.exams["draft"] = exam2Id;

  // Exam 3: 安全培训已发布未开始 (published, future)
  const exam3Questions = ["safety-sc1", "safety-mc1", "safety-fb1"];
  const exam3Snapshot = buildSnapshot(exam3Questions);
  const exam3TotalScore = snapshotTotalScore(exam3Snapshot);
  const exam3Id = upsertExam("安全培训已发布未开始", {
    description: "已发布但考试尚未开始",
    courseId: safetyCourseId,
    status: "published",
    timingMode: "timed_window",
    durationMinutes: 45,
    openAt: ts(1 * HOUR),
    closeAt: ts(3 * HOUR),
    passingScore: 12,
    totalScore: exam3TotalScore,
    questionSelectionMode: "manual",
    questionIds: exam3Questions.map((t) => qid(t)),
    questionSnapshot: exam3Snapshot,
    controlFlags: makeDefaultControlFlags(),
    retakePolicy: "max_attempts",
    scoreStrategy: "highest",
    maxAttempts: 2,
    createdAt: ts(-3 * DAY),
    updatedAt: ts(),
  });
  ids.exams["published"] = exam3Id;

  // Exam 4: 技能认证历史考试 (closed)
  const exam4Questions = ["skill-sc1", "skill-mc1", "skill-tf1", "skill-fb1"];
  const exam4Snapshot = buildSnapshot(exam4Questions);
  const exam4TotalScore = snapshotTotalScore(exam4Snapshot);
  const exam4Id = upsertExam("技能认证历史考试", {
    description: "已结束的技能认证考试",
    courseId: skillCourseId,
    status: "closed",
    timingMode: "timed_window",
    durationMinutes: 90,
    openAt: ts(-7 * DAY),
    closeAt: ts(-1 * DAY),
    passingScore: 15,
    totalScore: exam4TotalScore,
    questionSelectionMode: "manual",
    questionIds: exam4Questions.map((t) => qid(t)),
    questionSnapshot: exam4Snapshot,
    controlFlags: makeDefaultControlFlags(),
    retakePolicy: "pass_then_stop",
    scoreStrategy: "highest",
    maxAttempts: 3,
    createdAt: ts(-10 * DAY),
    updatedAt: ts(-1 * DAY),
  });
  ids.exams["closed"] = exam4Id;

  // Exam 5: 严格模式考试 (open, strict control flags)
  const exam5Questions = ["skill-sc1", "skill-tf1", "skill-fb1"];
  const exam5Snapshot = buildSnapshot(exam5Questions);
  const exam5TotalScore = snapshotTotalScore(exam5Snapshot);
  const exam5Id = upsertExam("严格模式考试", {
    description: "启用全部控制选项的考试",
    courseId: skillCourseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 20,
    openAt: ts(-30 * 60_000),
    closeAt: ts(2 * HOUR),
    passingScore: 10,
    totalScore: exam5TotalScore,
    questionSelectionMode: "manual",
    questionIds: exam5Questions.map((t) => qid(t)),
    questionSnapshot: exam5Snapshot,
    controlFlags: makeStrictControlFlags(),
    retakePolicy: "max_attempts",
    scoreStrategy: "latest",
    maxAttempts: 1,
    createdAt: ts(-1 * DAY),
    updatedAt: ts(),
  });
  ids.exams["strict"] = exam5Id;

  // ── Enrollments ───────────────────────────────────────────────
  function upsertEnrollment(
    examId: string,
    candidateProfileId: string,
    data: {
      status: EnrollmentStatus;
      attemptCount: number;
      finalScore?: number;
      finalPassed?: boolean;
      finalAttemptId?: string;
    },
  ): string {
    const existing = db
      .select()
      .from(sqliteSchema.examEnrollments)
      .where(
        and(
          eq(sqliteSchema.examEnrollments.organizationId, ids.orgId),
          eq(sqliteSchema.examEnrollments.examId, examId),
          eq(sqliteSchema.examEnrollments.candidateId, candidateProfileId),
        ),
      )
      .get();
    if (existing) {
      db.update(sqliteSchema.examEnrollments)
        .set({ ...data, updatedAt: ts() })
        .where(eq(sqliteSchema.examEnrollments.id, existing.id))
        .run();
      return existing.id;
    }
    const id = uuid("enroll");
    db.insert(sqliteSchema.examEnrollments)
      .values({
        id,
        organizationId: ids.orgId,
        examId,
        candidateId: candidateProfileId,
        ...data,
        createdAt: ts(),
        updatedAt: ts(),
      })
      .run();
    return id;
  }

  const c1 = candidateProfileIds["candidate1"] ?? "";
  const c2 = candidateProfileIds["candidate2"] ?? "";
  const c3 = candidateProfileIds["candidate3"] ?? "";
  const c4 = candidateProfileIds["candidate4"] ?? "";

  // Open exam enrollments
  const enrollOpen1 = upsertEnrollment(exam1Id, c1, {
    status: "started",
    attemptCount: 1,
  });
  ids.enrollments["open-c1"] = enrollOpen1;

  const enrollOpen2 = upsertEnrollment(exam1Id, c2, {
    status: "assigned",
    attemptCount: 0,
  });
  ids.enrollments["open-c2"] = enrollOpen2;

  const enrollOpen3 = upsertEnrollment(exam1Id, c3, {
    status: "started",
    attemptCount: 1,
  });
  ids.enrollments["open-c3"] = enrollOpen3;

  const enrollOpen4 = upsertEnrollment(exam1Id, c4, {
    status: "completed",
    attemptCount: 1,
  });
  ids.enrollments["open-c4"] = enrollOpen4;

  // Pre-compute grading results for closed exam (needed for enrollment finalScore)
  const closedC1Attempt1Answers: AnswerRecord[] = exam4Snapshot.map((q, i) => ({
    questionId: q.originalQuestionId,
    answer:
      q.type === "single_choice"
        ? "B"
        : q.type === "multiple_choice"
          ? ["A", "B", "D"]
          : q.type === "true_false"
            ? true
            : "SOP",
    version: 1,
    savedAt: ts(-6 * DAY + i * 60_000),
  }));
  const closedC1Grading1 = buildGradingResult(
    exam4Snapshot,
    closedC1Attempt1Answers,
    15,
  );

  const closedC1Attempt2Answers: AnswerRecord[] = exam4Snapshot.map((q, i) => ({
    questionId: q.originalQuestionId,
    answer:
      q.type === "single_choice"
        ? "A"
        : q.type === "multiple_choice"
          ? ["A", "B"]
          : q.type === "true_false"
            ? true
            : "sop",
    version: 1,
    savedAt: ts(-3 * DAY + i * 60_000),
  }));
  const closedC1Grading2 = buildGradingResult(
    exam4Snapshot,
    closedC1Attempt2Answers,
    15,
  );

  const closedC2Answers: AnswerRecord[] = exam4Snapshot.map((q, i) => ({
    questionId: q.originalQuestionId,
    answer:
      q.type === "single_choice"
        ? "C"
        : q.type === "multiple_choice"
          ? ["C"]
          : q.type === "true_false"
            ? false
            : "不知道",
    version: 1,
    savedAt: ts(-6 * DAY + i * 60_000),
  }));
  const closedC2Grading = buildGradingResult(
    exam4Snapshot,
    closedC2Answers,
    15,
  );

  const closedC3Answers: AnswerRecord[] = exam4Snapshot.map((q, i) => ({
    questionId: q.originalQuestionId,
    answer:
      q.type === "single_choice"
        ? "B"
        : q.type === "multiple_choice"
          ? ["A", "B"]
          : q.type === "true_false"
            ? true
            : "xxx",
    version: 1,
    savedAt: ts(-6 * DAY + i * 60_000),
  }));
  const closedC3Grading = buildGradingResult(
    exam4Snapshot,
    closedC3Answers,
    15,
  );

  const closedC4Answers: AnswerRecord[] = exam4Snapshot.map((q, i) => ({
    questionId: q.originalQuestionId,
    answer: q.standardAnswer,
    version: 1,
    savedAt: ts(-6 * DAY + i * 60_000),
  }));
  const closedC4Grading = buildGradingResult(
    exam4Snapshot,
    closedC4Answers,
    15,
  );

  // Compute finalScore for closed exam enrollments (highest strategy)
  const closedC1Highest = Math.max(
    closedC1Grading1.totalScore,
    closedC1Grading2.totalScore,
  );

  // Closed exam enrollments (use actual graded scores)
  const enrollClosed1 = upsertEnrollment(exam4Id, c1, {
    status: "completed",
    attemptCount: 2,
    finalScore: closedC1Highest,
    finalPassed: closedC1Highest >= 15,
  });
  ids.enrollments["closed-c1"] = enrollClosed1;

  const enrollClosed2 = upsertEnrollment(exam4Id, c2, {
    status: "completed",
    attemptCount: 1,
    finalScore: closedC2Grading.totalScore,
    finalPassed: closedC2Grading.passed,
  });
  ids.enrollments["closed-c2"] = enrollClosed2;

  const enrollClosed3 = upsertEnrollment(exam4Id, c3, {
    status: "completed",
    attemptCount: 1,
    finalScore: closedC3Grading.totalScore,
    finalPassed: closedC3Grading.passed,
  });
  ids.enrollments["closed-c3"] = enrollClosed3;

  const enrollClosed4 = upsertEnrollment(exam4Id, c4, {
    status: "completed",
    attemptCount: 1,
    finalScore: closedC4Grading.totalScore,
    finalPassed: closedC4Grading.passed,
  });
  ids.enrollments["closed-c4"] = enrollClosed4;

  // Strict exam enrollment
  const enrollStrict1 = upsertEnrollment(exam5Id, c1, {
    status: "assigned",
    attemptCount: 0,
  });
  ids.enrollments["strict-c1"] = enrollStrict1;

  // ── Attempts ──────────────────────────────────────────────────
  function upsertAttempt(
    enrollmentId: string,
    candidateProfileId: string,
    examId: string,
    attemptNo: number,
    data: {
      status: AttemptStatus;
      questionSnapshot: QuestionSnapshot[];
      answers: AnswerRecord[];
      gradingResult?: QuestionScoreResult[];
      score?: number;
      passed?: boolean;
      startedAt?: Date;
      deadlineAt?: Date;
      submittedAt?: Date;
      gradedAt?: Date;
      lastActivityAt?: Date;
    },
  ): string {
    const existing = db
      .select()
      .from(sqliteSchema.examAttempts)
      .where(
        and(
          eq(sqliteSchema.examAttempts.organizationId, ids.orgId),
          eq(sqliteSchema.examAttempts.enrollmentId, enrollmentId),
          eq(sqliteSchema.examAttempts.attemptNo, attemptNo),
        ),
      )
      .get();
    if (existing) {
      db.update(sqliteSchema.examAttempts)
        .set({ ...data, updatedAt: ts() })
        .where(eq(sqliteSchema.examAttempts.id, existing.id))
        .run();
      return existing.id;
    }
    const id = uuid("attempt");
    db.insert(sqliteSchema.examAttempts)
      .values({
        id,
        organizationId: ids.orgId,
        examId,
        enrollmentId,
        candidateId: candidateProfileId,
        attemptNo,
        ...data,
        createdAt: ts(),
        updatedAt: ts(),
      })
      .run();
    return id;
  }

  // Helper: build grading result for a set of questions + answers
  function buildGradingResult(
    snapshot: QuestionSnapshot[],
    answers: AnswerRecord[],
    passingScore: number,
  ): {
    gradingResult: QuestionScoreResult[];
    totalScore: number;
    passed: boolean;
  } {
    const result = gradeAnswers(
      "seed-attempt",
      snapshot,
      answers,
      passingScore,
      ts(),
    );
    return {
      gradingResult: result.questionResults,
      totalScore: result.totalScore,
      passed: result.passed,
    };
  }

  // --- Open exam: candidate1 in_progress ---
  const openAttempt1Id = upsertAttempt(enrollOpen1, c1, exam1Id, 1, {
    status: "in_progress",
    questionSnapshot: exam1Snapshot,
    answers: [
      {
        questionId: exam1Snapshot[0]!.originalQuestionId,
        answer: "A",
        version: 1,
        savedAt: ts(-5 * 60_000),
      },
      {
        questionId: exam1Snapshot[1]!.originalQuestionId,
        answer: ["A", "B"],
        version: 1,
        savedAt: ts(-4 * 60_000),
      },
    ],
    startedAt: ts(-10 * 60_000),
    deadlineAt: ts(20 * 60_000),
    lastActivityAt: ts(-1 * 60_000),
  });
  ids.attempts["open-c1-inprogress"] = openAttempt1Id;

  // --- Open exam: candidate3 disrupted ---
  const openAttempt3Id = upsertAttempt(enrollOpen3, c3, exam1Id, 1, {
    status: "disrupted",
    questionSnapshot: exam1Snapshot,
    answers: [
      {
        questionId: exam1Snapshot[0]!.originalQuestionId,
        answer: "B",
        version: 1,
        savedAt: ts(-15 * 60_000),
      },
    ],
    startedAt: ts(-20 * 60_000),
    deadlineAt: ts(10 * 60_000),
    lastActivityAt: ts(-8 * 60_000),
  });
  ids.attempts["open-c3-disrupted"] = openAttempt3Id;

  // --- Open exam: candidate4 graded ---
  const openC4Answers: AnswerRecord[] = exam1Snapshot.map((q, i) => ({
    questionId: q.originalQuestionId,
    answer:
      q.type === "single_choice"
        ? "A"
        : q.type === "multiple_choice"
          ? ["A", "B", "C"]
          : q.type === "true_false"
            ? false
            : "绿",
    version: 1,
    savedAt: ts(-25 * 60_000 + i * 60_000),
  }));
  const openC4Grading = buildGradingResult(exam1Snapshot, openC4Answers, 20);
  const openAttempt4Id = upsertAttempt(enrollOpen4, c4, exam1Id, 1, {
    status: "graded",
    questionSnapshot: exam1Snapshot,
    answers: openC4Answers,
    gradingResult: openC4Grading.gradingResult,
    score: openC4Grading.totalScore,
    passed: openC4Grading.passed,
    startedAt: ts(-30 * 60_000),
    deadlineAt: ts(0),
    submittedAt: ts(-5 * 60_000),
    gradedAt: ts(-4 * 60_000),
    lastActivityAt: ts(-5 * 60_000),
  });
  ids.attempts["open-c4-graded"] = openAttempt4Id;

  // --- Closed exam: candidate1 attempt 1 (graded, high score) ---
  const closedAttempt1Id = upsertAttempt(enrollClosed1, c1, exam4Id, 1, {
    status: "graded",
    questionSnapshot: exam4Snapshot,
    answers: closedC1Attempt1Answers,
    gradingResult: closedC1Grading1.gradingResult,
    score: closedC1Grading1.totalScore,
    passed: closedC1Grading1.passed,
    startedAt: ts(-7 * DAY),
    deadlineAt: ts(-7 * DAY + 90 * 60_000),
    submittedAt: ts(-7 * DAY + 80 * 60_000),
    gradedAt: ts(-7 * DAY + 81 * 60_000),
    lastActivityAt: ts(-7 * DAY + 80 * 60_000),
  });
  ids.attempts["closed-c1-attempt1"] = closedAttempt1Id;

  // --- Closed exam: candidate1 attempt 2 (graded, lower score) ---
  const closedAttempt2Id = upsertAttempt(enrollClosed1, c1, exam4Id, 2, {
    status: "graded",
    questionSnapshot: exam4Snapshot,
    answers: closedC1Attempt2Answers,
    gradingResult: closedC1Grading2.gradingResult,
    score: closedC1Grading2.totalScore,
    passed: closedC1Grading2.passed,
    startedAt: ts(-4 * DAY),
    deadlineAt: ts(-4 * DAY + 90 * 60_000),
    submittedAt: ts(-4 * DAY + 85 * 60_000),
    gradedAt: ts(-4 * DAY + 86 * 60_000),
    lastActivityAt: ts(-4 * DAY + 85 * 60_000),
  });
  ids.attempts["closed-c1-attempt2"] = closedAttempt2Id;

  // --- Closed exam: candidate2 (graded, failed) ---
  const closedAttemptC2Id = upsertAttempt(enrollClosed2, c2, exam4Id, 1, {
    status: "graded",
    questionSnapshot: exam4Snapshot,
    answers: closedC2Answers,
    gradingResult: closedC2Grading.gradingResult,
    score: closedC2Grading.totalScore,
    passed: closedC2Grading.passed,
    startedAt: ts(-7 * DAY + 2 * HOUR),
    deadlineAt: ts(-7 * DAY + 2 * HOUR + 90 * 60_000),
    submittedAt: ts(-7 * DAY + 2 * HOUR + 45 * 60_000),
    gradedAt: ts(-7 * DAY + 2 * HOUR + 46 * 60_000),
    lastActivityAt: ts(-7 * DAY + 2 * HOUR + 45 * 60_000),
  });
  ids.attempts["closed-c2-graded"] = closedAttemptC2Id;

  // --- Closed exam: candidate3 (graded, borderline) ---
  const closedAttemptC3Id = upsertAttempt(enrollClosed3, c3, exam4Id, 1, {
    status: "graded",
    questionSnapshot: exam4Snapshot,
    answers: closedC3Answers,
    gradingResult: closedC3Grading.gradingResult,
    score: closedC3Grading.totalScore,
    passed: closedC3Grading.passed,
    startedAt: ts(-5 * DAY),
    deadlineAt: ts(-5 * DAY + 90 * 60_000),
    submittedAt: ts(-5 * DAY + 70 * 60_000),
    gradedAt: ts(-5 * DAY + 71 * 60_000),
    lastActivityAt: ts(-5 * DAY + 70 * 60_000),
  });
  ids.attempts["closed-c3-graded"] = closedAttemptC3Id;

  // --- Closed exam: candidate4 (graded, full score) ---
  const closedAttemptC4Id = upsertAttempt(enrollClosed4, c4, exam4Id, 1, {
    status: "graded",
    questionSnapshot: exam4Snapshot,
    answers: closedC4Answers,
    gradingResult: closedC4Grading.gradingResult,
    score: closedC4Grading.totalScore,
    passed: closedC4Grading.passed,
    startedAt: ts(-7 * DAY + 4 * HOUR),
    deadlineAt: ts(-7 * DAY + 4 * HOUR + 90 * 60_000),
    submittedAt: ts(-7 * DAY + 4 * HOUR + 60 * 60_000),
    gradedAt: ts(-7 * DAY + 4 * HOUR + 61 * 60_000),
    lastActivityAt: ts(-7 * DAY + 4 * HOUR + 60 * 60_000),
  });
  ids.attempts["closed-c4-graded"] = closedAttemptC4Id;

  return ids;
}
