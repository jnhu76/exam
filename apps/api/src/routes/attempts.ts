import type { FastifyPluginAsync } from "fastify";
import { registerCandidateAttemptRoutes } from "./attempts.candidate.js";
import { registerAdminAttemptRoutes } from "./attempts.admin.js";

/**
 * Fastify plugin that registers every attempt route. Acts as a registration
 * hub only — candidate runtime routes live in `attempts.candidate.ts` and
 * admin attempt routes (misconduct, force-submit, extend-time) live in
 * `attempts.admin.ts`. Route-layer shared helpers live in `attempts.shared.ts`.
 */
const attemptRoutes: FastifyPluginAsync = async (fastify) => {
  await registerCandidateAttemptRoutes(fastify);
  await registerAdminAttemptRoutes(fastify);
};

export default attemptRoutes;
