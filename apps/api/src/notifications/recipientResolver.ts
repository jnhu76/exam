import type { Exam, ExamAttempt } from "@exam/domain";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { computeResultVisibility } from "../routes/scores.js";

// P5-N1-I2 Slice 5 — recipient composition for result_published fan-out.
//
// Authority: P5-N1-R0 §10 (frozen composition rule).
//
// For a manual publish of exam E, a recipient is every Candidate enrolled in E
// whose score-strategy-selected authoritative attempt (enrollment.finalAttemptId)
// is "result-ready" (computeResultVisibility(exam, attempt, "own").visible).
// This composes existing primitives only — no new scoring authority is invented.
// computeResultVisibility is the same function the result page uses, so the
// notification never links to a hidden result.

/** A resolved result_published recipient. */
export interface ResultPublishedRecipient {
  /** The user that will receive the Inbox notification (and Email if email set). */
  userId: string;
  /** Normalized recipient email from users.email, or null (Inbox-only). */
  email: string | null;
  /** The candidateProfile id backing this enrollment (for audit linkage). */
  candidateId: string;
  /**
   * The score-strategy-selected authoritative attempt id. The notification's
   * actionPath navigates here (/exam/:attemptId/result).
   */
  attemptId: string;
}

/**
 * Resolves the result_published recipient set for a manual publish of `exam`.
 *
 * Composition (§10.3):
 *   1. enrollmentRepo.listByExam(ctx, exam.id) — one query, all enrollments
 *   2. for each enrollment: skip if finalAttemptId is null
 *   3. batch-load the authoritative attempts (avoid N+1)
 *   4. compose with computeResultVisibility(exam, attempt, "own"); skip if hidden
 *   5. resolve recipientUserId via candidateProfile.userId, email via users.email
 *
 * The caller passes the SAME transaction-scoped db handle that the publication
 * mutation runs in, so the recipient set is read on the same snapshot as the
 * resultsPublishedAt flip — no cross-snapshot race.
 *
 * Returns at most one recipient per enrollment (the score-strategy-selected
 * authoritative attempt). Order is stable by enrollment query order.
 */
export async function resolveResultPublishedRecipients(
  db: Database,
  ctx: TenantContext,
  exam: Exam,
): Promise<ResultPublishedRecipient[]> {
  const enrollmentRepo = createEnrollmentRepo(db);
  const attemptRepo = createAttemptRepo(db);
  const candidateRepo = createCandidateRepo(db);
  const userRepo = createUserRepo(db);

  const enrollments = await enrollmentRepo.listByExam(ctx, exam.id);

  // Step 1: filter to enrollments with an authoritative attempt id.
  const withAttempt = enrollments.filter((e) => e.finalAttemptId != null);
  if (withAttempt.length === 0) return [];

  // Step 2: batch-load the authoritative attempts in ONE query (avoid N+1).
  const attemptIds = withAttempt.map((e) => e.finalAttemptId!);
  const attempts = await attemptRepo.findByIds(ctx, attemptIds);
  const attemptById = new Map<string, ExamAttempt>();
  for (const a of attempts) {
    attemptById.set(a.id, a as unknown as ExamAttempt);
  }

  // Step 3: compose with computeResultVisibility; keep only visible results.
  // Track which candidateProfile each surviving attempt belongs to.
  const surviving: { candidateId: string; attempt: ExamAttempt }[] = [];
  for (const e of withAttempt) {
    const attempt = attemptById.get(e.finalAttemptId!);
    if (!attempt) continue; // race: attempt gone since enrollment wrote it
    const visibility = computeResultVisibility(exam, attempt, "own");
    if (!visibility.visible) continue;
    surviving.push({ candidateId: e.candidateId, attempt });
  }
  if (surviving.length === 0) return [];

  // Step 4: resolve candidateProfile -> user (batched) then user -> email.
  const candidateIds = surviving.map((s) => s.candidateId);
  const profiles = await candidateRepo.findByIds(ctx, candidateIds);
  const profileByCandidate = new Map<string, { userId: string }>();
  for (const p of profiles) {
    profileByCandidate.set(p.id, { userId: p.userId });
  }
  const userIds = [
    ...new Set([...profileByCandidate.values()].map((p) => p.userId)),
  ];
  const users = await userRepo.findByIds(ctx, userIds);
  const emailByUser = new Map<string, string | null>();
  for (const u of users) {
    emailByUser.set(u.id, u.email ?? null);
  }

  // Step 5: assemble recipients in stable enrollment order.
  const recipients: ResultPublishedRecipient[] = [];
  for (const s of surviving) {
    const profile = profileByCandidate.get(s.candidateId);
    if (!profile) continue; // race: profile gone
    recipients.push({
      userId: profile.userId,
      email: emailByUser.get(profile.userId) ?? null,
      candidateId: s.candidateId,
      attemptId: s.attempt.id,
    });
  }
  return recipients;
}
