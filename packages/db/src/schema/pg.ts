import type {
  AnswerRecord,
  Attachment,
  AttemptGradingEntry,
  ControlFlags,
  EmailOutboxStatus,
  EmailType,
  GradingEntryMode,
  GradingEntryStatus,
  GradingRule,
  GradingStatus,
  MisconductFlag,
  QuestionScoreResult,
  QuestionSnapshot,
  ResultPublicationMode,
  SubmittedAnswersSnapshot,
} from "@exam/domain";
import {
  boolean,
  check,
  doublePrecision,
  index,
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
    /**
     * Optional notification recipient email (P5-N1 §13).
     *
     * NOT used for login. NOT unique. NOT verified. The first V1 consumer is
     * the `result_published` Inbox + Email outbox integration. The contract
     * layer normalizes (trim + lowercase) and maps blank input to null.
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
    check("exams_passing_score_min_check", sql`${table.passingScore} >= 0`),
    check("exams_total_score_positive_check", sql`${table.totalScore} > 0`),
    check(
      "exams_passing_score_max_check",
      sql`${table.passingScore} <= ${table.totalScore}`,
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
    notificationId: text("notification_id"),
    /**
     * Optional recipient user link, independent of `recipient_email`. Lets a
     * future recipient-scoped query join without resolving through the
     * notification. Nullable for identity-flow Emails with no user binding.
     */
    recipientUserId: text("recipient_user_id"),
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
 * Roles assignable to a user via the RBAC-M8 role-assignment surface.
 * `System` is excluded (synthetic, non-assignable). `SuperAdmin` is not defined
 * (no ADR). Phase 1 `users.role` still only carries Admin/Candidate; the
 * assignment table is the path to the broader Phase 3 set.
 */
export const ASSIGNABLE_ROLES = [
  "Admin",
  "Teacher",
  "Proctor",
  "Grader",
  "Candidate",
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
      sql`${table.role} IN ('Admin', 'Teacher', 'Proctor', 'Grader', 'Candidate')`,
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
 * V1 only writes rows of `type = "result_published"`. The schema intentionally
 * does NOT carry severity / resource_type / resource_id / archived_at /
 * invalidated_at columns — they have no V1 reader or writer and are deferred
 * (P5-N1-R0 §12, §22).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    actionPath: text("action_path"),
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
  attemptGradingEntries,
  auditLogs,
  clientEvents,
  importJobLogs,
  emailOutbox,
  notifications,
};
