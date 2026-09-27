import type { RequestContext } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import type { DemoSeedGrader } from "@exam/db/src/demo-seed.js";
import { submitAndGradeAttempt } from "./orchestrators/submitAndGradeAttempt.js";

/**
 * Binds the demo seed's graded attempts to the PRODUCTION submit+grade
 * composition (`submitAndGradeAttempt` — the same orchestrator the candidate
 * submit route and the deadline scanner use: EA lock, deadline
 * reconciliation, submit freeze, durable workset materialization, terminal
 * aggregation, enrollment projection, all in one transaction).
 *
 * EXSEM-020: demo "valid data" must satisfy the same freeze and grading
 * completeness as production attempts, so the seed must not fabricate
 * terminal grading projections beside a missing workset. No audit rows are
 * written (`audit` is omitted — the seed is not an HTTP request).
 */
export function createDemoSeedGrader(db: Database): DemoSeedGrader {
  return {
    async submitAndGrade({
      attemptId,
      candidateProfileId,
      organizationId,
      now,
    }): Promise<void> {
      const ctx: RequestContext = {
        actorId: "demo-seed",
        organizationId,
        role: "Admin",
        permissions: [],
        sessionId: "demo-seed",
      };
      await submitAndGradeAttempt(db, ctx, attemptId, candidateProfileId, now);
    },
  };
}
