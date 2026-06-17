// P2.0-J1 — Shared OpenAPI route metadata helpers.
//
// Only repeated, route-agnostic metadata lives here (security scheme, role
// vendor extension, common uuid params). Route-specific request/response Zod
// schemas stay inline in each route file for review clarity. Error response
// codes are declared inline per route (per the fastify-type-provider-zod
// README: every status a handler returns must be declared in `response`).
import { z } from "zod";

/** cookieAuth security requirement applied to authenticated routes. */
export const cookieAuth = [{ cookieAuth: [] }] as const;

/** Vendor extension listing the roles allowed by requireRole([...]). */
export function xRole(roles: ReadonlyArray<string>): { "x-role": string[] } {
  return { "x-role": [...roles] };
}

export const idParamsSchema = z.object({ id: z.string().uuid() });
