import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { RequestContext } from "@exam/domain";

export type JwtPayload = Omit<
  RequestContext,
  "permissions" | "sessionId" | "targetOrganizationId"
>;

function isProductionMode(): boolean {
  // APP_MODE is the authoritative run-mode; NODE_ENV is a fallback.
  const appMode = process.env.APP_MODE;
  if (appMode === "production") return true;
  if (appMode && appMode !== "production") return false;
  return process.env.NODE_ENV === "production";
}

function getDefaultJwtSecret(): string {
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
  payload: JwtPayload,
  secret?: string,
  options?: jwt.SignOptions,
): string {
  return jwt.sign(payload, secret ?? getDefaultJwtSecret(), {
    expiresIn: "24h",
    algorithm: "HS256",
    ...options,
  });
}

export function verifyJWT(token: string, secret?: string): JwtPayload {
  return jwt.verify(token, secret ?? getDefaultJwtSecret(), {
    algorithms: ["HS256"],
  }) as JwtPayload;
}

export function deriveSessionId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
