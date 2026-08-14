import type {
  AnswerRecord,
  Attachment,
  AttemptGradingEntry,
  BackupExecutorType,
  BackupRunEventType,
  BackupRunStatus,
  BackupType,
  BackupVerificationStatus,
  ControlFlags,
  EmailOutboxStatus,
  EmailType,
  GradingEntryMode,
  GradingEntryStatus,
  GradingRule,
  GradingStatus,
  MisconductFlag,
  NotificationType,
  QuestionScoreResult,
  QuestionSnapshot,
  RestoreDrillResult,
  RestoreDrillSource,
  RetentionRunResult,
  ResultPublicationMode,
  SubmittedAnswersSnapshot,
  AttemptInterruptionEvent,
  AttemptTimeAdjustment,
  InterruptionTimePolicy,
  ExamProfileRetakePolicy,
  ScoreStrategy,
} from "@exam/domain";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
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
    /**
     * Optional notification recipient email (P5-N1 §13).
     *
     * NOT used for login. NOT unique. NOT verified. The first V1 consumer is
     * the `result_published` Inbox + Email outbox integration. The contract
     * layer normalizes (trim-only, case-preserved) and maps blank input to null.
     */
    email: text("email"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("users_org_username_unique").on(
      table.organizationId,
      table.username,
    ),
    // Composite-FK target for org-owned actor references (e.g.
    // attempt_command_receipts(organization_id, actor_id)): proves the actor
    // is a MEMBER of the same organization, not merely an existing user.
    // users.organization_id is NOT NULL, so a cross-org actor cannot satisfy
    // the composite FK.
    uniqueIndex("users_org_id_unique").on(table.organizationId, table.id),
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
export const questions = pgTable(
  "questions",
  {
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
    // Nullable: a null/undefined standardAnswer marks the question as
    // subjective (manually graded). Objective questions keep a typed answer.
    // See QuestionSnapshot / hasSubjectiveQuestions for the convention.
    standardAnswer: jsonb("standard_answer").$type<unknown>(),
    // P3-L0-1: rubric authoring/editing source (dual-layer). text_response
    // requires non-empty at publish (P3-L0-5); objective questions are null.
    // Copied into QuestionSnapshot.rubric at attempt creation. Nullable so
    // the migration adds the column without backfilling historical rows.
    // Drizzle columns are nullable by default (no .notNull()); matches the
    // convention used by `standardAnswer` above.
    rubric: text("rubric"),
    attachments: jsonb("attachments").$type<Attachment[]>().notNull(),
    score: doublePrecision("score").notNull(),
    difficulty: integer("difficulty").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull(),
    gradingRule: jsonb("grading_rule").$type<GradingRule>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("questions_org_course_idx").on(table.organizationId, table.courseId),
  ],
);

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
    // P2D-J5a: result publishing policy. Authoritative visibility field;
    // legacy controlFlags.showResultImmediately remains as a deprecated input.
    resultPublicationMode: text("result_publication_mode")
      .$type<ResultPublicationMode>()
      .notNull()
      .default("immediate"),
    // P2D-J5a: server time authority instant of the first publish-results call.
    // Null until manual publish; idempotent re-publish does not update it.
    resultsPublishedAt: timestamp("results_published_at", {
      withTimezone: true,
      mode: "date",
    }),
    interruptionTimePolicy: text("interruption_time_policy")
      .$type<InterruptionTimePolicy>()
      .notNull()
      .default("strict"),
    interruptionGracePerIncidentSeconds: integer(
      "interruption_grace_per_incident_seconds",
    ),
    interruptionGracePerAttemptSeconds: integer(
      "interruption_grace_per_attempt_seconds",
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Composite-FK target for child tables (exam_incidents, and J4-I1's
    // exam_proctor_assignments): PostgreSQL requires a unique on the
    // referenced (organization_id, id) pair. Additive index; no column edits.
    uniqueIndex("exams_org_id_unique").on(table.organizationId, table.id),
    check(
      "exams_latest_start_offset_minutes_check",
      sql`${table.latestStartOffsetMinutes} >= 0`,
    ),
    check(
      "exams_min_submit_after_start_minutes_check",
      sql`${table.minSubmitAfterStartMinutes} >= 0`,
    ),
    check("exams_passing_score_min_check", sql`${table.passingScore} >= 0`),
    check("exams_total_score_positive_check", sql`${table.totalScore} > 0`),
    check(
      "exams_passing_score_max_check",
      sql`${table.passingScore} <= ${table.totalScore}`,
    ),
    check(
      "exams_interruption_time_policy_check",
      sql`${table.interruptionTimePolicy} IN ('strict', 'bounded_grace', 'operator_incident')`,
    ),
    check(
      "exams_interruption_policy_caps_check",
      sql`
        (
          ${table.interruptionTimePolicy} IN ('strict', 'operator_incident')
          AND ${table.interruptionGracePerIncidentSeconds} IS NULL
          AND ${table.interruptionGracePerAttemptSeconds} IS NULL
        )
        OR
        (
          ${table.interruptionTimePolicy} = 'bounded_grace'
          AND ${table.interruptionGracePerIncidentSeconds} IS NOT NULL
          AND ${table.interruptionGracePerAttemptSeconds} IS NOT NULL
          AND ${table.interruptionGracePerIncidentSeconds} > 0
          AND ${table.interruptionGracePerAttemptSeconds} > 0
          AND ${table.interruptionGracePerIncidentSeconds} <= ${table.interruptionGracePerAttemptSeconds}
        )
      `,
    ),
  ],
);

/**
 * Exam policy profiles — P7-M2 organization-owned authoring templates.
 *
 * A profile is an EDITABLE AUTHORING CONVENIENCE, NOT execution authority
 * (P7-M2 design: copy-on-apply). Applying a profile to an exam copies its
 * typed values into the ordinary `exams` columns; the published Exam row is
 * the immutable execution authority and is never resolved through a profile
 * again. Typed columns instead of a `policy_defaults jsonb` blob so the
 * small known set is SQL-visible, migration-readable, and auditable.
 *
 * Excluded from profiles (by design): courseId, openAt/closeAt,
 * passingScore/totalScore, questionIds/snapshot, lifecycle status,
 * title/description, timingMode + questionSelectionMode (fixed Phase-1
 * literals), and ALL control_flags (latent/unenforced — see P7-M1 §13).
 */
export const examPolicyProfiles = pgTable(
  "exam_policy_profiles",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    latestStartOffsetMinutes: integer("latest_start_offset_minutes"),
    minSubmitAfterStartMinutes: integer("min_submit_after_start_minutes"),
    retakePolicy: text("retake_policy")
      .$type<ExamProfileRetakePolicy>()
      .notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    scoreStrategy: text("score_strategy").$type<ScoreStrategy>().notNull(),
    resultPublicationMode: text("result_publication_mode")
      .$type<ResultPublicationMode>()
      .notNull(),
    interruptionTimePolicy: text("interruption_time_policy")
      .$type<InterruptionTimePolicy>()
      .notNull()
      .default("strict"),
    interruptionGracePerIncidentSeconds: integer(
      "interruption_grace_per_incident_seconds",
    ),
    interruptionGracePerAttemptSeconds: integer(
      "interruption_grace_per_attempt_seconds",
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("exam_policy_profiles_org_name_unique").on(
      table.organizationId,
      table.name,
    ),
    check(
      "exam_policy_profiles_duration_minutes_positive_check",
      sql`${table.durationMinutes} > 0`,
    ),
    check(
      "exam_policy_profiles_latest_start_offset_minutes_check",
      sql`${table.latestStartOffsetMinutes} >= 0`,
    ),
    check(
      "exam_policy_profiles_min_submit_after_start_minutes_check",
      sql`${table.minSubmitAfterStartMinutes} >= 0`,
    ),
    check(
      "exam_policy_profiles_retake_policy_check",
      sql`${table.retakePolicy} IN ('unlimited', 'max_attempts', 'pass_then_stop')`,
    ),
    check(
      "exam_policy_profiles_score_strategy_check",
      sql`${table.scoreStrategy} IN ('highest', 'latest', 'first')`,
    ),
    check(
      "exam_policy_profiles_interruption_time_policy_check",
      sql`${table.interruptionTimePolicy} IN ('strict', 'bounded_grace', 'operator_incident')`,
    ),
    check(
      "exam_policy_profiles_interruption_policy_caps_check",
      sql`
        (
          ${table.interruptionTimePolicy} IN ('strict', 'operator_incident')
          AND ${table.interruptionGracePerIncidentSeconds} IS NULL
          AND ${table.interruptionGracePerAttemptSeconds} IS NULL
        )
        OR
        (
          ${table.interruptionTimePolicy} = 'bounded_grace'
          AND ${table.interruptionGracePerIncidentSeconds} IS NOT NULL
          AND ${table.interruptionGracePerAttemptSeconds} IS NOT NULL
          AND ${table.interruptionGracePerIncidentSeconds} > 0
          AND ${table.interruptionGracePerAttemptSeconds} > 0
          AND ${table.interruptionGracePerIncidentSeconds} <= ${table.interruptionGracePerAttemptSeconds}
        )
      `,
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
    gradingStatus: text("grading_status")
      .$type<GradingStatus>()
      .default("auto_graded"),
    // P3-L0-1: frozen answer snapshot written once in the submit transaction
    // (L0 §4.1). Null for attempts that predate the column or were never
    // submitted. Read exclusively by grading/result paths; never by the
    // candidate take endpoint draft-answer branch.
    submittedAnswers: jsonb(
      "submitted_answers",
    ).$type<SubmittedAnswersSnapshot | null>(),
    // P3-L0-1: why the attempt was submitted ('manual' | 'deadline').
    // Null for legacy rows (treated as unknown). New submit paths must
    // populate this; backfill of historical rows is out of scope (P3-L0-4).
    submissionReason: text("submission_reason"),
    interruptionPolicySnapshotVersion: integer(
      "interruption_policy_snapshot_version",
    )
      .notNull()
      .default(1),
    interruptionTimePolicySnapshot: text("interruption_time_policy_snapshot")
      .$type<InterruptionTimePolicy>()
      .notNull()
      .default("strict"),
    interruptionGracePerIncidentSecondsSnapshot: integer(
      "interruption_grace_per_incident_seconds_snapshot",
    ),
    interruptionGracePerAttemptSecondsSnapshot: integer(
      "interruption_grace_per_attempt_seconds_snapshot",
    ),
    currentInterruptionId: uuid("current_interruption_id"),
    interruptedAt: timestamp("interrupted_at", {
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
    uniqueIndex("exam_attempts_org_id_unique").on(
      table.organizationId,
      table.id,
    ),
    check(
      "exam_attempts_interruption_snapshot_version_check",
      sql`${table.interruptionPolicySnapshotVersion} = 1`,
    ),
    check(
      "exam_attempts_interruption_snapshot_policy_check",
      sql`${table.interruptionTimePolicySnapshot} IN ('strict', 'bounded_grace', 'operator_incident')`,
    ),
    check(
      "exam_attempts_interruption_snapshot_caps_check",
      sql`
        (
          ${table.interruptionTimePolicySnapshot} IN ('strict', 'operator_incident')
          AND ${table.interruptionGracePerIncidentSecondsSnapshot} IS NULL
          AND ${table.interruptionGracePerAttemptSecondsSnapshot} IS NULL
        )
        OR
        (
          ${table.interruptionTimePolicySnapshot} = 'bounded_grace'
          AND ${table.interruptionGracePerIncidentSecondsSnapshot} IS NOT NULL
          AND ${table.interruptionGracePerAttemptSecondsSnapshot} IS NOT NULL
          AND ${table.interruptionGracePerIncidentSecondsSnapshot} > 0
          AND ${table.interruptionGracePerAttemptSecondsSnapshot} > 0
          AND ${table.interruptionGracePerIncidentSecondsSnapshot} <= ${table.interruptionGracePerAttemptSecondsSnapshot}
        )
      `,
    ),
    check(
      "exam_attempts_current_interruption_pair_check",
      sql`
        (${table.currentInterruptionId} IS NULL AND ${table.interruptedAt} IS NULL)
        OR
        (${table.currentInterruptionId} IS NOT NULL AND ${table.interruptedAt} IS NOT NULL)
      `,
    ),
    check(
      "exam_attempts_status_pointer_check",
      sql`
        (${table.status} = 'disrupted' AND ${table.currentInterruptionId} IS NOT NULL AND ${table.interruptedAt} IS NOT NULL)
        OR
        (${table.status} != 'disrupted' AND ${table.currentInterruptionId} IS NULL AND ${table.interruptedAt} IS NULL)
      `,
    ),
    // Org+exam status distribution for the Recovery Exam aggregate
    // (contract §6.5 `GROUP BY status`). Covers the org+exam predicate and
    // the grouped status column.
    index("exam_attempts_org_exam_status_idx").on(
      table.organizationId,
      table.examId,
      table.status,
    ),
  ],
);

/** Stable parent identity for one interruption episode on an attempt. */
export const attemptInterruptions = pgTable(
  "attempt_interruptions",
  {
    id: uuid("id").primaryKey(),
    organizationId: organizationId().references(() => organizations.id),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => examAttempts.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("attempt_interruptions_org_attempt_id_unique").on(
      table.organizationId,
      table.attemptId,
      table.id,
    ),
    foreignKey({
      columns: [table.organizationId, table.attemptId],
      foreignColumns: [examAttempts.organizationId, examAttempts.id],
      name: "attempt_interruptions_org_attempt_fk",
    }),
  ],
);

/** Append-only ledger of positive deadline adjustments. */
export const attemptTimeAdjustments = pgTable(
  "attempt_time_adjustments",
  {
    id: id(),
    operationId: uuid("operation_id").notNull(),
    organizationId: organizationId().references(() => organizations.id),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => examAttempts.id),
    interruptionId: uuid("interruption_id"),
    incidentId: uuid("incident_id"),
    policy: text("policy").$type<InterruptionTimePolicy>().notNull(),
    source: text("source").$type<AttemptTimeAdjustment["source"]>().notNull(),
    beforeDeadline: timestamp("before_deadline", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    afterDeadline: timestamp("after_deadline", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    addedSeconds: integer("added_seconds").notNull(),
    eligibleSeconds: integer("eligible_seconds"),
    reasonCode: varchar("reason_code", { length: 100 }).notNull(),
    reasonText: text("reason_text"),
    actorId: text("actor_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("attempt_time_adjustments_org_operation_unique").on(
      table.organizationId,
      table.operationId,
    ),
    uniqueIndex("attempt_time_adjustments_bounded_interruption_unique")
      .on(table.interruptionId)
      .where(sql`${table.source} = 'bounded_grace'`),
    index("attempt_time_adjustments_org_attempt_created_idx").on(
      table.organizationId,
      table.attemptId,
      table.createdAt,
    ),
    check(
      "attempt_time_adjustments_policy_check",
      sql`${table.policy} IN ('strict', 'bounded_grace', 'operator_incident')`,
    ),
    check(
      "attempt_time_adjustments_source_check",
      sql`${table.source} IN ('bounded_grace', 'operator', 'system_incident', 'administrative_correction')`,
    ),
    check(
      "attempt_time_adjustments_added_seconds_check",
      sql`${table.addedSeconds} > 0`,
    ),
    check(
      "attempt_time_adjustments_deadline_order_check",
      sql`${table.afterDeadline} > ${table.beforeDeadline}`,
    ),
    check(
      "attempt_time_adjustments_deadline_delta_check",
      sql`${table.afterDeadline} = ${table.beforeDeadline} + (${table.addedSeconds} * interval '1 second')`,
    ),
    check(
      "attempt_time_adjustments_eligible_seconds_check",
      sql`${table.eligibleSeconds} IS NULL OR ${table.eligibleSeconds} >= 0`,
    ),
    check(
      "attempt_time_adjustments_reason_code_check",
      sql`length(btrim(${table.reasonCode})) > 0`,
    ),
    check(
      "attempt_time_adjustments_source_shape_check",
      sql`
        (
          ${table.source} = 'bounded_grace'
          AND ${table.policy} = 'bounded_grace'
          AND ${table.interruptionId} IS NOT NULL
          AND ${table.eligibleSeconds} IS NOT NULL
          AND ${table.actorId} IS NULL
        )
        OR
        (
          ${table.source} IN ('operator', 'administrative_correction')
          AND ${table.actorId} IS NOT NULL
          AND ${table.reasonText} IS NOT NULL
          AND length(btrim(${table.reasonText})) > 0
        )
        OR ${table.source} = 'system_incident'
      `,
    ),
    foreignKey({
      columns: [table.organizationId, table.attemptId],
      foreignColumns: [examAttempts.organizationId, examAttempts.id],
      name: "attempt_time_adjustments_org_attempt_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.attemptId, table.interruptionId],
      foreignColumns: [
        attemptInterruptions.organizationId,
        attemptInterruptions.attemptId,
        attemptInterruptions.id,
      ],
      name: "attempt_time_adjustments_org_interruption_fk",
    }),
  ],
);

/** Append-only evidence and outcome ledger for interruption episodes. */
export const attemptInterruptionEvents = pgTable(
  "attempt_interruption_events",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => examAttempts.id),
    interruptionId: uuid("interruption_id").notNull(),
    eventType: text("event_type")
      .$type<AttemptInterruptionEvent["eventType"]>()
      .notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    observedLastActivityAt: timestamp("observed_last_activity_at", {
      withTimezone: true,
      mode: "date",
    }),
    detectionSource:
      text("detection_source").$type<
        AttemptInterruptionEvent["detectionSource"]
      >(),
    timeoutSeconds: integer("timeout_seconds"),
    policy: text("policy").$type<InterruptionTimePolicy>().notNull(),
    eligibleSeconds: integer("eligible_seconds"),
    timeAdjustmentId: text("time_adjustment_id"),
    actorId: text("actor_id").references(() => users.id),
    reasonCode: varchar("reason_code", { length: 100 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("attempt_interruption_events_detected_unique")
      .on(table.interruptionId)
      .where(sql`${table.eventType} = 'detected'`),
    uniqueIndex("attempt_interruption_events_outcome_unique")
      .on(table.interruptionId)
      .where(sql`${table.eventType} IN ('restored', 'terminalized')`),
    index("attempt_interruption_events_org_attempt_created_idx").on(
      table.organizationId,
      table.attemptId,
      table.createdAt,
    ),
    check(
      "attempt_interruption_events_type_check",
      sql`${table.eventType} IN ('detected', 'restored', 'terminalized')`,
    ),
    check(
      "attempt_interruption_events_policy_check",
      sql`${table.policy} IN ('strict', 'bounded_grace', 'operator_incident')`,
    ),
    check(
      "attempt_interruption_events_reason_code_check",
      sql`length(btrim(${table.reasonCode})) > 0`,
    ),
    check(
      "attempt_interruption_events_eligible_seconds_check",
      sql`${table.eligibleSeconds} IS NULL OR ${table.eligibleSeconds} >= 0`,
    ),
    check(
      "attempt_interruption_events_shape_check",
      sql`
        (
          ${table.eventType} = 'detected'
          AND ${table.detectionSource} IS NOT NULL
          AND ${table.timeAdjustmentId} IS NULL
          AND (
            (
              ${table.detectionSource} = 'heartbeat_timeout'
              AND ${table.observedLastActivityAt} IS NOT NULL
              AND ${table.timeoutSeconds} IS NOT NULL
              AND ${table.timeoutSeconds} > 0
            )
            OR
            (
              ${table.detectionSource} = 'migration_backfill'
              AND ${table.timeoutSeconds} IS NULL
              AND ${table.reasonCode} = 'migration_backfill_unknown_detected_at'
            )
          )
        )
        OR
        (
          ${table.eventType} IN ('restored', 'terminalized')
          AND ${table.detectionSource} IS NULL
          AND ${table.timeoutSeconds} IS NULL
          AND ${table.observedLastActivityAt} IS NULL
        )
      `,
    ),
    foreignKey({
      columns: [table.organizationId, table.attemptId, table.interruptionId],
      foreignColumns: [
        attemptInterruptions.organizationId,
        attemptInterruptions.attemptId,
        attemptInterruptions.id,
      ],
      name: "attempt_interruption_events_org_interruption_fk",
    }),
    foreignKey({
      columns: [table.timeAdjustmentId],
      foreignColumns: [attemptTimeAdjustments.id],
      name: "attempt_interruption_events_adjustment_fk",
    }),
  ],
);

/**
 * Attempt grading entries — the materialized per-question grading workset
 * (P3-L0-2E). One durable row per frozen question per attempt, created at
 * submit-freeze time from `submitted_answers` + the frozen `QuestionSnapshot`.
 *
 * This is the single durable grading truth. The manual grading queue reads
 * `WHERE grading_mode = 'manual' AND status = 'pending_manual'`; manual
 * scoring flips `pending_manual → completed_manual`; terminal final
 * aggregation reads all completed entries. `attempt.gradingResult` is a
 * denormalized projection generated from these entries — never consumed as
 * scoring input.
 *
 * Uniqueness of `(attemptId, questionId)` prevents duplicate work items.
 * `questionId` joins `QuestionSnapshot.originalQuestionId`.
 */
export const attemptGradingEntries = pgTable(
  "attempt_grading_entries",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => examAttempts.id),
    questionId: text("question_id").notNull(),
    gradingMode: text("grading_mode").$type<GradingEntryMode>().notNull(),
    status: text("status").$type<GradingEntryStatus>().notNull(),
    maxScore: doublePrecision("max_score").notNull(),
    earnedScore: doublePrecision("earned_score"),
    candidateAnswer: jsonb("candidate_answer"),
    standardAnswer: jsonb("standard_answer"),
    correct: boolean("correct"),
    comment: text("comment").notNull().default(""),
    gradedBy: text("graded_by"),
    gradedAt: timestamp("graded_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("attempt_grading_entries_attempt_question_unique").on(
      table.attemptId,
      table.questionId,
    ),
    index("attempt_grading_entries_queue_index").on(
      table.organizationId,
      table.status,
    ),
    check(
      "attempt_grading_entries_mode_check",
      sql`${table.gradingMode} IN ('auto', 'manual')`,
    ),
    check(
      "attempt_grading_entries_status_check",
      sql`${table.status} IN ('completed_auto', 'pending_manual', 'completed_manual')`,
    ),
    check(
      "attempt_grading_entries_max_score_check",
      sql`${table.maxScore} >= 0`,
    ),
    check(
      "attempt_grading_entries_earned_score_check",
      sql`${table.earnedScore} >= 0`,
    ),
    check(
      "attempt_grading_entries_earned_score_limit_check",
      sql`${table.earnedScore} <= ${table.maxScore}`,
    ),
  ],
);

/**
 * Import job logs table — persists import operation summaries and diagnostics.
 *
 * `createdCount` / `updatedCount` / `errors` are import-result COUNTS (how
 * many rows were created/updated/errored in this import run), NOT timestamps.
 * The row creation time lives in `createdAt`.
 *
 * Append-only: rows are written once per import run and never updated.
 */
export const importJobLogs = pgTable(
  "import_job_logs",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    type: text("type").notNull(),
    status: text("status").notNull(),
    total: integer("total").notNull(),
    createdCount: integer("created_count").notNull(),
    updatedCount: integer("updated_count").notNull(),
    errors: integer("errors").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    errorsDetail: jsonb("errors_detail").$type<Array<{
      row: number;
      code: string;
      message: string;
    }> | null>(),
    createdAt: createdAt(),
  },
  (table) => [
    // Single-tenant boundary: every list query filters by organizationId and
    // orders by createdAt desc. This composite index covers both.
    index("import_job_logs_org_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

/** Audit logs table — records user actions for compliance and debugging. */
export const auditLogs = pgTable(
  "audit_logs",
  {
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
  },
  (table) => [
    index("audit_logs_org_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

/**
 * Client events table — observational telemetry reported by the browser
 * (frontend logger, future exam runtime / proctor instrumentation).
 *
 * Deliberately separate from `auditLogs`: audit logs are compliance records
 * of admin/actor actions; client events are best-effort frontend
 * observability. The single-tenant boundary is enforced via `organizationId`
 * on every row, populated server-side from the authenticated context.
 *
 * `userId` is nullable so anonymous-but-authenticated-edge events can still
 * be recorded; `receivedAt` is server time and the source of truth for
 * ordering, while `occurredAt` is the client-reported instant.
 */
export const clientEvents = pgTable(
  "client_events",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    userId: text("user_id"),
    attemptId: text("attempt_id"),
    examId: text("exam_id"),
    questionId: text("question_id"),
    kind: text("kind").notNull(),
    level: text("level").notNull(),
    name: text("name").notNull(),
    route: text("route"),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    clientSessionId: text("client_session_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("client_events_org_received_at_idx").on(
      table.organizationId,
      table.receivedAt,
    ),
    index("client_events_org_kind_received_at_idx").on(
      table.organizationId,
      table.kind,
      table.receivedAt,
    ),
    index("client_events_org_attempt_received_at_idx").on(
      table.organizationId,
      table.attemptId,
      table.receivedAt,
    ),
    index("client_events_org_exam_received_at_idx").on(
      table.organizationId,
      table.examId,
      table.receivedAt,
    ),
    index("client_events_org_name_received_at_idx").on(
      table.organizationId,
      table.name,
      table.receivedAt,
    ),
  ],
);

/**
 * Email outbox — a durable PostgreSQL-backed queue for email delivery (P5-0).
 *
 * The outbox pattern: business transactions only INSERT rows here; a separate
 * worker (`EmailDeliveryWorker`) claims due rows and sends them via an
 * `EmailSender`. Email failure is therefore asynchronous to the business
 * transaction and can never roll it back.
 *
 * Status lifecycle:
 *   pending -> processing -> sent (terminal)
 *                         -> retry_wait -> processing (on next_attempt_at due)
 *                         -> dead (terminal)
 *   processing -> pending (abandoned-lock recovery)
 *
 * `next_attempt_at` is null for first-attempt rows and for terminal (`sent`/
 * `dead`) rows; it is set on retry-scheduled rows using exponential backoff.
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    type: text("type").$type<EmailType>().notNull(),
    recipientEmail: text("recipient_email").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html"),
    status: text("status").$type<EmailOutboxStatus>().notNull(),
    attemptCount: integer("attempt_count").notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    lockedBy: text("locked_by"),
    providerMessageId: text("provider_message_id"),
    dedupeKey: text("dedupe_key"),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
      mode: "date",
    }),
    sentAt: timestamp("sent_at", {
      withTimezone: true,
      mode: "date",
    }),
    /**
     * Optional link to the Inbox notification that triggered this Email
     * (P5-N1-I2). Identity-flow Emails (registration_welcome etc.) keep this
     * null; operational Emails (result_published -> grade_notification) set
     * it so an Email can be traced back to its Inbox row.
     */
    notificationId: text("notification_id").references(() => notifications.id),
    /**
     * Optional recipient user link, independent of `recipient_email`. Lets a
     * future recipient-scoped query join without resolving through the
     * notification. Nullable for identity-flow Emails with no user binding.
     */
    recipientUserId: text("recipient_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Worker's primary query: due pending/retry_wait rows, oldest first, within an org.
    index("email_outbox_org_status_retry_idx").on(
      table.organizationId,
      table.status,
      table.nextAttemptAt,
    ),
    index("email_outbox_org_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    // Recovery query: abandoned processing rows (locked_at cutoff).
    index("email_outbox_org_status_locked_at_idx").on(
      table.organizationId,
      table.status,
      table.lockedAt,
    ),
    // Dedupe: only one non-null dedupe key per org across the full lifecycle.
    uniqueIndex("email_outbox_org_dedupe_key_unique")
      .on(table.organizationId, table.dedupeKey)
      .where(sql`"dedupe_key" IS NOT NULL`),
    // State machine CHECK constraints (database backstop).
    check(
      "email_outbox_status_check",
      sql`${table.status} IN ('pending','processing','retry_wait','sent','dead')`,
    ),
    check("email_outbox_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check("email_outbox_max_attempts_check", sql`${table.maxAttempts} >= 1`),
    check(
      "email_outbox_processing_must_have_lock",
      sql`
      (${table.status} <> 'processing') OR (${table.lockedAt} IS NOT NULL AND ${table.lockedBy} IS NOT NULL)
    `,
    ),
    check(
      "email_outbox_retry_wait_must_have_next",
      sql`
      (${table.status} <> 'retry_wait') OR (${table.nextAttemptAt} IS NOT NULL)
    `,
    ),
    check(
      "email_outbox_sent_must_have_sent_at",
      sql`
      (${table.status} <> 'sent') OR (${table.sentAt} IS NOT NULL)
    `,
    ),
    check(
      "email_outbox_dead_must_have_error",
      sql`
      (${table.status} <> 'dead') OR (${table.lastError} IS NOT NULL)
    `,
    ),
    check(
      "email_outbox_non_processing_no_lock",
      sql`
      (${table.status} = 'processing') OR (${table.lockedAt} IS NULL AND ${table.lockedBy} IS NULL)
    `,
    ),
  ],
);

/**
 * Worker heartbeats — PostgreSQL-backed liveness for background worker
 * processes (P5-0). The email worker updates its heartbeat after each
 * successful poll cycle. The API diagnostics surface reads these records
 * to determine worker liveness without process-local shared state, HTTP
 * RPC, or Redis.
 */
export const workerHeartbeats = pgTable(
  "worker_heartbeats",
  {
    id: id(),
    workerName: text("worker_name").notNull(),
    workerInstanceId: text("worker_instance_id").notNull(),
    lastPollAt: timestamp("last_poll_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    lastSuccessAt: timestamp("last_success_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastErrorAt: timestamp("last_error_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("worker_heartbeats_instance_uk").on(table.workerInstanceId),
    index("worker_heartbeats_name_instance_idx").on(
      table.workerName,
      table.workerInstanceId,
    ),
    index("worker_heartbeats_last_poll_at_idx").on(
      table.workerName,
      table.lastPollAt,
    ),
  ],
);

/**
 * Backup-run evidence ledger (P7-E2B).
 *
 * Durable, truthful records of backup mechanism executions, written by the
 * typed operator evidence CLI at the P7-C scripts' natural checkpoints.
 * This is NOT a scheduler, NOT a generic event store, NOT a settings table —
 * it is the evidence projection the product reads to answer "last backup",
 * "last VERIFIED backup", "last failure", "RPO posture" (E3).
 *
 * SUCCESS semantics (ADR-017 D10, P7-E1 §12.4):
 *   `succeeded` requires artifact produced + readable + verification passed
 *   + durable evidence committed. A run whose verification never happened is
 *   `pending`/`abandoned` — never success. `pg_dump exit 0` alone is not
 *   success; `file exists` alone is not success.
 *
 * Idempotency / duplicate-run invariant (D10 #2): at most ONE `succeeded`
 * row per (organization, operation_id) — enforced by the partial unique
 * index `backup_runs_org_operation_succeeded_unique`. A retry whose
 * completion would contradict an existing success is recorded as `failed`
 * with reason `duplicate_operation_conflict` (fail closed).
 *
 * Secrets: the ledger NEVER stores credentials, host paths, or the backup
 * destination URL. `artifact_label` is a safe reference (file name /
 * operator-provided label) suitable for display.
 */
export const backupRuns = pgTable(
  "backup_runs",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    /** Stable logical run identity (e.g. `logical:2026-08-12` for the daily
     *  cron slot). Retries of the same logical run share the operationId. */
    operationId: text("operation_id").notNull(),
    backupType: text("backup_type").notNull().$type<BackupType>(),
    status: text("status").notNull().$type<BackupRunStatus>(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    /** Safe artifact reference (file name / label) — never a host path. */
    artifactLabel: text("artifact_label"),
    artifactSizeBytes: bigint("artifact_size_bytes", { mode: "number" }),
    verificationMethod: text("verification_method"),
    verificationStatus: text(
      "verification_status",
    ).$type<BackupVerificationStatus>(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    /** Sanitized failure reason (no secrets, no credentials, no paths). */
    failureReason: text("failure_reason"),
    executorType: text("executor_type").notNull().$type<BackupExecutorType>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // At most one SUCCESS per logical run (D10 #2 — no contradictory
    // terminal evidence). Retry attempts (running/failed/abandoned) may
    // share the operationId freely.
    uniqueIndex("backup_runs_org_operation_succeeded_unique")
      .on(table.organizationId, table.operationId)
      .where(sql`status = 'succeeded'`),
    index("backup_runs_org_started_idx").on(
      table.organizationId,
      table.startedAt,
    ),
    check(
      "backup_runs_status_check",
      sql`${table.status} IN ('running', 'succeeded', 'failed', 'abandoned')`,
    ),
    check(
      "backup_runs_type_check",
      sql`${table.backupType} IN ('logical', 'physical_base', 'cold_filesystem')`,
    ),
    check(
      "backup_runs_verification_status_check",
      sql`${table.verificationStatus} IN ('verified', 'failed', 'pending')`,
    ),
    // SUCCESS requires verification evidence (D10 #1): a `succeeded` row must
    // carry verificationStatus = 'verified' at the DB level. NULL-safe: a
    // NULL verification_status must NOT satisfy the constraint (PostgreSQL
    // CHECK semantics would otherwise treat NULL as "passes").
    check(
      "backup_runs_success_verified_check",
      sql`(${table.status} <> 'succeeded' OR (${table.verificationStatus} IS NOT NULL AND ${table.verificationStatus} = 'verified'))`,
    ),
  ],
);

/**
 * Append-only transition log for backup runs (P7-E2B). One row per evidence
 * transition (started / succeeded / failed / abandoned / duplicate_rejected),
 * carrying the sanitized detail of that transition. Enables forensic answers
 * for crash/idempotency analysis ("the retry closed the previous running
 * attempt as abandoned") without overloading the run row.
 */
export const backupRunEvents = pgTable(
  "backup_run_events",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    runId: text("run_id")
      .notNull()
      .references(() => backupRuns.id, { onDelete: "cascade" }),
    operationId: text("operation_id").notNull(),
    eventType: text("event_type").notNull().$type<BackupRunEventType>(),
    detail: text("detail"),
    createdAt: createdAt(),
  },
  (table) => [
    index("backup_run_events_org_run_idx").on(
      table.organizationId,
      table.runId,
    ),
    check(
      "backup_run_events_type_check",
      sql`${table.eventType} IN ('started', 'succeeded', 'failed', 'abandoned', 'duplicate_rejected')`,
    ),
  ],
);

/**
 * Operational policy INTENT (P7-E3, ADR-017 D9).
 *
 * The typed, audited record of the Admin's DESIRED operational objectives:
 * recovery point objective (RPO), retention objective, and restore-drill
 * cadence. This is INTENT ONLY — it never binds, schedules, or rewrites
 * infrastructure (host cron / scripts remain the execution authority; the
 * product renders DESIRED vs OBSERVED vs STATUS and nothing else).
 *
 * This is NOT a generic settings store: the fields are typed with safe
 * ranges (CHECK constraints), the row is versioned for optimistic
 * concurrency (CAS), and every change is audited with a reason. One row per
 * organization (Phase 1 single-tenant); absence = NOT_CONFIGURED.
 *
 * Sole intent owner: Admin (system.ops.policy.manage). Maintainer reads the
 * intent (system.ops.policy.view) and never modifies it.
 */
export const backupOperationalPolicy = pgTable(
  "backup_operational_policy",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    /** Desired RPO in seconds (safe range 5 minutes .. 7 days). */
    desiredRpoSeconds: integer("desired_rpo_seconds").notNull(),
    /** Desired RTO in seconds (nullable: NOT_CONFIGURED for legacy rows). Safe range 30s .. 48h when non-null. */
    desiredRtoSeconds: integer("desired_rto_seconds"),
    /** Desired backup retention objective in days (1 .. 3650). */
    desiredRetentionDays: integer("desired_retention_days").notNull(),
    /** Desired restore-drill cadence in days (1 .. 365). */
    desiredDrillCadenceDays: integer("desired_drill_cadence_days").notNull(),
    /** Optimistic-concurrency version (CAS on every update). */
    version: integer("version").notNull().default(1),
    /** Required human-readable reason for the change. */
    reason: text("reason").notNull(),
    /** Actor that created/updated the intent. */
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("backup_operational_policy_org_unique").on(
      table.organizationId,
    ),
    check(
      "backup_operational_policy_rpo_check",
      sql`${table.desiredRpoSeconds} BETWEEN 300 AND 604800`,
    ),
    check(
      "backup_operational_policy_retention_check",
      sql`${table.desiredRetentionDays} BETWEEN 1 AND 3650`,
    ),
    check(
      "backup_operational_policy_cadence_check",
      sql`${table.desiredDrillCadenceDays} BETWEEN 1 AND 365`,
    ),
    check(
      "backup_operational_policy_rto_check",
      sql`${table.desiredRtoSeconds} IS NULL OR (${table.desiredRtoSeconds} BETWEEN 30 AND 172800)`,
    ),
  ],
);

/**
 * Restore-drill evidence (P7-E2B). Records restore-readiness drills: the
 * deterministic deployment drills (automated) and operator-recorded drills
 * (operator_declared). The read projection distinguishes the two — a declared
 * success is never rendered as automated proof. Restore itself remains
 * host-only; this table only records EVIDENCE of drills, never execution
 * authority.
 */
export const restoreDrillRuns = pgTable(
  "restore_drill_runs",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    /** Stable drill identity (e.g. `logical-restore:2026-08-12`). */
    operationId: text("operation_id").notNull(),
    backupType: text("backup_type").notNull().$type<BackupType>(),
    result: text("result").notNull().$type<RestoreDrillResult>(),
    source: text("source").notNull().$type<RestoreDrillSource>(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    durationMs: bigint("duration_ms", { mode: "number" }),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("restore_drill_runs_org_operation_unique").on(
      table.organizationId,
      table.operationId,
    ),
    check(
      "restore_drill_runs_result_check",
      sql`${table.result} IN ('succeeded', 'failed')`,
    ),
    check(
      "restore_drill_runs_source_check",
      sql`${table.source} IN ('automated', 'operator_declared')`,
    ),
  ],
);

/**
 * Host-side retention evidence (P7-CLOSE P7-3b). Records automated
 * retention/expire operations executed by the Host Operator outside Exam RBAC.
 * This is EVIDENCE only — Exam never performs retention. Success means: the
 * retention operation succeeded AND repository/chain verification succeeded,
 * not merely that a delete command returned zero.
 */
export const retentionRuns = pgTable(
  "retention_runs",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    /** Stable operation identity (e.g. `retention:2026-08-13T10`). */
    operationId: text("operation_id").notNull(),
    /** Retention tool identifier (e.g. `pgbackrest`, `wal-g`). */
    tool: text("tool").notNull(),
    /** Terminal outcome of the retention run. */
    result: text("result").notNull().$type<RetentionRunResult>(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    /** Number of old backups pruned (safe summary count). */
    prunedBackups: integer("pruned_backups"),
    /** Number of old WAL archives pruned (safe summary count). */
    prunedWalArchives: integer("pruned_wal_archives"),
    /** Human-readable retention objective applied (e.g. "keep 2 full + 7d WAL"). */
    retentionObjective: text("retention_objective"),
    /** Post-expire repository verification outcome. */
    verificationStatus: text(
      "verification_status",
    ).$type<BackupVerificationStatus | null>(),
    verificationDetail: text("verification_detail"),
    failureReason: text("failure_reason"),
    /** Always host_script — Exam never executes retention. */
    executorType: text("executor_type")
      .notNull()
      .default("host_script")
      .$type<BackupExecutorType>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("retention_runs_org_operation_unique").on(
      table.organizationId,
      table.operationId,
    ),
    check(
      "retention_runs_result_check",
      sql`${table.result} IN ('succeeded', 'failed')`,
    ),
    check(
      "retention_runs_verification_check",
      sql`${table.verificationStatus} IS NULL OR (${table.verificationStatus} IN ('verified', 'failed', 'pending'))`,
    ),
    // Success ↔ verified cross-field invariant: a retention run may be recorded
    // as `succeeded` ONLY when the repository/chain verification is `verified`
    // AND it has a completion time. This closes the gap where `result` and
    // `verification_status` were parsed independently — `succeeded` +
    // `verification_status = failed` would otherwise render as
    // latestSuccessfulRetention, contradicting the table's own docstring
    // ("success = retention succeeded AND verification succeeded"). The DB is
    // the ultimate authority; the CLI and repo mirror this. NULL-safe:
    // `IS NOT DISTINCT FROM 'verified'` (not `=`) so a forged `succeeded` row
    // cannot skip the requirement via a NULL verification_status.
    check(
      "retention_runs_success_verified_check",
      sql`${table.result} <> 'succeeded' OR (${table.verificationStatus} IS NOT DISTINCT FROM 'verified' AND ${table.completedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Roles assignable to a user via the RBAC-M8 role-assignment surface.
 * `System` is excluded (synthetic, non-assignable). `SuperAdmin` is not defined
 * (no ADR). Phase 1 `users.role` still only carries Admin/Candidate; the
 * assignment table is the path to the broader Phase 3 set. P7-E2A (ADR-017 D2
 * amendment of ADR-010) adds `Maintainer` — the application-side System
 * Operations Owner preset (operational observation only).
 */
export const ASSIGNABLE_ROLES = [
  "Admin",
  "Teacher",
  "Proctor",
  "Grader",
  "Candidate",
  "Maintainer",
] as const;
// NOTE: AssignableRole is also defined in @exam/contracts (AssignableRoleSchema).
// The two are structurally identical by design — db cannot depend on contracts
// (dependency layering), so both stay. Keep them in sync when editing.
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/**
 * User role assignments (RBAC-M7). Multi-role: a user may hold several role
 * rows per organization, exactly one of which is the primary active role.
 * `users.role` is kept in sync with the primary active assignment during the
 * migration window (ADR § compatibility cache). The primary-uniqueness rule
 * (≤1 primary active per user/org) is enforced BOTH at the application layer
 * (userRoleAssignmentRepo `assign` / `assignWithinTransaction` /
 * `ensurePrimaryAssignment` transactional demotion) AND by the
 * `user_role_assignments_active_primary_unique` partial unique index, which
 * the runtime resolver (RBAC-M10-E) also fail-closes on. The table-level
 * check constrains `role` to the assignable set as a direct-write guard.
 */
export const userRoleAssignments = pgTable(
  "user_role_assignments",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<AssignableRole>(),
    isPrimary: boolean("is_primary").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("user_role_assignments_org_user_role_unique").on(
      table.organizationId,
      table.userId,
      table.role,
    ),
    // RBAC-M10-E: DB-level backstop for the ≤1 active-primary-per-(org,user)
    // invariant. The app layer demotes prior primaries transactionally; this
    // partial unique index makes concurrent-insert corruption reject at the DB
    // (23505) rather than only fail-closed in the resolver.
    uniqueIndex("user_role_assignments_active_primary_unique")
      .on(table.organizationId, table.userId)
      .where(sql`is_primary = true AND is_active = true`),
    check(
      "user_role_assignments_role_check",
      sql`${table.role} IN ('Admin', 'Teacher', 'Proctor', 'Grader', 'Candidate', 'Maintainer')`,
    ),
  ],
);

/**
 * Notification Inbox — the first-class PostgreSQL Inbox surface (P5-N1).
 *
 * The Inbox is the authoritative in-product notification channel. It is
 * scoped per (organization, recipient user) and supports stable list
 * ordering, unread count, mark-read, and idempotent fan-out via a recipient-
 * scoped dedupe key. Email outbox rows (P5-N1-I2) link back to a notification
 * via `email_outbox.notification_id`.
 *
 * V1 only writes rows of `type = "result_published"`. Every V1 notification
 * is actionable (action_path NOT NULL); future informational types that lack
 * a navigation target must introduce an explicit migration + contract change.
 * The schema intentionally does NOT carry severity / resource_type /
 * resource_id / archived_at / invalidated_at columns — they have no V1 reader
 * or writer and are deferred (P5-N1-R0 §12, §22).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull().$type<NotificationType>(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    actionPath: text("action_path").notNull(),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    dedupeKey: text("dedupe_key"),
  },
  (table) => [
    // Stable Inbox list order: org + recipient + newest first, id as tiebreak.
    index("notifications_org_recipient_created_at_id_idx").on(
      table.organizationId,
      table.recipientUserId,
      table.createdAt,
      table.id,
    ),
    // Unread count query: org + recipient + read_at (null = unread).
    index("notifications_org_recipient_read_at_idx").on(
      table.organizationId,
      table.recipientUserId,
      table.readAt,
    ),
    // Idempotent fan-out: at most one row per (org, recipient, dedupe_key)
    // across the lifetime of a notification. NULL keys are unrestricted.
    uniqueIndex("notifications_org_recipient_dedupe_key_unique")
      .on(table.organizationId, table.recipientUserId, table.dedupeKey)
      .where(sql`"dedupe_key" IS NOT NULL`),
  ],
);

// ── Exam Incident Tables (ADR-014) ──────────────────────────────────

/**
 * Exam incidents — durable operational case records.
 * ADR-014: orthogonal state dimension alongside Attempt lifecycle.
 */
export const examIncidents = pgTable(
  "exam_incidents",
  {
    id: uuid("id").primaryKey(),
    organizationId: organizationId().references(() => organizations.id),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    attemptId: text("attempt_id"),
    candidateId: text("candidate_id").references(() => candidateProfiles.id),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("info"),
    status: text("status").notNull().default("open"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }),
    description: text("description").notNull(),
    resolutionSummary: text("resolution_summary"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    resolvedBy: text("resolved_by"),
    reportedBy: text("reported_by").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("exam_incidents_org_id_unique").on(
      table.organizationId,
      table.id,
    ),
    index("exam_incidents_org_attempt_idx").on(
      table.organizationId,
      table.attemptId,
    ),
    index("exam_incidents_org_exam_status_idx").on(
      table.organizationId,
      table.examId,
      table.status,
    ),
    // Org-wide Recovery Queue ordering `(created_at DESC, id DESC)` — the
    // default page and the keyset-cursor page both scan this index
    // (PostgreSQL B-tree supports backward scans).
    index("exam_incidents_org_created_at_id_idx").on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    index("exam_incidents_active_status_idx")
      .on(table.organizationId, table.status)
      .where(sql`${table.status} IN ('open', 'investigating')`),
    check(
      "exam_incidents_type_check",
      sql`${table.type} IN ('network_interruption','device_failure','power_failure','candidate_unable_to_continue','suspected_misconduct','operator_error','system_outage','environmental_disruption','other')`,
    ),
    check(
      "exam_incidents_severity_check",
      sql`${table.severity} IN ('info','minor','major','critical')`,
    ),
    check(
      "exam_incidents_status_check",
      sql`${table.status} IN ('open','investigating','resolved','dismissed')`,
    ),
    check(
      "exam_incidents_description_check",
      sql`length(btrim(${table.description})) BETWEEN 1 AND 1000`,
    ),
    check(
      "exam_incidents_resolution_summary_check",
      sql`${table.resolutionSummary} IS NULL OR length(btrim(${table.resolutionSummary})) BETWEEN 1 AND 1000`,
    ),
    check("exam_incidents_version_check", sql`${table.version} >= 1`),
    // Composite FK to exam_attempts when attempt_id is set
    foreignKey({
      columns: [table.organizationId, table.attemptId],
      foreignColumns: [examAttempts.organizationId, examAttempts.id],
      name: "exam_incidents_org_attempt_fk",
    }),
  ],
);

/**
 * Exam incident events — append-only event history.
 * `event_sequence` (BIGINT GENERATED ALWAYS AS IDENTITY) is the sole ordering authority.
 */
export const examIncidentEvents = pgTable(
  "exam_incident_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: organizationId().references(() => organizations.id),
    incidentId: uuid("incident_id").notNull(),
    eventSequence: bigint("event_sequence", {
      mode: "number",
    }).generatedAlwaysAsIdentity(),
    eventType: text("event_type").notNull(),
    commandType: text("command_type").notNull(),
    operationId: uuid("operation_id").notNull(),
    actorId: text("actor_id"),
    beforeVersion: integer("before_version").notNull(),
    afterVersion: integer("after_version").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("exam_incident_events_org_operation_unique").on(
      table.organizationId,
      table.operationId,
    ),
    index("exam_incident_events_incident_sequence_idx").on(
      table.incidentId,
      table.eventSequence,
    ),
    check(
      "exam_incident_events_event_type_check",
      sql`${table.eventType} IN ('incident_created','investigation_started','note_added','severity_changed','incident_resolved','incident_dismissed','action_linked','attempt_linked','interruption_linked')`,
    ),
    check(
      "exam_incident_events_version_check",
      sql`${table.beforeVersion} >= 0 AND ${table.afterVersion} >= 0`,
    ),
    foreignKey({
      columns: [table.organizationId, table.incidentId],
      foreignColumns: [examIncidents.organizationId, examIncidents.id],
      name: "exam_incident_events_incident_fk",
    }),
  ],
);

/**
 * Exam incident actions — links to separately authoritative operator actions.
 * action_type ∈ {time_grant, force_submit} (misconduct_mark deferred).
 */
export const examIncidentActions = pgTable(
  "exam_incident_actions",
  {
    id: uuid("id").primaryKey(),
    organizationId: organizationId().references(() => organizations.id),
    incidentId: uuid("incident_id").notNull(),
    actionType: text("action_type").notNull(),
    actionId: text("action_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    actorId: text("actor_id"),
    linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    operationId: uuid("operation_id").notNull(),
  },
  (table) => [
    uniqueIndex("exam_incident_actions_org_action_unique").on(
      table.organizationId,
      table.actionType,
      table.actionId,
    ),
    // operationId idempotency lookup: (organization_id, operation_id) — the
    // tenant predicate is part of the query, so a bare (operation_id) index
    // would not cover it.
    index("exam_incident_actions_org_operation_idx").on(
      table.organizationId,
      table.operationId,
    ),
    index("exam_incident_actions_incident_idx").on(table.incidentId),
    check(
      "exam_incident_actions_action_type_check",
      sql`${table.actionType} IN ('time_grant', 'force_submit')`,
    ),
    foreignKey({
      columns: [table.organizationId, table.incidentId],
      foreignColumns: [examIncidents.organizationId, examIncidents.id],
      name: "exam_incident_actions_incident_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.attemptId],
      foreignColumns: [examAttempts.organizationId, examAttempts.id],
      name: "exam_incident_actions_attempt_fk",
    }),
  ],
);

/**
 * Exam incident attempts — affected-attempt membership for exam-wide incidents.
 * Only allowed when incident.attemptId IS NULL (anchor exclusivity).
 */
export const examIncidentAttempts = pgTable(
  "exam_incident_attempts",
  {
    id: uuid("id").primaryKey(),
    organizationId: organizationId().references(() => organizations.id),
    incidentId: uuid("incident_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    relationshipType: text("relationship_type").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    linkedBy: text("linked_by").notNull(),
    operationId: uuid("operation_id").notNull(),
  },
  (table) => [
    uniqueIndex("exam_incident_attempts_incident_attempt_unique").on(
      table.incidentId,
      table.attemptId,
    ),
    // operationId idempotency lookup: (organization_id, operation_id) — the
    // tenant predicate is part of the query, so a bare (operation_id) index
    // would not cover it.
    index("exam_incident_attempts_org_operation_idx").on(
      table.organizationId,
      table.operationId,
    ),
    check(
      "exam_incident_attempts_relationship_type_check",
      sql`${table.relationshipType} IN ('affected', 'referenced')`,
    ),
    foreignKey({
      columns: [table.organizationId, table.incidentId],
      foreignColumns: [examIncidents.organizationId, examIncidents.id],
      name: "exam_incident_attempts_incident_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.attemptId],
      foreignColumns: [examAttempts.organizationId, examAttempts.id],
      name: "exam_incident_attempts_attempt_fk",
    }),
  ],
);

/**
 * Exam incident interruption links — evidence links to interruption episodes.
 * The interruption ledger remains authoritative for compensated time.
 */
export const examIncidentInterruptionLinks = pgTable(
  "exam_incident_interruption_links",
  {
    id: uuid("id").primaryKey(),
    organizationId: organizationId().references(() => organizations.id),
    incidentId: uuid("incident_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    interruptionId: uuid("interruption_id").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    linkedBy: text("linked_by").notNull(),
    operationId: uuid("operation_id").notNull(),
  },
  (table) => [
    uniqueIndex(
      "exam_incident_interruption_links_incident_interruption_unique",
    ).on(table.incidentId, table.interruptionId),
    // operationId idempotency lookup: (organization_id, operation_id) — the
    // tenant predicate is part of the query, so a bare (operation_id) index
    // would not cover it.
    index("exam_incident_interruption_links_org_operation_idx").on(
      table.organizationId,
      table.operationId,
    ),
    foreignKey({
      columns: [table.organizationId, table.incidentId],
      foreignColumns: [examIncidents.organizationId, examIncidents.id],
      name: "exam_incident_interruption_links_incident_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.attemptId, table.interruptionId],
      foreignColumns: [
        attemptInterruptions.organizationId,
        attemptInterruptions.attemptId,
        attemptInterruptions.id,
      ],
      name: "exam_incident_interruption_links_interruption_fk",
    }),
  ],
);

// ── Proctor-to-Exam Assignment Tables (ADR-015) ───────────────────

/**
 * Proctor-to-Exam assignment episodes (ADR-015 §4.1) — current state rows.
 * At most one ACTIVE episode per (organization, exam, proctor) (partial
 * unique); revoked episodes remain as history. No operation_id / reason_code
 * columns on this row — operationId lives on the events table; reasonCode
 * lives only inside the event's canonical_payload (single source of truth).
 */
export const examProctorAssignments = pgTable(
  "exam_proctor_assignments",
  {
    id: id(),
    // organizationId / user FKs are declared as explicit named foreign keys
    // below (the drizzle-generated names exceed PostgreSQL's 63-char
    // identifier limit for this table's longer name).
    organizationId: text("organization_id").notNull(),
    examId: text("exam_id").notNull(),
    proctorUserId: text("proctor_user_id").notNull(),
    status: text("status").notNull().default("active"),
    assignedBy: text("assigned_by").notNull(),
    assignedAt: timestamp("assigned_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    revokedBy: text("revoked_by"),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Composite-FK target for the events table (ADR-015 §4.1).
    uniqueIndex("exam_proctor_assignments_org_id_unique").on(
      table.organizationId,
      table.id,
    ),
    // The one-active-episode arbiter (ADR-015 §7).
    uniqueIndex("exam_proctor_assignments_active_unique")
      .on(table.organizationId, table.examId, table.proctorUserId)
      .where(sql`${table.status} = 'active'`),
    // listExamProctors (ADR-015 §4.1).
    index("exam_proctor_assignments_org_exam_status_idx").on(
      table.organizationId,
      table.examId,
      table.status,
    ),
    // listProctorExams (ADR-015 §4.1).
    index("exam_proctor_assignments_org_proctor_status_idx").on(
      table.organizationId,
      table.proctorUserId,
      table.status,
    ),
    // Revoke-target episode resolution: active if present, else most-recent
    // revoked by (revoked_at DESC, id DESC) (ADR-015 §6).
    index("exam_proctor_assignments_revoke_target_idx").on(
      table.organizationId,
      table.examId,
      table.proctorUserId,
      table.status,
      sql`${table.revokedAt} DESC`,
      sql`${table.id} DESC`,
    ),
    check(
      "exam_proctor_assignments_status_check",
      sql`${table.status} IN ('active', 'revoked')`,
    ),
    check(
      "exam_proctor_assignments_revocation_shape_check",
      sql`
        (
          ${table.status} = 'active'
          AND ${table.revokedAt} IS NULL
          AND ${table.revokedBy} IS NULL
        )
        OR
        (
          ${table.status} = 'revoked'
          AND ${table.revokedAt} IS NOT NULL
          AND ${table.revokedBy} IS NOT NULL
        )
      `,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "exam_proctor_assignments_org_fk",
    }),
    foreignKey({
      columns: [table.proctorUserId],
      foreignColumns: [users.id],
      name: "exam_proctor_assignments_proctor_user_fk",
    }),
    foreignKey({
      columns: [table.assignedBy],
      foreignColumns: [users.id],
      name: "exam_proctor_assignments_assigned_by_fk",
    }),
    foreignKey({
      columns: [table.revokedBy],
      foreignColumns: [users.id],
      name: "exam_proctor_assignments_revoked_by_fk",
    }),
    // Composite FK to exams(organization_id, id) — requires the
    // exams_org_id_unique index added above (ADR-015 §4.1 / §15).
    foreignKey({
      columns: [table.organizationId, table.examId],
      foreignColumns: [exams.organizationId, exams.id],
      name: "exam_proctor_assignments_exam_fk",
    }),
  ],
);

/**
 * Proctor-to-Exam assignment events — append-only command receipts
 * (ADR-015 §4.2). `UNIQUE (organization_id, operation_id)` is the sole
 * idempotency arbiter (NOT audit_logs). `assignment_id` is NOT NULL: every
 * event acquires its episode id in the same transaction that creates or
 * resolves the episode. `actor_id` is NOT NULL — assign/revoke are human
 * Admin commands; there is no anonymous actor path.
 */
export const examProctorAssignmentEvents = pgTable(
  "exam_proctor_assignment_events",
  {
    id: uuid("id").primaryKey(),
    // Explicit named FK below (generated name exceeds PG identifier limit).
    organizationId: text("organization_id").notNull(),
    assignmentId: text("assignment_id").notNull(),
    commandType: text("command_type").notNull(),
    operationId: uuid("operation_id").notNull(),
    canonicalPayload: jsonb("canonical_payload").notNull(),
    outcome: text("outcome").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // The idempotency arbiter (ADR-015 §4.2 / §7).
    uniqueIndex("exam_proctor_assignment_events_org_operation_unique").on(
      table.organizationId,
      table.operationId,
    ),
    index("exam_proctor_assignment_events_assignment_idx").on(
      table.organizationId,
      table.assignmentId,
      table.createdAt,
    ),
    check(
      "exam_proctor_assignment_events_command_type_check",
      sql`${table.commandType} IN ('assign', 'revoke')`,
    ),
    check(
      "exam_proctor_assignment_events_outcome_check",
      sql`${table.outcome} IN ('applied', 'no_change')`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "exam_proctor_assignment_events_org_fk",
    }),
    foreignKey({
      columns: [table.actorId],
      foreignColumns: [users.id],
      name: "exam_proctor_assignment_events_actor_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.assignmentId],
      foreignColumns: [
        examProctorAssignments.organizationId,
        examProctorAssignments.id,
      ],
      name: "exam_proctor_assignment_events_assignment_fk",
    }),
  ],
);

/**
 * Durable attempt command receipt (J5-I1C Slice 1 / J5-I1C0 audit §6.2).
 *
 * One shared append-only table for the two dangerous Attempt commands
 * (`force_submit`, `misconduct_mark`), arbitrated by the single
 * `UNIQUE (organization_id, operation_id)` constraint. That constraint is the
 * ONE cross-command idempotency arbiter: a force_submit and a misconduct_mark
 * carrying the same operationId within one organization cannot both insert.
 * operationId scope is PER ORGANIZATION (not per attempt, not per command).
 *
 * `requestPayload` is the canonical input (replay/conflict comparison input);
 * `resultPayload` is the immutable committed fact (returned verbatim on replay
 * — never re-derived from the live attempt). The persistent `outcome` column
 * is restricted to ('applied', 'no_change'); the HTTP layer may surface a
 * third wire disposition `idempotent_replay`, but it is NEVER written here and
 * NEVER mutates an existing receipt (audit §3.3).
 *
 * Shape mirrors `exam_proctor_assignment_events` (canonical jsonb + outcome +
 * actor) and the unified-arbiter discipline of `exam_incident_events` (one
 * table, one UNIQUE(org, operation_id), many commandType values).
 */
export const attemptCommandReceipts = pgTable(
  "attempt_command_receipts",
  {
    id: uuid("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    commandType: text("command_type").notNull(),
    requestPayload: jsonb("request_payload").notNull(),
    resultPayload: jsonb("result_payload").notNull(),
    outcome: text("outcome").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // The idempotency arbiter (ADR-014 §9 / ADR-015 §4.2 / J5-I1C0 §4.5).
    uniqueIndex("attempt_command_receipts_org_operation_unique").on(
      table.organizationId,
      table.operationId,
    ),
    // PRIMARY per-attempt history index (audit §6.2 name + id tie-breaker):
    // serves the unfiltered listByAttempt ordering (created_at ASC, id ASC)
    // directly. The command-filtered listByAttempt gets its own index below —
    // a single index cannot cover both orderings (command_type sits between
    // attempt_id and created_at in the B-tree key).
    index("attempt_command_receipts_org_attempt_created_idx").on(
      table.organizationId,
      table.attemptId,
      table.createdAt,
      table.id,
    ),
    // Command-filtered history: (organization_id, attempt_id, command_type)
    // equality prefix + the same (created_at, id) ordering tail.
    index("attempt_command_receipts_org_attempt_command_created_idx").on(
      table.organizationId,
      table.attemptId,
      table.commandType,
      table.createdAt,
      table.id,
    ),
    check(
      "attempt_command_receipts_command_type_check",
      sql`${table.commandType} IN ('force_submit', 'misconduct_mark')`,
    ),
    check(
      "attempt_command_receipts_outcome_check",
      sql`${table.outcome} IN ('applied', 'no_change')`,
    ),
    check(
      "attempt_command_receipts_request_payload_check",
      sql`jsonb_typeof(${table.requestPayload}) = 'object'`,
    ),
    check(
      "attempt_command_receipts_result_payload_check",
      sql`jsonb_typeof(${table.resultPayload}) = 'object'`,
    ),
    foreignKey({
      columns: [table.organizationId, table.attemptId],
      foreignColumns: [examAttempts.organizationId, examAttempts.id],
      name: "attempt_command_receipts_org_attempt_fk",
    }),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "attempt_command_receipts_org_fk",
    }),
    // Composite org+actor FK → users(organization_id, id) (target index:
    // users_org_id_unique). The identity graph is DB-enforced: an actor from
    // a DIFFERENT organization cannot be recorded on a receipt (overnight
    // hardening — the previous plain users(id) FK only proved existence).
    foreignKey({
      columns: [table.organizationId, table.actorId],
      foreignColumns: [users.organizationId, users.id],
      name: "attempt_command_receipts_actor_fk",
    }),
  ],
);

/** Aggregated schema object exporting all tables for Drizzle configuration. */
export const schema = {
  organizations,
  organizationSettings,
  candidateFields,
  users,
  candidateProfiles,
  userRoleAssignments,
  courses,
  questions,
  exams,
  examEnrollments,
  examAttempts,
  attemptInterruptions,
  attemptTimeAdjustments,
  attemptInterruptionEvents,
  attemptGradingEntries,
  auditLogs,
  clientEvents,
  importJobLogs,
  emailOutbox,
  notifications,
  examIncidents,
  examIncidentEvents,
  examIncidentActions,
  examIncidentAttempts,
  examIncidentInterruptionLinks,
  examProctorAssignments,
  examProctorAssignmentEvents,
  attemptCommandReceipts,
  backupRuns,
  backupRunEvents,
  backupOperationalPolicy,
  restoreDrillRuns,
};
