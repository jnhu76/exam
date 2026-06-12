import { z } from "zod";
import { RoleSchema } from "./user.js";

// ── Register ──────────────────────────────────────────────────────

export const RegisterRequestSchema = z.object({
  organizationSlug: z.string().min(1).max(100),
  bootstrapToken: z.string().min(1),
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
  organizationSlug: z.string().min(1).max(100).optional(),
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

// ── Change Password ───────────────────────────────────────────────

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(100),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const ChangePasswordResponseSchema = z.object({
  ok: z.literal(true),
});
export type ChangePasswordResponse = z.infer<
  typeof ChangePasswordResponseSchema
>;
