import {
  isResultPublishedActionPath,
  type NotificationDTO,
} from "@exam/contracts";

// P5-N1-I2 — V1 action-link builder + render-time combiner.
//
// Authority: P5-N1-R0 §16 — frozen. The V1 design is a command-specific
// trusted builder, NOT a generic whitelist URL-security framework. There is
// exactly one V1 caller (the result-publication fan-out) and exactly one V1
// route prefix (/exam/:attemptId/result). The shared regex + validator live
// in @exam/contracts so the builder, the write-time assertion, and the
// render-time revalidation all use the same single source of truth.

/**
 * Builds the canonical V1 result-published action path:
 *   /exam/<attemptId>/result
 *
 * This is the real existing candidate result route
 * (apps/web/src/lib/routes.ts: `routes.exam.result(attemptId)`,
 * App.tsx: `/exam/:attemptId/result`). Navigation is by `attemptId`, not
 * `examId`, because the ResultPage reads `attemptId` from URL params.
 *
 * The builder is the ONLY producer of stored V1 action paths. The
 * {@link validateStoredActionPath} re-check is a defense-in-depth assertion
 * that the stored value is still the canonical form (catches legacy/tampered
 * rows before they are rendered into an Email link).
 */
export function buildResultPublishedActionPath(attemptId: string): string {
  if (typeof attemptId !== "string" || attemptId === "") {
    throw new Error(
      "buildResultPublishedActionPath: attemptId must be a non-empty string",
    );
  }
  const path = `/exam/${attemptId}/result`;
  if (!isResultPublishedActionPath(path)) {
    throw new Error(
      `buildResultPublishedActionPath: attemptId produced a non-canonical path: ${attemptId}`,
    );
  }
  return path;
}

/**
 * Re-validates a stored action path at render time. Returns true for any
 * path that matches the V1 trusted-builder pattern. Rejects every off-site /
 * traversal / control-char shape so a tampered row cannot become an external
 * Email link. V1 action_path is NOT NULL; the null guard is retained as
 * defense-in-depth for legacy/tampered rows only.
 *
 * Thin wrapper over the contract validator so the API never re-implements
 * the regex.
 */
export function validateStoredActionPath(path: string | null): boolean {
  if (path === null) return true;
  return isResultPublishedActionPath(path);
}

/**
 * Combines a validated site-relative action path with PUBLIC_WEB_ORIGIN to
 * produce an absolute Email link. Re-validates the path BEFORE combining so a
 * tampered/legacy stored value can never yield an off-site URL.
 *
 * `publicWebOrigin` must be an absolute origin (scheme + host[+port]), no
 * trailing slash, no path. This is enforced at boot by runtime config; this
 * function asserts it again as defense in depth.
 */
export function buildAbsoluteResultLink(
  actionPath: string,
  publicWebOrigin: string,
): string {
  if (!validateStoredActionPath(actionPath)) {
    throw new Error(
      `buildAbsoluteResultLink: invalid action path (refusing to combine with PUBLIC_WEB_ORIGIN): ${actionPath}`,
    );
  }
  const origin = publicWebOrigin.replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+$/i.test(origin)) {
    throw new Error(
      `buildAbsoluteResultLink: PUBLIC_WEB_ORIGIN must be an absolute origin (scheme + host[+port], no path); got: ${publicWebOrigin}`,
    );
  }
  return `${origin}${actionPath}`;
}

/**
 * Convenience: extracts the action path from a notification DTO.
 * V1 notifications are always actionable (action_path NOT NULL).
 */
export function actionPathOf(
  notification: Pick<NotificationDTO, "actionPath">,
): string {
  return notification.actionPath;
}
