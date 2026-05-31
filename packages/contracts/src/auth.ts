import { z } from "zod";
import { RoleSchema } from "./user.js";

// ── Register ──────────────────────────────────────────────────────

export const RegisterRequestSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  name: z.string().min(1).max(100),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const RegisterResponseSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  name: z.string(),
});
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

// ── Login ─────────────────────────────────────────────────────────

export const LoginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  name: z.string(),
  role: RoleSchema,
  organizationId: z.string().uuid(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// ── Me ────────────────────────────────────────────────────────────

export const MeResponseSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  name: z.string(),
  role: RoleSchema,
  organizationId: z.string().uuid(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// ── Logout ────────────────────────────────────────────────────────

export const LogoutRequestSchema = z.object({}).strict();
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const LogoutResponseSchema = z.object({
  success: z.boolean(),
});
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
