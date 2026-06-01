import type {
  AnswerRecord,
  Attachment,
  ControlFlags,
  GradingRule,
  QuestionScoreResult,
  QuestionSnapshot,
} from "@exam/domain";
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const organizationId = () => text("organization_id").notNull();
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull();
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" }).notNull();

export const organizations = sqliteTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    slug: text("slug").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("organizations_slug_unique").on(table.slug)],
);

export const organizationSettings = sqliteTable(
  "organization_settings",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    productName: text("product_name"),
    productSubtitle: text("product_subtitle"),
    footerText: text("footer_text"),
    organizationDisplayName: text("organization_display_name"),
    timezone: text("timezone"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("organization_settings_org_unique").on(table.organizationId),
  ],
);

export const candidateFields = sqliteTable(
  "candidate_fields",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    name: text("name").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type", {
      enum: ["text", "number", "select"],
    }).notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
    unique: integer("unique", { mode: "boolean" }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("candidate_fields_org_name_unique").on(
      table.organizationId,
      table.name,
    ),
  ],
);

export const users = sqliteTable(
  "users",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: text("role", {
      enum: ["SuperAdmin", "Admin", "Teacher", "Proctor", "Candidate"],
    }).notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("users_org_username_unique").on(
      table.organizationId,
      table.username,
    ),
  ],
);

export const candidateProfiles = sqliteTable(
  "candidate_profiles",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    fields: text("fields", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("candidate_profiles_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const courses = sqliteTable(
  "courses",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("courses_org_code_unique").on(table.organizationId, table.code),
  ],
);

export const questions = sqliteTable("questions", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id),
  type: text("type", {
    enum: ["single_choice", "multiple_choice", "fill_blank", "true_false"],
  }).notNull(),
  content: text("content").notNull(),
  options: text("options", { mode: "json" })
    .$type<Array<{ id: string; content: string; isCorrect?: boolean }>>()
    .notNull(),
  standardAnswer: text("standard_answer", { mode: "json" })
    .$type<unknown>()
    .notNull(),
  attachments: text("attachments", { mode: "json" })
    .$type<Attachment[]>()
    .notNull(),
  score: real("score").notNull(),
  difficulty: integer("difficulty").notNull(),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  gradingRule: text("grading_rule", { mode: "json" })
    .$type<GradingRule>()
    .notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const exams = sqliteTable("exams", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id),
  status: text("status", {
    enum: ["draft", "published", "open", "closed", "archived"],
  }).notNull(),
  timingMode: text("timing_mode", {
    enum: ["timed_sync", "timed_window", "deadline", "untimed"],
  }).notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  openAt: integer("open_at", { mode: "timestamp_ms" }).notNull(),
  closeAt: integer("close_at", { mode: "timestamp_ms" }).notNull(),
  passingScore: real("passing_score").notNull(),
  totalScore: real("total_score").notNull(),
  questionSelectionMode: text("question_selection_mode", {
    enum: ["manual", "random"],
  }).notNull(),
  questionIds: text("question_ids", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  questionSnapshot: text("question_snapshot", { mode: "json" })
    .$type<QuestionSnapshot[]>()
    .notNull(),
  controlFlags: text("control_flags", { mode: "json" })
    .$type<ControlFlags>()
    .notNull(),
  retakePolicy: text("retake_policy", {
    enum: [
      "unlimited",
      "max_attempts",
      "daily_limit",
      "weekly_limit",
      "pass_then_stop",
    ],
  }).notNull(),
  scoreStrategy: text("score_strategy", {
    enum: ["highest", "latest", "first"],
  }).notNull(),
  maxAttempts: integer("max_attempts").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const examEnrollments = sqliteTable(
  "exam_enrollments",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidateProfiles.id),
    status: text("status", {
      enum: ["assigned", "started", "completed", "blocked"],
    }).notNull(),
    attemptCount: integer("attempt_count").notNull(),
    finalScore: real("final_score"),
    finalPassed: integer("final_passed", { mode: "boolean" }),
    finalAttemptId: text("final_attempt_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("exam_enrollments_org_exam_candidate_unique").on(
      table.organizationId,
      table.examId,
      table.candidateId,
    ),
  ],
);

export const examAttempts = sqliteTable(
  "exam_attempts",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    enrollmentId: text("enrollment_id")
      .notNull()
      .references(() => examEnrollments.id),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidateProfiles.id),
    attemptNo: integer("attempt_no").notNull(),
    status: text("status", {
      enum: [
        "not_started",
        "queued",
        "in_progress",
        "disrupted",
        "submitted",
        "grading",
        "graded",
        "voided",
      ],
    }).notNull(),
    questionSnapshot: text("question_snapshot", { mode: "json" })
      .$type<QuestionSnapshot[]>()
      .notNull(),
    answers: text("answers", { mode: "json" })
      .$type<AnswerRecord[]>()
      .notNull(),
    gradingResult: text("grading_result", { mode: "json" }).$type<
      QuestionScoreResult[]
    >(),
    totalScore: real("total_score"),
    passed: integer("passed", { mode: "boolean" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    deadlineAt: integer("deadline_at", { mode: "timestamp_ms" }),
    submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
    gradedAt: integer("graded_at", { mode: "timestamp_ms" }),
    lastActivityAt: integer("last_activity_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("exam_attempts_org_enrollment_attempt_unique").on(
      table.organizationId,
      table.enrollmentId,
      table.attemptNo,
    ),
  ],
);

export const auditLogs = sqliteTable("audit_logs", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadata: text("metadata", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

export const sqliteSchema = {
  organizations,
  organizationSettings,
  candidateFields,
  users,
  candidateProfiles,
  courses,
  questions,
  exams,
  examEnrollments,
  examAttempts,
  auditLogs,
};
