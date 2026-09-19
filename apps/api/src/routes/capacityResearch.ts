import type { FastifyInstance } from "fastify";
import { Permission } from "@exam/authz";
import {
  getCapacityResearchSnapshot,
  isCapacityResearchEnabled,
} from "../lib/capacityResearch.js";

/**
 * RESEARCH-ONLY capacity snapshot route for the #550 evidence campaign.
 *
 * Registered ONLY when CAPACITY_RESEARCH=1 (see registerApiRouteModules);
 * on any normal deployment this module never mounts and the endpoint does
 * not exist. It is capability-gated like the other system diagnostics so the
 * research rig never weakens the permission model.
 */
export function registerCapacityResearchRoutes(api: FastifyInstance): void {
  if (!isCapacityResearchEnabled()) return;

  api.get("/research/capacity", {
    config: { rateLimit: false },
    preHandler: [
      api.authenticate,
      api.requireCapability(Permission.SystemDiagnosticsView),
    ],
    // The snapshot shape is a research diagnostic bag (arbitrary JSON); the
    // zod type-provider rejects raw JSON-Schema response declarations, so no
    // response schema is declared.
    handler: async () => getCapacityResearchSnapshot(),
  });
}
