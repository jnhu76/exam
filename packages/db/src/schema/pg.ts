import type {
  AnswerRecord,
  Attachment,
  ControlFlags,
  GradingRule,
  GradingStatus,
  MisconductFlag,
  QuestionScoreResult,
  QuestionSnapshot,
} from "@exam/domain";
import {
  boolean,
  check,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Creates a primary key column. */
const id = () => text("id").primaryKey();
/** Creates a non-null organization_id column referencing the organizations table. */
const organizationId = () => text("organization_id").notNull();
/** Creates a non-null `created_at` timestamp with timezone. */
const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull();
/** Creates a non-null `updated_at` timestamp with timezone. */
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull();

/** Organizations table — stores tenant organizations. */
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

/** Organization settings table — stores per-organization branding and configuration. */
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

/** Candidate fields table — defines configurable identity fields for candidates. */
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

/** Users table — stores user accounts (Admin, Candidate roles). */
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

/** Candidate profiles table — stores candidate-specific field values per user. */
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

/** Courses table — stores course definitions grouped by code. */
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

/** Questions table — stores question bank items with options, scoring, and grading rules. */
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

/** Exams table — stores exam configurations including timing, scoring, and question snapshots. */
export const exams = pgTable(
  "exams",
  {
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
    openAt: timestamp("open_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
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
    // ADR-005 Slice 3: candidate runtime timing policy. null = disabled.
    latestStartOffsetMinutes: integer("latest_start_offset_minutes"),
    minSubmitAfterStartMinutes: integer("min_submit_after_start_minutes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "exams_latest_start_offset_minutes_check",
      sql`${table.latestStartOffsetMinutes} >= 0`,
    ),
    check(
      "exams_min_submit_after_start_minutes_check",
      sql`${table.minSubmitAfterStartMinutes} >= 0`,
    ),
  ],
);

/** Exam enrollments table — tracks candidate qualification, attempt counts, and final scores per exam. */
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

/** Exam attempts table — stores individual attempt data including answers, snapshots, and grading results. */
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
    misconduct: jsonb("misconduct").$type<MisconductFlag | null>(),
    gradingStatus: text("grading_status").$type<GradingStatus>(),
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

/**
 * Manual grading entries — one grader's score + comment for one subjective
 * question within one attempt (P2D-J2). Uniqueness of (attemptId, questionId)
 * prevents duplicate entries for the same question in the same attempt.
 */
export const manualGradingEntries = pgTable(
  "manual_grading_entries",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => examAttempts.id),
    questionId: text("question_id").notNull(),
    score: doublePrecision("score").notNull(),
    maxScore: doublePrecision("max_score").notNull(),
    comment: text("comment").notNull().default(""),
    gradedBy: text("graded_by").notNull(),
    gradedAt: timestamp("graded_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("manual_grading_entries_attempt_question_unique").on(
      table.attemptId,
      table.questionId,
    ),
  ],
);

/** Audit logs table — records user actions for compliance and debugging. */
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

/** Aggregated schema object exporting all tables for Drizzle configuration. */
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
  manualGradingEntries,
  auditLogs,
};
