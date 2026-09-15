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
  ProctorAttemptStatusEnum,
  ProctorAttemptEventSchema,
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
 * TRUST (INVARIANT, #544): `warningLevel` and the per-attempt counts feeding
 * it are ADVISORY attention signals derived partly or wholly from
 * client-asserted telemetry (the client chooses what to emit and claims its
 * own references). They are never an incident/violation/punishment/score
 * authority; any future incident or security consumer (#317) MUST
 * server-side revalidate before acting on them. `kind: "proctor"` on a
 * timeline row is a display label sourced from client events or audit logs —
 * provenance lives in `source`, not in `kind`.
 *
 * NAMING: "proctor" here is the monitoring DOMAIN, not a standalone role.
 * Phase 2.1 keeps Admin-only access; a formal Proctor role is Phase 3.
 */

/**
 * Parses a raw attempt-status string from the DB into the closed enum, falling
 * back to `"in_progress"` for any stray value. Avoids a silent `as` cast that
 * could hide a corrupted/unknown status.
 */
function parseAttemptStatus(raw: string): ProctorAttemptStatus["status"] {
  const parsed = ProctorAttemptStatusEnum.safeParse(raw);
  return parsed.success ? parsed.data : "in_progress";
}

/**
 * Builds one timeline row from a raw client_event row, validating the
 * `level`/`kind` strings against the ProctorAttemptEventSchema instead of
 * `as`-casting them. Unknown values fall back to safe defaults.
 */
function toTimelineEventFromClient(
  r: ClientEventTimelineRow,
): ProctorAttemptEvent {
  // Validate the full event shape; override the validated/derived fields below.
  const base = ProctorAttemptEventSchema.safeParse({
    id: r.id,
    occurredAt: r.occurredAt.toISOString(),
    name: r.name,
    level: r.level,
    kind: r.kind,
    metadata: projectSafeMetadata(r.name, r.metadata),
    ...(r.route ? { route: r.route } : {}),
    source: "client_event",
  });
  if (base.success) return base.data;
  // Fallback for a stray level/kind: coerce to safe values.
  const level: ProctorAttemptEvent["level"] =
    r.level === "error" || r.level === "warn" || r.level === "debug"
      ? r.level
      : "info";
  const kind: ProctorAttemptEvent["kind"] =
    r.kind === "proctor" || r.kind === "log" ? r.kind : "exam_telemetry";
  return {
    id: r.id,
    occurredAt: r.occurredAt.toISOString(),
    name: r.name,
    level,
    kind,
    metadata: projectSafeMetadata(r.name, r.metadata),
    ...(r.route ? { route: r.route } : {}),
    source: "client_event",
  };
}

/** Event names whose counts feed the monitoring table / warningLevel. */
const COUNTED_EVENT_NAMES = [
  "visibility_lost",
  "browser_offline",
  "answer_autosave_failed",
  "answer_manual_save_failed",
  "submit_failed",
  "deadline_auto_submit_failed",
] as const;

/**
 * Audit-log actions surfaced in the per-attempt timeline (compliance ops).
 * attempt.extendTime is retained for historical rows (the route was cut in
 * REC-I4-I3B2); new grants emit attempt.timeGrant.
 */
const TIMELINE_AUDIT_ACTIONS = new Set([
  "attempt.forceSubmit",
  "attempt.misconductFlagged",
  "attempt.extendTime",
  "attempt.timeGrant",
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
    case "attempt.timeGrant":
      return "grant_time";
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
 *
 * `grant_time` is the operator time-grant event (REC-I4-I3B2). It is in this
 * allowlist — the keys projected are correlation ids (adjustmentId /
 * operationId) plus the magnitude/reason (addedSeconds / reasonCode) that
 * proctors need to understand a grant in the timeline.
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
  grant_time: ["addedSeconds", "reasonCode", "adjustmentId"],
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
 *
 * ADVISORY ONLY (#544): the inputs (save/submit/visibility/browser-offline
 * counts, heartbeat freshness) come from client-asserted client_events or
 * coarse activity freshness. This function must stay a display hint; it must
 * not be promoted into an incident/punishment authority without server-side
 * revalidation of the underlying facts.
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
      status: parseAttemptStatus(row.attempt.status),
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
 *
 * INVARIANT (#544): ordering authority is the server-owned receive instant
 * (`client_events.receivedAt` / `audit_logs.createdAt`) with the row id as
 * the deterministic tiebreaker. The client-asserted `occurredAt` is displayed
 * but never decides order, pagination membership, or head/tail position — a
 * malicious client cannot relocate its events with `occurredAt` extremes.
 */
export async function buildProctorAttemptEventTimeline(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
  opts: { limit: number; page: number },
): Promise<{
  items: ProctorAttemptEvent[];
  total: number;
  totalPages: number;
}> {
  // External page-size contract (the route schema bounds limit to 100),
  // re-clamped here as defense in depth. The INTERNAL prefix fetch below is
  // a different bound and must not inherit this clamp.
  const limit = Math.max(1, Math.min(opts.limit, 100));
  const page = Math.max(1, opts.page);
  const offset = (page - 1) * limit;
  const eventRepo = createClientEventRepo(db);
  const auditRepo = createAuditLogRepo(db);

  // True totals via SQL COUNT. Repo invariant: the count admission predicate
  // and the prefix-list admission predicate are semantically identical — a
  // row is counted exactly when it can be listed.
  const clientTotal = await eventRepo.countByAttempt(ctx, attemptId);
  const auditTimelineTotal = await auditRepo.countFilteredByActions(
    ctx,
    { targetType: "attempt", targetId: attemptId },
    [...TIMELINE_AUDIT_ACTIONS],
  );
  const total = clientTotal + auditTimelineTotal;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  // Pages starting past the end hold no rows — skip the prefix queries.
  if (offset >= total) {
    return { items: [], total, totalPages };
  }

  // K-way prefix lemma: a row at global position p sits within the top-p
  // ADMITTED rows of its own source (admission removes rows, never reorders).
  // Fetching the top-min(offset+limit, total) admitted rows per source —
  // exactly one query per source — covers the page fully: irrelevant rows
  // cannot crowd admitted rows out of a window (admission precedes LIMIT in
  // SQL), and no source can hide rows behind the external page-size clamp.
  const prefixSize = Math.min(offset + limit, total);
  const clientRows: ClientEventTimelineRow[] =
    await eventRepo.listTimelinePrefixByAttempt(ctx, attemptId, prefixSize);
  const auditRows = await auditRepo.listTimelinePrefixByActions(
    ctx,
    { targetType: "attempt", targetId: attemptId },
    [...TIMELINE_AUDIT_ACTIONS],
    prefixSize,
  );

  // Server-owned instant per merged row: client events order by receivedAt,
  // audit rows by their createdAt. Never the client-asserted occurredAt.
  const merged: Array<{ key: number; id: string; event: ProctorAttemptEvent }> =
    [];

  for (const r of clientRows) {
    merged.push({
      key: r.receivedAt.getTime(),
      id: r.id,
      event: toTimelineEventFromClient(r),
    });
  }

  for (const a of auditRows) {
    const name = auditActionToEventName(a.auditLog.action);
    if (!name) continue; // not a timeline-relevant audit action
    merged.push({
      key: a.auditLog.createdAt.getTime(),
      id: a.auditLog.id,
      event: {
        id: a.auditLog.id,
        occurredAt: a.auditLog.createdAt.toISOString(),
        name,
        level: "warn",
        kind: "proctor",
        metadata: projectSafeMetadata(name, a.auditLog.metadata),
        source: "audit_log",
      },
    });
  }

  // Newest first (server instant), then deterministic id tiebreaker (DESC,
  // matching the DB ORDER BY convention — per-source rows and the merged
  // order must agree at same-instant ties); apply pagination.
  merged.sort(
    (x, y) => y.key - x.key || (y.id > x.id ? 1 : y.id < x.id ? -1 : 0),
  );
  const items = merged.map((m) => m.event).slice(offset, offset + limit);
  return { items, total, totalPages };
}
