import { z } from "zod";
import { PaginatedResponseSchema } from "./common.js";
import { AttemptStatusEnum, type AttemptStatusValue } from "./attempt.js";

/**
 * Contracts for the proctor monitoring dashboard (status-type monitoring only).
 *
 * IMPORTANT: these types carry NO invasive signals — no camera, screen, mic,
 * keystroke, clipboard, or cheating-detection data. `warningLevel` is a status
 * hint derived from observable flow events (heartbeat freshness, save/submit
 * failures, connectivity), never a risk-control verdict. Timeline `metadata`
 * is a server-projected **allowlist** projection — never the raw client blob.
 *
 * NAMING NOTE: "proctor" here denotes the monitoring DOMAIN, not a standalone
 * role. Phase 1/2.1 has only Admin + Candidate; these APIs are Admin-gated.
 * A formal Proctor role, proctor_assignments, and scoped RBAC arrive in
 * Phase 3. The name is retained so the domain vocabulary is stable.
 */

/**
 * Centralized heartbeat-freshness thresholds for the online/stale/offline
 * classification. Kept in one place (and exported) so the API service, tests,
 * and any future heartbeat scanner agree on the same cutoffs — avoiding a
 * second, conflicting presence source.
 */
export const MONITORING_ONLINE_THRESHOLD_MS = 30_000;
export const MONITORING_OFFLINE_THRESHOLD_MS = 90_000;

export const ProctorAttemptStatusEnum = AttemptStatusEnum;
export type ProctorAttemptStatusValue = AttemptStatusValue;

export const ProctorExamStatusEnum = z.enum(["published", "open", "closed"]);
export type ProctorExamStatus = z.infer<typeof ProctorExamStatusEnum>;

export const ProctorExamListItemSchema = z
  .object({
    examId: z.string().uuid(),
    title: z.string().min(1),
    status: ProctorExamStatusEnum,
    openAt: z.string().datetime(),
    closeAt: z.string().datetime(),
  })
  .strict();
export type ProctorExamListItem = z.infer<typeof ProctorExamListItemSchema>;

export const ProctorExamListResponseSchema = z
  .object({
    items: z.array(ProctorExamListItemSchema),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type ProctorExamListResponse = z.infer<
  typeof ProctorExamListResponseSchema
>;

/** Connectivity classification derived from heartbeat freshness (server-computed). */
export const OnlineStateEnum = z.enum(["online", "stale", "offline"]);
export type OnlineState = z.infer<typeof OnlineStateEnum>;

/**
 * Status hint for the proctor view. `critical`/`warning` surface degraded
 * situations (offline, repeated failures); `normal` means healthy. This is a
 * monitoring signal, NOT a cheating verdict — there is no `cheating_*` level.
 */
export const WarningLevelEnum = z.enum(["normal", "warning", "critical"]);
export type WarningLevel = z.infer<typeof WarningLevelEnum>;

/**
 * Per-attempt live monitoring row for the proctor table. All counts are
 * non-negative integers derived from `client_events` for this attempt.
 */
export const ProctorAttemptStatusSchema = z.object({
  attemptId: z.string().uuid(),
  candidateId: z.string().uuid(),
  candidateName: z.string(),
  status: ProctorAttemptStatusEnum,
  onlineState: OnlineStateEnum,
  lastHeartbeatAt: z.string().datetime().nullable(),
  lastSaveAt: z.string().datetime().nullable(),
  lastClientEventAt: z.string().datetime().nullable(),
  visibilityLostCount: z.number().int().nonnegative(),
  browserOfflineCount: z.number().int().nonnegative(),
  saveFailedCount: z.number().int().nonnegative(),
  submitFailedCount: z.number().int().nonnegative(),
  warningLevel: WarningLevelEnum,
});
export type ProctorAttemptStatus = z.infer<typeof ProctorAttemptStatusSchema>;

/** Response for the per-exam attempt monitoring list. */
export const ProctorAttemptListResponseSchema = z.object({
  items: z.array(ProctorAttemptStatusSchema),
  total: z.number().int().nonnegative(),
});
export type ProctorAttemptListResponse = z.infer<
  typeof ProctorAttemptListResponseSchema
>;

/**
 * One event in the per-attempt timeline. `metadata` is NOT the raw
 * `client_events.metadata` blob — it is a server-projected, **allowlisted**
 * projection that carries only non-sensitive structural fields (questionId,
 * durationMs, errorCode, counts, etc.). Answer text, question content, tokens,
 * cookies, and any unknown keys are dropped before this object is built. The
 * same shape is used for audit-log-derived timeline rows (force_submit /
 * mark_misconduct / extend_time), with their own allowlisted projection.
 */
export const ProctorAttemptEventSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string().datetime(),
  name: z.string().min(1).max(120),
  level: z.enum(["debug", "info", "warn", "error"]),
  kind: z.enum(["log", "exam_telemetry", "proctor"]),
  /** Server-projected, allowlisted metadata (never the raw client blob). */
  metadata: z.record(
    z.string(),
    z.string().or(z.number()).or(z.boolean()).or(z.null()),
  ),
  route: z.string().min(1).max(500).optional(),
  /** Origin of the timeline row: frontend telemetry vs. compliance audit log. */
  source: z.enum(["client_event", "audit_log"]),
});
export type ProctorAttemptEvent = z.infer<typeof ProctorAttemptEventSchema>;

/** Paginated response of timeline events for one attempt. */
export const ProctorAttemptEventListResponseSchema = PaginatedResponseSchema(
  ProctorAttemptEventSchema,
);
export type ProctorAttemptEventListResponse = z.infer<
  typeof ProctorAttemptEventListResponseSchema
>;
