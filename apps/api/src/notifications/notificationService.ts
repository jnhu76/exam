import type { Database, TenantContext } from "@exam/db/src/types.js";
import { createNotificationRepo } from "@exam/db/src/repository/notificationRepo.js";
import { createEmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";
import type { NotificationRow } from "@exam/db/src/repository/notificationRepo.js";
import {
  resolveEmailTypeForNotification,
  requiresInbox,
  emailEnabledForRecipient,
} from "./policy.js";
import {
  buildResultPublishedActionPath,
  buildExamAssignedActionPath,
  buildAbsoluteNotificationLink,
} from "./actionLink.js";
import { renderGradeNotificationEmail } from "./gradeNotificationEmail.js";
import { renderExamAssignedEmail } from "./examAssignedEmail.js";

// P5-N1-I2 — channel-neutral NotificationService.
//
// The service composes the Inbox repository + Email outbox repository inside
// the caller's transaction. SMTP is NOT called here — the worker drains the
// outbox asynchronously (P5-0). Per ADR-011 + P5-N1-R0 §17:
//   - Inbox row is REQUIRED (failure rolls back the publication transaction)
//   - Email outbox row is REQUIRED when a normalized recipient email exists
//     (failure rolls back the publication transaction)
//   - The outbox row insert therefore THROWS on failure; a best-effort
//     (swallow-and-continue) insert would silently break that atomicity.

/** Dedupe key for the Inbox row (recipient-scoped). P5-N1-R0 §11.2. */
function inboxDedupeKey(examId: string): string {
  return `result_published:${examId}`;
}

/** Dedupe key for the outbox row (recipient-scoped). P5-N1-R0 §11.2. */
function outboxDedupeKey(examId: string, recipientUserId: string): string {
  return `result_published:${examId}:${recipientUserId}`;
}

/** Options for dispatching a result_published notification fan-out. */
export interface DispatchResultPublishedOptions {
  /** Caller's transaction-scoped db handle (the publication transaction). */
  db: Database;
  /** Tenant context (organizationId derived from here). */
  ctx: TenantContext;
  /** Exam title (server-trusted, escaped at Email render time). */
  examTitle: string;
  /** Exam id (the stable publication identity for dedupe keys). */
  examId: string;
  /** Resolved recipient set (recipientResolver.resolveResultPublishedRecipients). */
  recipients: ReadonlyArray<{
    userId: string;
    email: string | null;
    attemptId: string;
  }>;
  /** Public web origin for absolute Email links (from runtime config). */
  publicWebOrigin: string;
  /** Default maxAttempts for outbox rows (from email config). */
  emailMaxAttempts: number;
  /** Authoritative timestamp for this fan-out (from fastify.now()). */
  now: Date;
}

/** Result of a single recipient's dispatch (Inbox + optional outbox). */
export interface RecipientDispatchResult {
  /** The Inbox notification row (existing or newly created). */
  notification: NotificationRow;
  /** True iff a NEW Inbox row was inserted (false = dedupe-key reuse). */
  inboxCreated: boolean;
  /** True iff a NEW outbox row was inserted (false/undefined = none). */
  outboxCreated: boolean;
}

/**
 * Dispatches the result_published notification fan-out for one recipient.
 *
 * Idempotent via the dedupe keys: a duplicate trigger for the same
 * (exam, recipient) is a no-op. All writes run in the caller's transaction;
 * a failed required Inbox or outbox insert rolls back the publication.
 *
 * Returns the dispatch result for telemetry/audit; the publication route does
 * not depend on the return value for correctness.
 */
export async function dispatchResultPublishedToRecipient(
  opts: DispatchResultPublishedOptions,
  recipient: { userId: string; email: string | null; attemptId: string },
): Promise<RecipientDispatchResult> {
  const { db, ctx, examTitle, examId, publicWebOrigin, emailMaxAttempts, now } =
    opts;
  const type = "result_published";

  if (!requiresInbox(type)) {
    // V1 always requires Inbox; this is a defensive guard for future types.
    throw new Error(
      `dispatchResultPublishedToRecipient: type ${type} does not require Inbox — refusing to dispatch`,
    );
  }

  const notificationRepo = createNotificationRepo(db);
  const emailOutboxRepo = createEmailOutboxRepo(db);

  // 1. REQUIRED Inbox row.
  const actionPath = buildResultPublishedActionPath(recipient.attemptId);
  const inboxInsert = await notificationRepo.insert(
    ctx,
    {
      recipientUserId: recipient.userId,
      type,
      title: "考试结果已发布",
      body: `您参加的考试「${examTitle}」的结果已发布，点击查看。`,
      actionPath,
      dedupeKey: inboxDedupeKey(examId),
    },
    now,
  );

  // 2. OPTIONAL Email outbox row — only when policy enables Email for this
  //    recipient (normalized email present) AND the Inbox row was newly
  //    created (idempotent: a duplicate trigger skips the outbox insert).
  let outboxCreated = false;
  const recipientEmail = recipient.email;
  if (
    inboxInsert.created &&
    recipientEmail != null &&
    emailEnabledForRecipient(type, recipientEmail)
  ) {
    const emailType = resolveEmailTypeForNotification(type);
    if (emailType == null) {
      throw new Error(
        `dispatchResultPublishedToRecipient: policy enabled Email for ${type} but no EmailType mapping exists`,
      );
    }
    const absoluteLink = buildAbsoluteNotificationLink(
      actionPath,
      publicWebOrigin,
    );
    const rendered = renderGradeNotificationEmail({
      examTitle,
      actionPath: absoluteLink,
    });
    // REQUIRED insert (throws on failure → rolls back the publication tx).
    await emailOutboxRepo.create(ctx, {
      type: emailType,
      recipientEmail,
      subject: rendered.subject,
      bodyText: rendered.bodyText,
      bodyHtml: rendered.bodyHtml,
      maxAttempts: emailMaxAttempts,
      dedupeKey: outboxDedupeKey(examId, recipient.userId),
      notificationId: inboxInsert.row.id,
      recipientUserId: recipient.userId,
    });
    outboxCreated = true;
  }

  return {
    notification: inboxInsert.row,
    inboxCreated: inboxInsert.created,
    outboxCreated,
  };
}

/**
 * Dispatches the result_published fan-out for ALL resolved recipients, inside
 * the caller's transaction. Each recipient is dispatched independently; a
 * failure on any required write rolls back the whole publication transaction.
 *
 * Returns a summary for telemetry/audit.
 */
export async function dispatchResultPublishedFanOut(
  opts: DispatchResultPublishedOptions,
): Promise<{
  recipientsProcessed: number;
  inboxRowsCreated: number;
  outboxRowsCreated: number;
}> {
  let inboxRowsCreated = 0;
  let outboxRowsCreated = 0;
  for (const recipient of opts.recipients) {
    const result = await dispatchResultPublishedToRecipient(opts, recipient);
    if (result.inboxCreated) inboxRowsCreated += 1;
    if (result.outboxCreated) outboxRowsCreated += 1;
  }
  return {
    recipientsProcessed: opts.recipients.length,
    inboxRowsCreated,
    outboxRowsCreated,
  };
}

/** Options for dispatching one exam_assigned notification. */
export interface DispatchExamAssignedOptions {
  /** Caller's transaction-scoped db handle (the enrollment transaction). */
  db: Database;
  /** Tenant context (organizationId derived from here). */
  ctx: TenantContext;
  /**
   * The enrollment row id created by this assignment (the assignment
   * identity for dedupe keys — see {@link assignmentDedupeKey}).
   */
  enrollmentId: string;
  /** Exam title (server-trusted, escaped at Email render time). */
  examTitle: string;
  /** Authoritative recipient user id (candidate profile → users.id). */
  recipientUserId: string;
  /** Normalized recipient email from users.email, or null (Inbox-only). */
  recipientEmail: string | null;
  /** Public web origin for absolute Email links (from runtime config). */
  publicWebOrigin: string;
  /** Default maxAttempts for outbox rows (from email config). */
  emailMaxAttempts: number;
  /** Authoritative timestamp for this dispatch (from fastify.now()). */
  now: Date;
}

/**
 * Dedupe key for one assignment episode: the enrollment row id.
 *
 * INVARIANT: re-enrolling a candidate after their enrollment was removed is a
 * NEW assignment episode (a new enrollment row) and MUST notify again, so the
 * key cannot be scoped to (exam, recipient). First-assignment idempotency is
 * owned by the enrollment mutation itself — the route's DUPLICATE skip plus
 * the `exam_enrollments (organization_id, exam_id, candidate_id)` unique
 * index; this key is only the DB-level backstop against dispatching the SAME
 * enrollment row twice.
 */
function assignmentDedupeKey(enrollmentId: string): string {
  return `exam_assigned:${enrollmentId}`;
}

/**
 * Dispatches the exam_assigned notification for one newly enrolled
 * candidate (#299, #402 G3).
 *
 * Same atomicity contract as result_published (ADR-011 §17): the REQUIRED
 * Inbox row and the REQUIRED-when-email-exists outbox row are written inside
 * the caller's enrollment transaction — a failed write rolls back the
 * enrollment. SMTP is never called here; the worker drains the outbox.
 *
 * The action path is the candidate exam list (`/exam/list`), the existing
 * authorized surface — the notification does not expose examId on a new
 * per-exam page.
 */
export async function dispatchExamAssigned(
  opts: DispatchExamAssignedOptions,
): Promise<RecipientDispatchResult> {
  const {
    db,
    ctx,
    enrollmentId,
    examTitle,
    publicWebOrigin,
    emailMaxAttempts,
    now,
  } = opts;
  const type = "exam_assigned";
  const recipientUserId = opts.recipientUserId;
  const recipientEmail = opts.recipientEmail;

  if (!requiresInbox(type)) {
    throw new Error(
      `dispatchExamAssigned: type ${type} does not require Inbox — refusing to dispatch`,
    );
  }

  const notificationRepo = createNotificationRepo(db);
  const emailOutboxRepo = createEmailOutboxRepo(db);

  // 1. REQUIRED Inbox row.
  const actionPath = buildExamAssignedActionPath();
  const inboxInsert = await notificationRepo.insert(
    ctx,
    {
      recipientUserId,
      type,
      title: "考试已安排",
      body: `您已被安排参加考试「${examTitle}」，请进入考试列表查看详情。`,
      actionPath,
      dedupeKey: assignmentDedupeKey(enrollmentId),
    },
    now,
  );

  // 2. REQUIRED Email outbox row when the candidate user has an email AND
  //    the Inbox row was newly created (dedupe backstop for retries).
  let outboxCreated = false;
  if (
    inboxInsert.created &&
    recipientEmail != null &&
    emailEnabledForRecipient(type, recipientEmail)
  ) {
    const emailType = resolveEmailTypeForNotification(type);
    if (emailType == null) {
      throw new Error(
        `dispatchExamAssigned: policy enabled Email for ${type} but no EmailType mapping exists`,
      );
    }
    const absoluteLink = buildAbsoluteNotificationLink(
      actionPath,
      publicWebOrigin,
    );
    const rendered = renderExamAssignedEmail({
      examTitle,
      listUrl: absoluteLink,
    });
    // REQUIRED insert (throws on failure → rolls back the enrollment tx).
    await emailOutboxRepo.create(ctx, {
      type: emailType,
      recipientEmail,
      subject: rendered.subject,
      bodyText: rendered.bodyText,
      bodyHtml: rendered.bodyHtml,
      maxAttempts: emailMaxAttempts,
      dedupeKey: assignmentDedupeKey(enrollmentId),
      notificationId: inboxInsert.row.id,
      recipientUserId,
    });
    outboxCreated = true;
  }

  return {
    notification: inboxInsert.row,
    inboxCreated: inboxInsert.created,
    outboxCreated,
  };
}
