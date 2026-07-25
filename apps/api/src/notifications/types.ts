// P5-N1-I2 — API-local interfaces for the NotificationService.
//
// These are the inputs the publication fan-out hands to the channel-neutral
// NotificationService. The service composes the Inbox repo + Email outbox
// repo inside the caller's transaction; SMTP is NOT called here.

/**
 * Trusted identifiers + display data for a single result_published recipient.
 *
 * The publication fan-out builds this from the resolved recipient set
 * (recipientResolver.ts) plus the exam's display title. It contains NO
 * arbitrary Email content — the Email body is rendered by the
 * grade_notification renderer from `examTitle` + `actionPath`.
 */
export interface ResultPublishedNotificationInput {
  organizationId: string;
  recipientUserId: string;
  /** Normalized recipient email from users.email, or null (Inbox-only). */
  recipientEmail: string | null;
  examId: string;
  attemptId: string;
  /** Server-trusted exam title (HTML-escaped at Email render time). */
  examTitle: string;
}
