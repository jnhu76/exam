import type {
  AnswerRecord,
  Attachment,
  ControlFlags,
  GradingRule,
  QuestionScoreResult,
  QuestionSnapshot,
} from "@exam/domain";
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey();
const organizationId = () => text("organization_id").notNull();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull();

export const organizations = pgTable(
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

export const organizationSettings = pgTable(
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

export const candidateFields = pgTable(
  "candidate_fields",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    name: text("name").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    required: boolean("required").notNull(),
    unique: boolean("unique").notNull(),
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

export const users = pgTable(
  "users",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    isActive: boolean("is_active").notNull(),
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

export const candidateProfiles = pgTable(
  "candidate_profiles",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    fields: jsonb("fields").$type<Record<string, unknown>>().notNull(),
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

export const courses = pgTable(
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

export const questions = pgTable("questions", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id),
  type: text("type").notNull(),
  content: text("content").notNull(),
  options: jsonb("options")
    .$type<Array<{ id: string; content: string; isCorrect?: boolean }>>()
    .notNull(),
  standardAnswer: jsonb("standard_answer").$type<unknown>().notNull(),
  attachments: jsonb("attachments").$type<Attachment[]>().notNull(),
  score: doublePrecision("score").notNull(),
  difficulty: integer("difficulty").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull(),
  gradingRule: jsonb("grading_rule").$type<GradingRule>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const exams = pgTable("exams", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id),
  status: text("status").notNull(),
  timingMode: text("timing_mode").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  openAt: timestamp("open_at", { withTimezone: true, mode: "date" }).notNull(),
  closeAt: timestamp("close_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  passingScore: doublePrecision("passing_score").notNull(),
  totalScore: doublePrecision("total_score").notNull(),
  questionSelectionMode: text("question_selection_mode").notNull(),
  questionIds: jsonb("question_ids").$type<string[]>().notNull(),
  questionSnapshot: jsonb("question_snapshot")
    .$type<QuestionSnapshot[]>()
    .notNull(),
  controlFlags: jsonb("control_flags").$type<ControlFlags>().notNull(),
  retakePolicy: text("retake_policy").notNull(),
  scoreStrategy: text("score_strategy").notNull(),
  maxAttempts: integer("max_attempts").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const examEnrollments = pgTable(
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
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    finalScore: doublePrecision("final_score"),
    finalPassed: boolean("final_passed"),
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

export const examAttempts = pgTable(
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
    status: text("status").notNull(),
    questionSnapshot: jsonb("question_snapshot")
      .$type<QuestionSnapshot[]>()
      .notNull(),
    answers: jsonb("answers").$type<AnswerRecord[]>().notNull(),
    gradingResult: jsonb("grading_result").$type<QuestionScoreResult[]>(),
    score: doublePrecision("total_score"),
    passed: boolean("passed"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true, mode: "date" }),
    submittedAt: timestamp("submitted_at", {
      withTimezone: true,
      mode: "date",
    }),
    gradedAt: timestamp("graded_at", { withTimezone: true, mode: "date" }),
    lastActivityAt: timestamp("last_activity_at", {
      withTimezone: true,
      mode: "date",
    }),
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

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

export const schema = {
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
