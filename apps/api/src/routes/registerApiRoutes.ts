import type { FastifyInstance } from "fastify";

import authRoutes from "./auth.js";
import settingsRoutes from "./settings.js";
import candidateFieldRoutes from "./candidateField.js";
import userRoutes from "./user.js";
import roleAssignmentRoutes from "./roleAssignments.js";
import candidateRoutes from "./candidate.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import scoreRoutes from "./scores.js";
import { exportRoutes } from "./export.js";
import systemRoutes from "./system.js";
import auditRoutes from "./audit.js";
import importLogRoutes from "./importLogs.js";
import clientEventRoutes from "./clientEvents.js";
import proctorMonitoringRoutes from "./proctorMonitoring.js";
import { emailRoutes } from "./email.js";
import notificationRoutes from "./notifications.js";
import { adminIncidentRoutes } from "./incidents.admin.js";
import { adminProctorAssignmentRoutes } from "./proctorAssignments.admin.js";

/**
 * Registers all API route modules on a Fastify instance.
 *
 * Shared between the runtime server and the swagger/spec-generation app
 * so route coverage stays in sync. Each route plugin handles its own
 * authentication, validation, and response schemas.
 *
 * @param app - Fastify instance to register routes on.
 * @param opts.prefix - Route prefix (default "/api").
 */
export async function registerApiRoutes(
  app: FastifyInstance,
  opts: { prefix?: string } = {},
): Promise<void> {
  const prefix = opts.prefix ?? "/api";

  await app.register(authRoutes, { prefix: `${prefix}/auth` });
  await app.register(settingsRoutes, { prefix });
  await app.register(candidateFieldRoutes, { prefix });
  await app.register(userRoutes, { prefix });
  await app.register(roleAssignmentRoutes, { prefix });
  await app.register(candidateRoutes, { prefix });
  await app.register(courseRoutes, { prefix });
  await app.register(questionRoutes, { prefix });
  await app.register(examRoutes, { prefix });
  await app.register(attemptRoutes, { prefix });
  await app.register(scoreRoutes, { prefix });
  await app.register(exportRoutes, { prefix });
  await app.register(systemRoutes, { prefix });
  await app.register(auditRoutes, { prefix });
  await app.register(importLogRoutes, { prefix });
  await app.register(clientEventRoutes, { prefix });
  await app.register(proctorMonitoringRoutes, { prefix });
  await app.register(emailRoutes, { prefix });
  await app.register(notificationRoutes, { prefix });
  await app.register(adminIncidentRoutes, { prefix });
  await app.register(adminProctorAssignmentRoutes, { prefix });
}
