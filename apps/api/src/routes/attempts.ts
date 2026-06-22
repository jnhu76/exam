import type { FastifyPluginAsync } from "fastify";
import { registerCandidateAttemptRoutes } from "./attempts.candidate.js";
import { registerAdminAttemptRoutes } from "./attempts.admin.js";
import { registerGradingQueueRoutes } from "./gradingQueue.js";

/**
 * Fastify plugin that registers every attempt route. Acts as a registration
 * hub only — candidate runtime routes live in `attempts.candidate.ts` and
 * admin attempt routes (misconduct, force-submit, extend-time) live in
 * `attempts.admin.ts`. Manual-grading queue routes (P2D-J3) live in
 * `gradingQueue.ts`. Route-layer shared helpers live in `attempts.shared.ts`.
 */
const attemptRoutes: FastifyPluginAsync = async (fastify) => {
  await registerCandidateAttemptRoutes(fastify);
  await registerAdminAttemptRoutes(fastify);
  await registerGradingQueueRoutes(fastify);
};

export default attemptRoutes;
