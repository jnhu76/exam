/**
 * #864 closed route-template vocabulary for client events.
 *
 * INVARIANT: the persisted/read value of `client_events.route` is ALWAYS a
 * member of {@link SPA_ROUTE_TEMPLATES} or `null` — never raw client bytes.
 * The 2026-11 secure-correlation audit proved the previous pathname-only
 * projection leaked attacker-controlled content at rest and through the
 * authorized proctor timeline (RT-3 plaintext path secret, RT-8 encoded
 * query smuggling, RT-12B opaque-scheme credentials, RT-12C data: payload,
 * RT-14B raw CRLF; archive: docs/research/exam-secure-observability-
 * remediation/ 02-SECURITY-EVIDENCE.md). Every failure path below fails
 * closed to `null`; there is deliberately NO raw/truncated/partially
 * sanitized fallback.
 *
 * This vocabulary mirrors the SPA router declared in `apps/web/src/App.tsx`
 * (browser navigation paths — NOT Fastify API route templates). The drift
 * guard `apps/web/src/lib/spaRouteTemplateVocabulary.test.ts` pins the two
 * sides together: a route added or renamed in either place fails that test
 * instead of silently widening what may be persisted.
 *
 * The projection is applied at BOTH boundaries:
 * - ingest (`apps/api/src/routes/clientEvents.ts`) — new rows;
 * - read (`apps/api/src/lib/proctorMonitoringService.ts`) — legacy rows
 *   written by the pre-#864 regime are re-projected so historical bytes
 *   cannot re-enter an authorized response.
 *
 * It is idempotent: every template projects to itself, so read-side
 * projection of already-safe values is a no-op.
 */
export const SPA_ROUTE_TEMPLATES: readonly string[] = [
  "/login",
  "/launchpad",
  "/invite/accept",
  "/forgot-password",
  "/reset-password",
  "/admin",
  "/admin/dashboard",
  "/admin/system",
  "/admin/operations",
  "/admin/diagnostics",
  "/admin/settings",
  "/admin/candidate-fields",
  "/admin/users",
  "/admin/candidates",
  "/admin/courses",
  "/admin/questions",
  "/admin/questions/new",
  "/admin/questions/:id/edit",
  "/admin/questions/import",
  "/admin/exams",
  "/admin/exams/new",
  "/admin/exams/:id",
  "/admin/exams/:id/edit",
  "/admin/exams/:id/scores",
  "/admin/exam-profiles",
  "/admin/exam-profiles/new",
  "/admin/exam-profiles/:id/edit",
  "/admin/exams/:id/proctor",
  "/admin/proctor",
  "/admin/exams/:id/proctor/monitor",
  "/admin/results",
  "/admin/grading-queue",
  "/admin/grading-queue/:id",
  "/admin/audit-logs",
  "/admin/permissions",
  "/admin/import-logs",
  "/admin/attempts/:id",
  "/admin/recovery",
  "/admin/recovery/incidents/:incidentId",
  "/admin/recovery/attempts/:attemptId",
  "/admin/recovery/exams/:examId",
  "/admin/proctor/recovery",
  "/admin/proctor/recovery/incidents/:incidentId",
  "/exam",
  "/exam/list",
  "/exam/settings",
  "/exam/:examId/start",
  "/exam/:attemptId/take",
  "/exam/:attemptId/result",
];

/**
 * Precompiled template matchers: segments plus the count of literal
 * (non-`:param`) segments, used to prefer the most specific match — e.g.
 * `/admin/exams/new` (3 literals) must outrank `/admin/exams/:id`
 * (2 literals) for the input `/admin/exams/new`, mirroring React Router's
 * literal-over-param ranking.
 */
const COMPILED_TEMPLATES = SPA_ROUTE_TEMPLATES.map((template) => {
  const segments = template.slice(1).split("/");
  const literalCount = segments.filter((s) => !s.startsWith(":")).length;
  return { template, segments, literalCount };
});

/**
 * Dummy base for parsing path-absolute inputs. The host never reaches the
 * output — only `url.pathname` participates in matching — and `.invalid` is
 * a reserved TLD that can never resolve.
 */
const PARSE_BASE = "http://client-event.invalid";

/**
 * Minimal structural type for the WHATWG URL constructor. The runtime global
 * exists in both Node and browsers; this package compiles under a plain
 * ES2022 lib without DOM globals (same constraint that keeps
 * `utf8ByteLength` off TextEncoder), so the two members this projection
 * reads are declared locally instead.
 */
declare const URL: new (
  input: string,
  base?: string,
) => {
  readonly protocol: string;
  readonly pathname: string;
};

/**
 * Defensive upper bound on read-side inputs: the wire schema caps `route` at
 * 500 chars and the pre-#864 writer truncated at 500, so legacy rows cannot
 * exceed this; the bound exists only so a future writer regression can never
 * make the matcher scan unbounded attacker input.
 */
const MAX_INPUT_LENGTH = 2_000;

/**
 * Projects an untrusted client-reported route onto the closed template
 * vocabulary: the matched template string (dynamic identifiers replaced by
 * their `:param` placeholder — never echoed), or `null` when the input is
 * not a navigable SPA page (unknown route, unknown scheme, malformed URL,
 * structural garbage). Query strings, fragments, userinfo, hosts, and every
 * client byte inside dynamic segments are dropped; they cannot reach storage
 * or an authorized response through this channel.
 *
 * Matching is linear per segment with no backtracking and no content
 * inspection of dynamic segments — safety comes from the closed output set,
 * not from recognizing "sensitive" content.
 */
export function projectClientEventRoute(
  route: string | null | undefined,
): string | null {
  if (typeof route !== "string" || route.length === 0) return null;
  if (route.length > MAX_INPUT_LENGTH) return null;

  let pathname: string;
  try {
    // Path-absolute inputs parse against the dummy base; anything else must
    // be a fully-formed absolute URL (protocol-relative "//h/p" resolves to
    // an absolute http URL and is fine — only the pathname is ever used).
    const url = route.startsWith("/")
      ? new URL(route, PARSE_BASE)
      : new URL(route);
    // Non-http(s) schemes (data:, user:…@host opaque forms, mailto:, ftp:,
    // javascript: …) are never SPA navigation: reject before any content is
    // considered. This is the RT-12B/12C boundary.
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    pathname = url.pathname;
  } catch {
    // Malformed input (e.g. "http://[?token=…" RT-13/14B): fail closed. The
    // pre-#864 hand-trimmed fallback is intentionally gone.
    return null;
  }

  // Normalize a trailing slash ("/admin/users/" == "/admin/users"); the bare
  // root "/" matches no declared page.
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  if (pathname.length <= 1) return null;

  // Percent escapes are deliberately NOT decoded: decoding would re-open
  // RT-8 (a decoded %2F/%3F smuggles separators); a literal that was sent
  // encoded simply fails to match and degrades to null.
  const segments = pathname.slice(1).split("/");
  // Empty segments (double slashes) match no declared template.
  if (segments.some((s) => s.length === 0)) return null;

  let best: string | null = null;
  let bestLiteralCount = -1;
  for (const candidate of COMPILED_TEMPLATES) {
    if (candidate.segments.length !== segments.length) continue;
    let matched = true;
    for (let i = 0; i < segments.length; i++) {
      const templateSegment = candidate.segments[i]!;
      if (templateSegment.startsWith(":")) continue; // dynamic slot — input bytes are dropped, not copied
      if (templateSegment !== segments[i]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (candidate.literalCount > bestLiteralCount) {
      best = candidate.template;
      bestLiteralCount = candidate.literalCount;
    }
  }
  return best;
}
