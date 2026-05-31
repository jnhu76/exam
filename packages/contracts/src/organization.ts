import { z } from "zod";

// ── Organization ──────────────────────────────────────────────────

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  displayName: z.string(),
  slug: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OrganizationDTO = z.infer<typeof OrganizationSchema>;

export const CreateOrganizationRequestSchema = z.object({
  name: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
});
export type CreateOrganizationRequest = z.infer<
  typeof CreateOrganizationRequestSchema
>;

export const UpdateOrganizationRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  displayName: z.string().min(1).max(200).optional(),
});
export type UpdateOrganizationRequest = z.infer<
  typeof UpdateOrganizationRequestSchema
>;
