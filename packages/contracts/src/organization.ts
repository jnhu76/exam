import { z } from "zod";

// ── Organization ──────────────────────────────────────────────────

/**
 * Schema for an organization entity, the top-level tenant boundary in the system.
 */
export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  displayName: z.string(),
  slug: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Represents an organization entity, the top-level data boundary in the system. */
export type OrganizationDTO = z.infer<typeof OrganizationSchema>;

/**
 * Request schema for creating a new organization.
 */
export const CreateOrganizationRequestSchema = z.object({
  name: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
});

/** Type for a create-organization request. */
export type CreateOrganizationRequest = z.infer<
  typeof CreateOrganizationRequestSchema
>;

/**
 * Request schema for updating an organization's name or display name.
 */
export const UpdateOrganizationRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  displayName: z.string().min(1).max(200).optional(),
});

/** Type for an update-organization request. */
export type UpdateOrganizationRequest = z.infer<
  typeof UpdateOrganizationRequestSchema
>;
