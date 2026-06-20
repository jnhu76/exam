import type { RequestContext } from "@exam/domain";
import type { CandidateStatusItem } from "@exam/contracts";
import type { Database } from "@exam/db/src/types.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";

type AttemptRow = Awaited<
  ReturnType<ReturnType<typeof createAttemptRepo>["listByExam"]>
>[number]["attempt"];

/**
 * Builds the per-candidate live status list for the proctor dashboard (P2C-J5).
 * Encapsulates the multi-repo aggregation so the route handler stays thin:
 * fetches enrollments → resolves candidate names → maps the latest attempt per
 * candidate → shapes each row into a CandidateStatusItem.
 */
export async function buildCandidateStatusItems(
  db: Database,
  ctx: RequestContext,
  examId: string,
): Promise<CandidateStatusItem[]> {
  const enrollmentRepo = createEnrollmentRepo(db);
  const candidateRepo = createCandidateRepo(db);
  const userRepo = createUserRepo(db);
  const attemptRepo = createAttemptRepo(db);

  const enrollments = (await enrollmentRepo.list(ctx)).filter(
    (e) => e.examId === examId,
  );

  const allAttempts = await attemptRepo.listByExam(ctx, examId);
  const latestAttemptByCandidate = new Map<string, AttemptRow>();
  for (const row of allAttempts) {
    const existing = latestAttemptByCandidate.get(row.attempt.candidateId);
    if (!existing || row.attempt.createdAt > existing.createdAt) {
      latestAttemptByCandidate.set(row.attempt.candidateId, row.attempt);
    }
  }

  return Promise.all(
    enrollments.map(async (enrollment) => {
      const candidate = await candidateRepo.findById(
        ctx,
        enrollment.candidateId,
      );
      const user = candidate
        ? await userRepo.findById(ctx, candidate.userId)
        : null;
      const attempt = latestAttemptByCandidate.get(enrollment.candidateId);

      return {
        candidateId: enrollment.candidateId,
        name: user?.name ?? "-",
        attemptId: attempt?.id ?? null,
        status: (attempt?.status ??
          "not_started") as CandidateStatusItem["status"],
        deadlineAt: attempt?.deadlineAt?.toISOString() ?? null,
        lastActivityAt: attempt?.lastActivityAt?.toISOString() ?? null,
        misconduct: attempt?.misconduct
          ? {
              ...attempt.misconduct,
              flaggedAt: new Date(attempt.misconduct.flaggedAt).toISOString(),
            }
          : null,
      };
    }),
  );
}
