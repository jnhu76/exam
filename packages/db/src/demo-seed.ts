import { randomUUID } from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import type { Database } from "./types.js";
import { schema } from "./schema/pg.js";
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

const DEMO_ORG_SLUG = "default";

function ts(offsetMs = 0): Date {
  return new Date(Date.now() + offsetMs);
}

function uuid(_tag: string): string {
  return randomUUID();
}

export interface DemoIds {
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

function makeGradingRule(overrides: Partial<GradingRule> = {}): GradingRule {
  return {
    multiSelectScoring: "all_correct_full",
    fillBlankMatchMode: "exact",
    fillBlankCaseSensitive: false,
    ...overrides,
  };
}

export async function seedDemo(
  db: Database,
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
  const existingOrgRows = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, DEMO_ORG_SLUG));
  const existingOrg = existingOrgRows[0];

  if (existingOrg) {
    ids.orgId = existingOrg.id;
  } else {
    ids.orgId = uuid("org");
    await db.insert(schema.organizations).values({
      id: ids.orgId,
      name: "Default Organization",
      displayName: "考试中心",
      slug: DEMO_ORG_SLUG,
      createdAt: ts(),
      updatedAt: ts(),
    });
  }

  // ── OrganizationSettings ──────────────────────────────────────
  const settingsId = uuid("settings");
  await db
    .insert(schema.organizationSettings)
    .values({
      id: settingsId,
      organizationId: ids.orgId,
      productName: "考试平台",
      productSubtitle: "可靠的内网考试系统",
      footerText: "© 当前部署",
      organizationDisplayName: "考试中心",
      timezone: "Asia/Shanghai",
      createdAt: ts(),
      updatedAt: ts(),
    })
    .onConflictDoUpdate({
      target: schema.organizationSettings.organizationId,
      set: {
        productName: "考试平台",
        productSubtitle: "可靠的内网考试系统",
        footerText: "© 当前部署",
        organizationDisplayName: "考试中心",
        timezone: "Asia/Shanghai",
        updatedAt: ts(),
      },
    });
  ids.settingsId = settingsId;

  // ── CandidateFields ───────────────────────────────────────────
  const fieldDefs = [
    {
      name: "candidateNo",
      label: "编号",
      fieldType: "text" as const,
      required: true,
      unique: true,
      sortOrder: 0,
    },
    {
      name: "department",
      label: "部门",
      fieldType: "text" as const,
      required: false,
      unique: false,
      sortOrder: 1,
    },
  ];

  for (const fd of fieldDefs) {
    const existing = await db
      .select()
      .from(schema.candidateFields)
      .where(
        and(
          eq(schema.candidateFields.organizationId, ids.orgId),
          eq(schema.candidateFields.name, fd.name),
        ),
      );
    if (existing.length > 0) {
      ids.candidateFields[fd.name] = existing[0]!.id;
    } else {
      const fieldId = uuid("cf");
      ids.candidateFields[fd.name] = fieldId;
      await db.insert(schema.candidateFields).values({
        id: fieldId,
        organizationId: ids.orgId,
        ...fd,
        createdAt: ts(),
      });
    }
  }

  // ── Users ─────────────────────────────────────────────────────
  await db
    .update(schema.users)
    .set({ isActive: false, updatedAt: ts() })
    .where(
      and(
        eq(schema.users.organizationId, ids.orgId),
        inArray(schema.users.username, ["superadmin", "teacher1", "teacher2"]),
      ),
    );

  const userDefs = [
    { username: "admin", name: "管理员", role: "Admin" as const },
    { username: "candidate1", name: "考生甲", role: "Candidate" as const },
    { username: "candidate2", name: "考生乙", role: "Candidate" as const },
    { username: "candidate3", name: "考生丙", role: "Candidate" as const },
    { username: "candidate4", name: "考生丁", role: "Candidate" as const },
  ];

  for (const ud of userDefs) {
    const existing = await db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.organizationId, ids.orgId),
          eq(schema.users.username, ud.username),
        ),
      );

    if (existing.length > 0) {
      ids.users[ud.username] = existing[0]!.id;
    } else {
      const userId = uuid("user");
      ids.users[ud.username] = userId;
      const passwordHash = await hashFn(
        ud.role === "Candidate" ? "candidate123" : "admin123",
      );
      await db.insert(schema.users).values({
        id: userId,
        organizationId: ids.orgId,
        username: ud.username,
        passwordHash,
        name: ud.name,
        role: ud.role,
        isActive: true,
        createdAt: ts(),
        updatedAt: ts(),
      });
    }
  }

  // ── CandidateProfiles ─────────────────────────────────────────
  const candidateFieldValues: Record<string, Record<string, unknown>> = {
    candidate1: {
      candidateNo: "CAND001",
      department: "研发部",
    },
    candidate2: {
      candidateNo: "CAND002",
      department: "运营部",
    },
    candidate3: {
      candidateNo: "CAND003",
      department: "培训部",
    },
    candidate4: {
      candidateNo: "CAND004",
      department: "服务部",
    },
  };

  for (const [username, fields] of Object.entries(candidateFieldValues)) {
    const userId = ids.users[username];
    if (!userId) continue;
    const existing = await db
      .select()
      .from(schema.candidateProfiles)
      .where(
        and(
          eq(schema.candidateProfiles.organizationId, ids.orgId),
          eq(schema.candidateProfiles.userId, userId),
        ),
      );
    if (existing.length === 0) {
      await db.insert(schema.candidateProfiles).values({
        id: uuid("cp"),
        organizationId: ids.orgId,
        userId,
        fields,
        createdAt: ts(),
        updatedAt: ts(),
      });
    }
  }

  const candidateProfileIds: Record<string, string> = {};
  for (const username of [
    "candidate1",
    "candidate2",
    "candidate3",
    "candidate4",
  ]) {
    const userId = ids.users[username];
    if (!userId) continue;
    const profile = await db
      .select()
      .from(schema.candidateProfiles)
      .where(
        and(
          eq(schema.candidateProfiles.organizationId, ids.orgId),
          eq(schema.candidateProfiles.userId, userId),
        ),
      );
    if (profile.length > 0) {
      candidateProfileIds[username] = profile[0]!.id;
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
    const existing = await db
      .select()
      .from(schema.courses)
      .where(
        and(
          eq(schema.courses.organizationId, ids.orgId),
          eq(schema.courses.code, cd.code),
        ),
      );
    if (existing.length > 0) {
      ids.courses[cd.code] = existing[0]!.id;
    } else {
      const courseId = uuid("course");
      ids.courses[cd.code] = courseId;
      await db.insert(schema.courses).values({
        id: courseId,
        organizationId: ids.orgId,
        name: cd.name,
        code: cd.code,
        description: cd.description,
        createdAt: ts(),
        updatedAt: ts(),
      });
    }
  }

  // ── Questions ─────────────────────────────────────────────────
  const safetyCourseId = ids.courses["SAFETY-101"]!;
  const skillCourseId = ids.courses["SKILL-201"]!;

  const questionDefs = [
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
      content: "安全出口标识的颜色是____色",
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
      content: "消防通道的宽度不得低于____米",
      options: [],
      standardAnswer: "1.2",
      score: 5,
      difficulty: 3,
      tags: ["safety", "regulation"],
      gradingRule: makeGradingRule({ fillBlankMatchMode: "exact" }),
    },
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
      content: "标准操作规程的缩写是____",
      options: [],
      standardAnswer: "SOP|sop",
      score: 5,
      difficulty: 2,
      tags: ["skill", "terminology"],
      gradingRule: makeGradingRule({ fillBlankMatchMode: "exact" }),
    },
  ];

  for (const qd of questionDefs) {
    const existing = await db
      .select()
      .from(schema.questions)
      .where(
        and(
          eq(schema.questions.organizationId, ids.orgId),
          eq(schema.questions.content, qd.content),
        ),
      );
    if (existing.length > 0) {
      ids.questions[qd.tag] = existing[0]!.id;
    } else {
      const qId = uuid("q");
      ids.questions[qd.tag] = qId;
      await db.insert(schema.questions).values({
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
      });
    }
  }

  // ── Build Question Snapshots ──────────────────────────────────
  function qid(tag: string): string {
    const id = ids.questions[tag];
    if (!id) throw new Error(`Question tag '${tag}' not resolved`);
    return id;
  }

  async function buildSnapshot(
    questionTags: string[],
  ): Promise<QuestionSnapshot[]> {
    const snapshots: QuestionSnapshot[] = [];
    for (let i = 0; i < questionTags.length; i++) {
      const tag = questionTags[i]!;
      const rows = await db
        .select()
        .from(schema.questions)
        .where(eq(schema.questions.id, qid(tag)));
      const q = rows[0];
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

  async function upsertExam(title: string, data: ExamInsert): Promise<string> {
    const existing = await db
      .select()
      .from(schema.exams)
      .where(
        and(
          eq(schema.exams.organizationId, ids.orgId),
          eq(schema.exams.title, title),
        ),
      );
    if (existing.length > 0) {
      await db
        .update(schema.exams)
        .set({ ...data, createdAt: existing[0]!.createdAt, updatedAt: ts() })
        .where(eq(schema.exams.id, existing[0]!.id));
      return existing[0]!.id;
    }
    const id = uuid("exam");
    await db.insert(schema.exams).values({
      id,
      organizationId: ids.orgId,
      title,
      ...data,
    });
    return id;
  }

  // ── Exams ─────────────────────────────────────────────────────
  const HOUR = 3600_000;
  const DAY = 86400_000;

  const exam1Questions = [
    "safety-sc1",
    "safety-mc1",
    "safety-tf1",
    "safety-fb1",
    "safety-sc2",
    "safety-fb2",
  ];
  const exam1Snapshot = await buildSnapshot(exam1Questions);
  const exam1TotalScore = snapshotTotalScore(exam1Snapshot);
  const exam1Id = await upsertExam("安全培训考核 A", {
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

  const exam2Questions = ["safety-sc1", "safety-tf1", "safety-sc2"];
  const exam2QIds = exam2Questions.map((t) => qid(t));
  const exam2Snapshot: QuestionSnapshot[] = await buildSnapshot(exam2Questions);
  const exam2TotalScore = snapshotTotalScore(exam2Snapshot);
  const exam2Id = await upsertExam("安全培训草稿考试", {
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

  const exam3Questions = ["safety-sc1", "safety-mc1", "safety-fb1"];
  const exam3Snapshot = await buildSnapshot(exam3Questions);
  const exam3TotalScore = snapshotTotalScore(exam3Snapshot);
  const exam3Id = await upsertExam("安全培训已发布未开始", {
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

  const exam4Questions = ["skill-sc1", "skill-mc1", "skill-tf1", "skill-fb1"];
  const exam4Snapshot = await buildSnapshot(exam4Questions);
  const exam4TotalScore = snapshotTotalScore(exam4Snapshot);
  const exam4Id = await upsertExam("技能认证历史考试", {
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

  // ── Enrollments ───────────────────────────────────────────────
  async function upsertEnrollment(
    examId: string,
    candidateProfileId: string,
    data: {
      status: EnrollmentStatus;
      attemptCount: number;
      finalScore?: number;
      finalPassed?: boolean;
      finalAttemptId?: string;
    },
  ): Promise<string> {
    const existing = await db
      .select()
      .from(schema.examEnrollments)
      .where(
        and(
          eq(schema.examEnrollments.organizationId, ids.orgId),
          eq(schema.examEnrollments.examId, examId),
          eq(schema.examEnrollments.candidateId, candidateProfileId),
        ),
      );
    if (existing.length > 0) {
      await db
        .update(schema.examEnrollments)
        .set({ ...data, updatedAt: ts() })
        .where(eq(schema.examEnrollments.id, existing[0]!.id));
      return existing[0]!.id;
    }
    const id = uuid("enroll");
    await db.insert(schema.examEnrollments).values({
      id,
      organizationId: ids.orgId,
      examId,
      candidateId: candidateProfileId,
      ...data,
      createdAt: ts(),
      updatedAt: ts(),
    });
    return id;
  }

  const c1 = candidateProfileIds["candidate1"] ?? "";
  const c2 = candidateProfileIds["candidate2"] ?? "";
  const c3 = candidateProfileIds["candidate3"] ?? "";
  const c4 = candidateProfileIds["candidate4"] ?? "";

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

  const closedC1Highest = Math.max(
    closedC1Grading1.totalScore,
    closedC1Grading2.totalScore,
  );

  const enrollOpen1 = await upsertEnrollment(exam1Id, c1, {
    status: "started",
    attemptCount: 1,
  });
  ids.enrollments["open-c1"] = enrollOpen1;

  const enrollOpen2 = await upsertEnrollment(exam1Id, c2, {
    status: "assigned",
    attemptCount: 0,
  });
  ids.enrollments["open-c2"] = enrollOpen2;

  const enrollOpen3 = await upsertEnrollment(exam1Id, c3, {
    status: "started",
    attemptCount: 1,
  });
  ids.enrollments["open-c3"] = enrollOpen3;

  const enrollOpen4 = await upsertEnrollment(exam1Id, c4, {
    status: "completed",
    attemptCount: 1,
  });
  ids.enrollments["open-c4"] = enrollOpen4;

  const enrollClosed1 = await upsertEnrollment(exam4Id, c1, {
    status: "completed",
    attemptCount: 2,
    finalScore: closedC1Highest,
    finalPassed: closedC1Highest >= 15,
  });
  ids.enrollments["closed-c1"] = enrollClosed1;

  const enrollClosed2 = await upsertEnrollment(exam4Id, c2, {
    status: "completed",
    attemptCount: 1,
    finalScore: closedC2Grading.totalScore,
    finalPassed: closedC2Grading.passed,
  });
  ids.enrollments["closed-c2"] = enrollClosed2;

  const enrollClosed3 = await upsertEnrollment(exam4Id, c3, {
    status: "completed",
    attemptCount: 1,
    finalScore: closedC3Grading.totalScore,
    finalPassed: closedC3Grading.passed,
  });
  ids.enrollments["closed-c3"] = enrollClosed3;

  const enrollClosed4 = await upsertEnrollment(exam4Id, c4, {
    status: "completed",
    attemptCount: 1,
    finalScore: closedC4Grading.totalScore,
    finalPassed: closedC4Grading.passed,
  });
  ids.enrollments["closed-c4"] = enrollClosed4;

  // ── Attempts ──────────────────────────────────────────────────
  async function upsertAttempt(
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
  ): Promise<string> {
    const existing = await db
      .select()
      .from(schema.examAttempts)
      .where(
        and(
          eq(schema.examAttempts.organizationId, ids.orgId),
          eq(schema.examAttempts.enrollmentId, enrollmentId),
          eq(schema.examAttempts.attemptNo, attemptNo),
        ),
      );
    if (existing.length > 0) {
      await db
        .update(schema.examAttempts)
        .set({ ...data, updatedAt: ts() })
        .where(eq(schema.examAttempts.id, existing[0]!.id));
      return existing[0]!.id;
    }
    const id = uuid("attempt");
    await db.insert(schema.examAttempts).values({
      id,
      organizationId: ids.orgId,
      examId,
      enrollmentId,
      candidateId: candidateProfileId,
      attemptNo,
      ...data,
      createdAt: ts(),
      updatedAt: ts(),
    });
    return id;
  }

  const openAttempt1Id = await upsertAttempt(enrollOpen1, c1, exam1Id, 1, {
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

  const openAttempt3Id = await upsertAttempt(enrollOpen3, c3, exam1Id, 1, {
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
  const openAttempt4Id = await upsertAttempt(enrollOpen4, c4, exam1Id, 1, {
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

  const closedAttempt1Id = await upsertAttempt(enrollClosed1, c1, exam4Id, 1, {
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

  const closedAttempt2Id = await upsertAttempt(enrollClosed1, c1, exam4Id, 2, {
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

  const closedAttemptC2Id = await upsertAttempt(enrollClosed2, c2, exam4Id, 1, {
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

  const closedAttemptC3Id = await upsertAttempt(enrollClosed3, c3, exam4Id, 1, {
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

  const closedAttemptC4Id = await upsertAttempt(enrollClosed4, c4, exam4Id, 1, {
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
