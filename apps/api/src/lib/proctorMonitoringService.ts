import type { RequestContext } from "@exam/domain";
import type {
  ProctorAttemptStatus,
  ProctorAttemptEvent,
  OnlineState,
  WarningLevel,
} from "@exam/contracts";
import {
  MONITORING_ONLINE_THRESHOLD_MS,
  MONITORING_OFFLINE_THRESHOLD_MS,
} from "@exam/contracts";
import type { Database } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createClientEventRepo } from "@exam/db/src/repository/clientEventRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import type { ClientEventTimelineRow } from "@exam/db/src/repository/clientEventRepo.js";

/**
 * Proctor monitoring aggregation.
 *
 * Status-type monitoring only: it reads existing data sources (attempts,
 * heartbeat freshness via `lastActivityAt`, client_events, audit_logs) and
 * projects them into non-sensitive monitoring rows. It performs NO invasive
 * collection and draws NO cheating conclusions. `warningLevel` is a status
 * hint computed server-side; the client only displays it.
 *
 * NAMING: "proctor" here is the monitoring DOMAIN, not a standalone role.
 * Phase 2.1 keeps Admin-only access; a formal Proctor role is Phase 3.
 */

/** Event names whose counts feed the monitoring table / warningLevel. */
const COUNTED_EVENT_NAMES = [
  "visibility_lost",
  "browser_offline",
  "answer_autosave_failed",
  "answer_manual_save_failed",
  "submit_failed",
  "deadline_auto_submit_failed",
] as const;

/** Audit-log actions surfaced in the per-attempt timeline (compliance ops). */
const TIMELINE_AUDIT_ACTIONS = new Set([
  "attempt.forceSubmit",
  "attempt.misconductFlagged",
  "attempt.extendTime",
]);

/** Maps an audit action to the timeline event name shown to proctors. */
function auditActionToEventName(action: string): string | null {
  switch (action) {
    case "attempt.forceSubmit":
      return "force_submit";
    case "attempt.misconductFlagged":
      return "mark_misconduct";
    case "attempt.extendTime":
      return "extend_time";
    default:
      return null;
  }
}

const SAVE_ERROR_METADATA = [
  "questionId",
  "saveMode",
  "durationMs",
  "errorCode",
] as const;

/**
 * Per-event-name allowlist for timeline `metadata`. Only the keys listed here
 * are projected from the raw client_events/audit_logs metadata; everything else
 * (answer text, question content, tokens, cookies, unknown keys) is dropped.
 * An entry of `undefined` means "no fields allowed" (empty metadata).
 */
const SAFE_METADATA_ALLOWLIST: Record<string, readonly string[] | undefined> = {
  answer_autosave_failed: SAVE_ERROR_METADATA,
  answer_manual_save_failed: SAVE_ERROR_METADATA,
  submit_failed: ["durationMs", "errorCode"],
  deadline_auto_submit_failed: ["durationMs", "errorCode"],
  visibility_restored: ["durationMs", "hiddenDurationMs"],
  browser_offline: ["durationMs"],
  paste_detected: ["questionId"],
  heartbeat_failed: ["failedCount", "failureCount"],
  heartbeat_restored: ["failedDurationMs", "failedCount"],
  force_submit: [],
  mark_misconduct: [],
  extend_time: ["durationMs"],
};

type SafeMetadataValue = string | number | boolean | null;

/**
 * Projects a raw metadata blob into the allowlisted safe metadata for the
 * given event name. Unknown event names → empty object (default-deny).
 * Exported for unit testing.
 */
export function projectSafeMetadata(
  eventName: string,
  raw: Record<string, unknown> | null | undefined,
): Record<string, SafeMetadataValue> {
  const allowed = SAFE_METADATA_ALLOWLIST[eventName];
  if (!allowed || allowed.length === 0) return {};
  if (!raw) return {};
  const out: Record<string, SafeMetadataValue> = {};
  for (const key of allowed) {
    if (key in raw) {
      const val = raw[key];
      if (
        typeof val === "string" ||
        typeof val === "number" ||
        typeof val === "boolean" ||
        val === null
      ) {
        out[key] = val;
      }
    }
  }
  return out;
}

/**
 * Classifies connectivity from heartbeat freshness. Pure, exported for testing.
 *  - online:  now - lastHeartbeatAt <= ONLINE_THRESHOLD
 *  - stale:   ONLINE_THRESHOLD < ... <= OFFLINE_THRESHOLD
 *  - offline: ... > OFFLINE_THRESHOLD (or no heartbeat)
 */
export function classifyOnlineState(
  lastHeartbeatAt: Date | null,
  now: Date,
): OnlineState {
  if (!lastHeartbeatAt) return "offline";
  const ageMs = now.getTime() - lastHeartbeatAt.getTime();
  if (ageMs <= MONITORING_ONLINE_THRESHOLD_MS) return "online";
  if (ageMs <= MONITORING_OFFLINE_THRESHOLD_MS) return "stale";
  return "offline";
}

/**
 * Computes the status hint. Pure, exported for testing. Never a cheating
 * verdict — only degraded-situation surfacing.
 */
