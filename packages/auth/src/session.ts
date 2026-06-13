import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { RequestContext } from "@exam/domain";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
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
