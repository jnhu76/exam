import { z } from "zod";
import { NOTIFICATION_TYPES } from "@exam/domain";
import { PaginationParamsSchema, PaginatedResponseSchema } from "./common.js";

// P5-N1 — Notification Inbox contracts (V1: result_published only).
//
// Authority: P5-N1-R0 §19 (frozen V1 API contract). Pagination REUSES the
// repo's offset/page convention (PaginationParamsSchema), NOT an opaque
// base64url cursor. Clients never pass organizationId or recipientUserId;
// scope derives from authenticated context.

/**
 * Zod enum for the V1 NotificationType values. Derived from the domain
 * constant `NOTIFICATION_TYPES` (`@exam/domain`) so the contract layer
 * validates API payloads against the single source of truth.
 */
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);

/** V1 NotificationType (mirror of the domain union). */
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/**
 * Regex matching the V1 result-published action path:
 *   /exam/<attemptId>/result
 *
 * `<attemptId>` is restricted to URL-safe identifier characters
 * `[A-Za-z0-9_-]+` (UUIDs and any future id scheme that stays within that
 * class). This is the single source of truth shared by the trusted builder,
 * the write-time validator, and the render-time revalidator
 * (P5-N1-R0 §16.3 — frozen).
 *
 * Anchored with ^...$ so a trailing segment, traversal, or control character
 * cannot slip past.
 */
export const NOTIFICATION_ACTION_PATH_PATTERN =
  /^\/exam\/[A-Za-z0-9_-]+\/result$/;

/**
 * Returns true iff `path` is a canonical V1 result-published action path.
 *
 * Used at write time (asserting the trusted builder's output) and at render
 * time (re-validating before combining with PUBLIC_WEB_ORIGIN). Rejects
 * external URLs, protocol-relative URLs, dot-dot traversal, percent-encoded
 * traversal, backslashes, control characters, and unknown route prefixes.
 */
export function isResultPublishedActionPath(path: string): boolean {
  if (typeof path !== "string") return false;
  // Fast reject: contains chars that can never appear in a canonical path.
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return false;
  if (path.includes("..")) return false;
  // Percent-encoded traversal: %2e is '.', %2f is '/', %5c is '\\'.
  if (/%2e|%2f|%5c/i.test(path)) return false;
  return NOTIFICATION_ACTION_PATH_PATTERN.test(path);
}

/**
 * Schema for a single notification row as exposed over the Inbox API.
 *
 * `actionPath` is NOT NULL in V1: every result_published notification
 * navigates to the authoritative result page. Future informational types
 * that lack a navigation target must introduce an explicit contract change.
 * `readAt` is null while unread and set when marked read; it does NOT
 * represent business completion (P5-N1-R0 §19.4).
 */
export const NotificationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  recipientUserId: z.string().uuid(),
  type: NotificationTypeSchema,
  title: z.string().min(1),
  body: z.string().min(1),
  actionPath: z.string().regex(NOTIFICATION_ACTION_PATH_PATTERN),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});

/** DTO for a single notification. */
export type NotificationDTO = z.infer<typeof NotificationSchema>;

/**
 * Query schema for GET /notifications. Reuses offset/page pagination and adds
 * an optional one-way `unread=true` server-side filter.
 */
export const NotificationListQuerySchema = PaginationParamsSchema.extend({
  // One-way switch: only the literal "true" enables the unread filter. Any
  // other value is rejected so the filter cannot be silently inverted.
  unread: z.literal("true").optional(),
});

/** Parsed query for GET /notifications. */
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

/** Response schema for GET /notifications/unread-count. */
export const UnreadCountResponseSchema = z.object({
  count: z.number().int().min(0),
});

/** Response payload for the unread-count endpoint. */
export type UnreadCountResponse = z.infer<typeof UnreadCountResponseSchema>;

/** Response schema for POST /notifications/read-all. */
export const MarkAllReadResponseSchema = z.object({
  updated: z.number().int().min(0),
});

/**
 * Factory for the paginated notification list response schema.
 * Reuses PaginatedResponseSchema so the Inbox list shape matches every other
 * paginated endpoint in the repo.
 */
export const NotificationListResponseSchema =
  PaginatedResponseSchema(NotificationSchema);