export function computeWarningLevel(input: {
  onlineState: OnlineState;
  saveFailedCount: number;
  submitFailedCount: number;
  visibilityLostCount: number;
  browserOfflineCount: number;
  hasDeadlineAutoSubmitFailed: boolean;
}): WarningLevel {
  const {
    onlineState,
    saveFailedCount,
    submitFailedCount,
    visibilityLostCount,
    browserOfflineCount,
    hasDeadlineAutoSubmitFailed,
  } = input;
  if (
    onlineState === "offline" ||
    submitFailedCount > 0 ||
    saveFailedCount >= 3 ||
    hasDeadlineAutoSubmitFailed
  ) {
    return "critical";
  }
  if (
    onlineState === "stale" ||
    saveFailedCount > 0 ||
    visibilityLostCount > 0 ||
    browserOfflineCount > 0
  ) {
    return "warning";
  }
  return "normal";
}

/**
 * Builds the per-attempt monitoring status list for one exam. Only attempts in
 * an active proctorable state (in_progress / disrupted) are included.
 */
export async function buildProctorAttemptStatuses(
  db: Database,
  ctx: RequestContext,
  examId: string,
  now: Date = new Date(),
): Promise<ProctorAttemptStatus[]> {
  const attemptRepo = createAttemptRepo(db);
  const eventRepo = createClientEventRepo(db);

  const allRows = await attemptRepo.listByExam(ctx, examId);
  const activeRows = allRows.filter((r) =>
    ["in_progress", "disrupted"].includes(r.attempt.status),
  );
  if (activeRows.length === 0) return [];

  const counts = await eventRepo.countByNamesForExam(ctx, examId, [
    ...COUNTED_EVENT_NAMES,
  ]);
  const lastEventByAttempt = await eventRepo.lastReceivedAtForExam(ctx, examId);

  return activeRows.map((row) => {
    const attemptId = row.attempt.id;
    const perAttempt = counts.get(attemptId);
    const visibilityLostCount = perAttempt?.get("visibility_lost") ?? 0;
    const browserOfflineCount = perAttempt?.get("browser_offline") ?? 0;
    const saveFailedCount =
      (perAttempt?.get("answer_autosave_failed") ?? 0) +
      (perAttempt?.get("answer_manual_save_failed") ?? 0);
    const submitFailedCount = perAttempt?.get("submit_failed") ?? 0;

    const lastHeartbeatAt = row.attempt.lastActivityAt ?? null;
    const onlineState = classifyOnlineState(lastHeartbeatAt, now);
    // lastSaveAt: server-side fact from the attempt's activity timestamp
    // (the Answer Save Protocol updates lastActivityAt on every accepted save).
    // Never derived from client_events.
    const lastSaveAt = row.attempt.lastActivityAt ?? null;
    const lastClientEventAt = lastEventByAttempt.get(attemptId) ?? null;
    const hasDeadlineAutoSubmitFailed =
      (perAttempt?.get("deadline_auto_submit_failed") ?? 0) > 0;

    const warningLevel = computeWarningLevel({
      onlineState,
      saveFailedCount,
      submitFailedCount,
      visibilityLostCount,
      browserOfflineCount,
      hasDeadlineAutoSubmitFailed,
    });

    return {
      attemptId,
      candidateId: row.attempt.candidateId,
      candidateName: row.candidateUser?.name ?? "-",
      status: row.attempt.status as ProctorAttemptStatus["status"],
      onlineState,
      lastHeartbeatAt: lastHeartbeatAt?.toISOString() ?? null,
      lastSaveAt: lastSaveAt?.toISOString() ?? null,
      lastClientEventAt: lastClientEventAt?.toISOString() ?? null,
      visibilityLostCount,
      browserOfflineCount,
      saveFailedCount,
      submitFailedCount,
      warningLevel,
    } satisfies ProctorAttemptStatus;
  });
}

/**
 * Builds the merged event timeline (client_events + audit_logs) for one
 * attempt, newest first. Each row carries ONLY allowlisted metadata — the raw
 * client_events.metadata blob is never returned.
 */
export async function buildProctorAttemptEventTimeline(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
  opts: { limit: number; page: number },
): Promise<{ items: ProctorAttemptEvent[]; total: number }> {
  const limit = Math.max(1, Math.min(opts.limit, 100));
  const page = Math.max(1, opts.page);
  const offset = (page - 1) * limit;
  const eventRepo = createClientEventRepo(db);
  const auditRepo = createAuditLogRepo(db);

  // Fetch client events (already newest-first) and the most recent audit rows for this attempt
  const clientRows: ClientEventTimelineRow[] =
    await eventRepo.listRecentByAttempt(ctx, attemptId, { limit });
  // Get all matching audit logs but limit to the same number of items we return to avoid over-fetching
  const { items: auditRows } = await auditRepo.listPaginatedFiltered(
    ctx,
    1,
    limit,
    {
      targetType: "attempt",
      targetId: attemptId,
    },
  );

  const merged: ProctorAttemptEvent[] = [];

  for (const r of clientRows) {
    merged.push({
      id: r.id,
      occurredAt: r.occurredAt.toISOString(),
      name: r.name,
      level: r.level as ProctorAttemptEvent["level"],
      kind: r.kind as ProctorAttemptEvent["kind"],
      metadata: projectSafeMetadata(r.name, r.metadata),
      ...(r.route ? { route: r.route } : {}),
      source: "client_event",
    });
  }

  for (const a of auditRows) {
    const name = auditActionToEventName(a.action);
    if (!name) continue; // not a timeline-relevant audit action
    merged.push({
      id: a.id,
      occurredAt: a.createdAt.toISOString(),
      name,
      level: "warn",
      kind: "proctor",
      metadata: projectSafeMetadata(name, a.metadata),
      source: "audit_log",
    });
  }

  // Newest first, then apply pagination.
  merged.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const items = merged.slice(offset, offset + limit);
  return { items, total: merged.length };
}
