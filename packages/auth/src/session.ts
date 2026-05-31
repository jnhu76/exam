import jwt from "jsonwebtoken";
import type { RequestContext } from "@exam/domain";

const JWT_SECRET = process.env.JWT_SECRET ?? "change-me-in-production";

export function signJWT(
  payload: Omit<
    RequestContext,
    "permissions" | "sessionId" | "targetOrganizationId"
  >,
  options?: jwt.SignOptions,
): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "24h",
    algorithm: "HS256",
    ...options,
  });
}

export function verifyJWT(
  token: string,
): Omit<RequestContext, "permissions" | "sessionId" | "targetOrganizationId"> {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ["HS256"],
  }) as Omit<
    RequestContext,
    "permissions" | "sessionId" | "targetOrganizationId"
  >;
}
