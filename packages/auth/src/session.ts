import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { RequestContext } from "@exam/domain";

function isProductionMode(): boolean {
  // APP_MODE is the authoritative run-mode; NODE_ENV is a fallback.
  const appMode = process.env.APP_MODE;
  if (appMode === "production") return true;
  if (appMode && appMode !== "production") return false;
  return process.env.NODE_ENV === "production";
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    return secret;
  }
  if (isProductionMode()) {
    throw new Error("JWT_SECRET is required in production");
  }
  return "development-only-change-me";
}

export function signJWT(
  payload: Omit<
    RequestContext,
    "permissions" | "sessionId" | "targetOrganizationId"
  >,
  options?: jwt.SignOptions,
): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: "24h",
    algorithm: "HS256",
    ...options,
  });
}

export function verifyJWT(
  token: string,
): Omit<RequestContext, "permissions" | "sessionId" | "targetOrganizationId"> {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: ["HS256"],
  }) as Omit<
    RequestContext,
    "permissions" | "sessionId" | "targetOrganizationId"
  >;
}

export function deriveSessionId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
