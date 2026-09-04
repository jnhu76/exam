import { isNotificationActionPath } from "@exam/contracts";

// Notification action-link builders + render-time combiner.
//
// Authority: P5-N1-R0 §16 (result_published), extended additively for
// `exam_assigned` under #402/#299. The design is command-specific trusted
// builders, NOT a generic whitelist URL-security framework: there is one
// builder per notification type, each producing exactly one canonical path
// shape, and the shared regex + validator live in @exam/contracts so the
// builders, the write-time assertion, and the render-time revalidation all
// use the same single source of truth.

/**
 * Builds the canonical result-published action path:
 *   /exam/<attemptId>/result
 *
 * This is the real existing candidate result route
 * (apps/web/src/lib/routes.ts: `routes.exam.result(attemptId)`,
 * App.tsx: `/exam/:attemptId/result`). Navigation is by `attemptId`, not
 * `examId`, because the ResultPage reads `attemptId` from URL params.
 *
 * This builder is the ONLY producer of stored result_published action paths.
 * The {@link validateStoredActionPath} re-check is a defense-in-depth
 * assertion that the stored value is still a canonical form (catches
 * legacy/tampered rows before they are rendered into an Email link).
 */
export function buildResultPublishedActionPath(attemptId: string): string {
  if (typeof attemptId !== "string" || attemptId === "") {
    throw new Error(
      "buildResultPublishedActionPath: attemptId must be a non-empty string",
    );
  }
  const path = `/exam/${attemptId}/result`;
  if (!isNotificationActionPath(path)) {
    throw new Error(
      `buildResultPublishedActionPath: attemptId produced a non-canonical path: ${attemptId}`,
    );
  }
  return path;
}

/**
 * Builds the canonical exam_assigned action path: `/exam/list`.
 *
 * This is the candidate exam-list route
 * (apps/web/src/lib/routes.ts: `routes.exam.list`), served by the
 * candidate's authorized exam list. The notification deliberately does NOT
 * carry the examId: the list page is the existing authorization boundary
 * (GET /candidate/exams returns the candidate's actual enrollments), so no
 * new per-exam surface is exposed.
 */
export function buildExamAssignedActionPath(): string {
  const path = "/exam/list";
  if (!isNotificationActionPath(path)) {
    throw new Error(
      "buildExamAssignedActionPath: produced a non-canonical path",
    );
  }
  return path;
}

/**
 * Re-validates a stored action path at render time. Returns true for any
 * path that matches a trusted-builder pattern. Rejects every off-site /
 * traversal / control-char shape so a tampered row cannot become an external
 * Email link. action_path is NOT NULL; the null guard is retained as
 * defense-in-depth for legacy/tampered rows only.
 *
 * Thin wrapper over the contract validator so the API never re-implements
 * the regex.
 */
export function validateStoredActionPath(path: string | null): boolean {
  if (path === null) return true;
  return isNotificationActionPath(path);
}

/**
 * Combines a validated site-relative action path with PUBLIC_WEB_ORIGIN to
 * produce an absolute Email link. Re-validates the path BEFORE combining so
 * a tampered/legacy stored value can never yield an off-site URL.
 *
 * `publicWebOrigin` must be an absolute origin (scheme + host[+port]), no
 * trailing slash, no path. This is enforced at boot by runtime config; this
 * function asserts it again as defense in depth.
 */
export function buildAbsoluteNotificationLink(
  actionPath: string,
  publicWebOrigin: string,
): string {
  if (!validateStoredActionPath(actionPath)) {
    throw new Error(
      `buildAbsoluteNotificationLink: invalid action path (refusing to combine with PUBLIC_WEB_ORIGIN): ${actionPath}`,
    );
  }
  const origin = publicWebOrigin.replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+$/i.test(origin)) {
    throw new Error(
      `buildAbsoluteNotificationLink: PUBLIC_WEB_ORIGIN must be an absolute origin (scheme + host[+port], no path); got: ${publicWebOrigin}`,
    );
  }
  return `${origin}${actionPath}`;
}
