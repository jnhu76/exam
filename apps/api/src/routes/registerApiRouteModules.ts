import type { FastifyInstance } from "fastify";

import authRoutes from "./auth.js";
import launchpadRoutes from "./launchpad.js";
import settingsRoutes from "./settings.js";
import candidateFieldRoutes from "./candidateField.js";
import invitationRoutes from "./invitation.js";
import userRoutes from "./user.js";
import roleAssignmentRoutes from "./roleAssignments.js";
import candidateRoutes from "./candidate.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import examRoutes from "./exam.js";
import examProfileRoutes from "./examProfile.js";
import attemptRoutes from "./attempts.js";
import scoreRoutes from "./scores.js";
import { exportRoutes } from "./export.js";
import systemRoutes from "./system.js";
import auditRoutes from "./audit.js";
import { permissionRegistryRoutes } from "./permissionRegistry.js";
import importLogRoutes from "./importLogs.js";
import clientEventRoutes from "./clientEvents.js";
import proctorMonitoringRoutes from "./proctorMonitoring.js";
import { emailRoutes } from "./email.js";
import notificationRoutes from "./notifications.js";
import { adminIncidentRoutes } from "./incidents.admin.js";
import { adminProctorAssignmentRoutes } from "./proctorAssignments.admin.js";
import { adminTeacherAssignmentRoutes } from "./teacherAssignments.admin.js";
import { adminGraderAssignmentRoutes } from "./graderAssignments.admin.js";

/**
 * Registers every API route module inside an existing /api scope.
 *
 * This function owns MODULE COMPOSITION ONLY. Paths are relative to the
 * enclosing scope's prefix — the API surface registers this inside a
 * `{ prefix: "/api" }` plugin — so no module carries a second "/api" prefix
 * authority. The one exception is the auth module's own `/auth` grouping
 * prefix. Adding a new module here is enough for it to inherit the /api
 * prefix, the canonical unmatched-request boundary, and all root
 * infrastructure.
 *
 * @param api - Fastify instance already inside the /api scope.
 */
export async function registerApiRouteModules(
  api: FastifyInstance,
): Promise<void> {
  await api.register(authRoutes, { prefix: "/auth" });
  await api.register(launchpadRoutes);
  await api.register(settingsRoutes);
  await api.register(candidateFieldRoutes);
  await api.register(invitationRoutes);
  await api.register(userRoutes);
  await api.register(roleAssignmentRoutes);
  await api.register(candidateRoutes);
  await api.register(courseRoutes);
  await api.register(questionRoutes);
  await api.register(examRoutes);
  await api.register(examProfileRoutes);
  await api.register(attemptRoutes);
  await api.register(scoreRoutes);
  await api.register(exportRoutes);
  await api.register(systemRoutes);
  await api.register(auditRoutes);
  await api.register(permissionRegistryRoutes);
  await api.register(importLogRoutes);
  await api.register(clientEventRoutes);
  await api.register(proctorMonitoringRoutes);
  await api.register(emailRoutes);
  await api.register(notificationRoutes);
  await api.register(adminIncidentRoutes);
  await api.register(adminProctorAssignmentRoutes);
  await api.register(adminTeacherAssignmentRoutes);
  await api.register(adminGraderAssignmentRoutes);
}
