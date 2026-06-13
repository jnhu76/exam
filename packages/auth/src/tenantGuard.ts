import { AppError } from "@exam/domain";
import type { RequestContext } from "@exam/domain";
import { TenantAccessDeniedError } from "@exam/domain";

export class TargetOrganizationRequiredError extends AppError {
  constructor(message = "SuperAdmin must provide x-target-org header") {
    super(message, "TARGET_ORGANIZATION_REQUIRED", 400);
  }
}

export type TenantGuardContext = RequestContext;

export type PlatformApiCheck = (method: string, url: string) => boolean;

const DEFAULT_PLATFORM_APIS: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/api\/organizations/ },
  { method: "POST", pattern: /^\/api\/organizations/ },
  { method: "PATCH", pattern: /^\/api\/organizations/ },
  { method: "DELETE", pattern: /^\/api\/organizations/ },
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
  ctx: TenantGuardContext,
  method: string,
  url: string,
  opts?: { isPlatformApi?: PlatformApiCheck },
): void {
  if (isPublicEndpoint(url)) return;

  if (ctx.role === "SuperAdmin") {
    if (isPlatformApi(method, url, opts?.isPlatformApi)) return;

    if (!ctx.targetOrganizationId) {
      throw new TargetOrganizationRequiredError();
    }
  }
}

export async function validateTargetOrganizationExists(
  ctx: TenantGuardContext,
  orgExistsFn: (id: string) => Promise<boolean>,
): Promise<void> {
  if (ctx.role !== "SuperAdmin" || !ctx.targetOrganizationId) return;

  const exists = await orgExistsFn(ctx.targetOrganizationId);
  if (!exists) {
    throw new TenantAccessDeniedError("Target organization does not exist");
  }
}
