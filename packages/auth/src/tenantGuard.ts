import type { RequestContext } from "@exam/domain";

/** Alias for RequestContext used in tenant guard validation. */
export type TenantGuardContext = RequestContext;

/** Callback type for extending the platform API check with custom routes. */
export type PlatformApiCheck = (method: string, url: string) => boolean;

/** Default platform-level API routes that bypass tenant access validation. */
const DEFAULT_PLATFORM_APIS: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/api\/auth\/me/ },
  { method: "PATCH", pattern: /^\/api\/auth\/me/ },
  { method: "GET", pattern: /^\/api\/system\/health/ },
];

/**
 * Checks whether a request matches a known platform API route (built-in or custom).
 * Platform APIs bypass tenant-scoped access checks.
 */
export function isPlatformApi(
  method: string,
  url: string,
  extras?: PlatformApiCheck,
): boolean {
  if (extras?.(method, url)) return true;
  return DEFAULT_PLATFORM_APIS.some(
    (p) => p.method === method && p.pattern.test(url),
  );
}

/** Returns true if the URL is a public endpoint that requires no authentication. */
export function isPublicEndpoint(url: string): boolean {
  return (
    url === "/api/health" ||
    url === "/api/settings/branding" ||
    url === "/api/system/public-config" ||
    url === "/api/system/info"
  );
}

/**
 * Validates tenant access for a request. In the current single-tenant Phase 1,
 * this only bypasses validation for public endpoints.
 */
export function validateTenantAccess(
  _ctx: TenantGuardContext,
  _method: string,
  url: string,
  _opts?: { isPlatformApi?: PlatformApiCheck },
): void {
  if (isPublicEndpoint(url)) return;
}
