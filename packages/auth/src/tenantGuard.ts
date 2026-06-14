import type { RequestContext } from "@exam/domain";

export type TenantGuardContext = RequestContext;

export type PlatformApiCheck = (method: string, url: string) => boolean;

const DEFAULT_PLATFORM_APIS: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/api\/auth\/me/ },
  { method: "PATCH", pattern: /^\/api\/auth\/me/ },
  { method: "GET", pattern: /^\/api\/system\/health/ },
];

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

export function isPublicEndpoint(url: string): boolean {
  return (
    url === "/api/health" ||
    url === "/api/settings/branding" ||
    url === "/api/system/public-config" ||
    url === "/api/system/info"
  );
}

export function validateTenantAccess(
  _ctx: TenantGuardContext,
  _method: string,
  url: string,
  _opts?: { isPlatformApi?: PlatformApiCheck },
): void {
  if (isPublicEndpoint(url)) return;
}
