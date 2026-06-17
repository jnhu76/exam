import { z } from "zod";

// ── Public Branding ───────────────────────────────────────────────

/**
 * Query schema for the public branding endpoint, optionally filtering by organization slug.
 */
export const BrandingQuerySchema = z.object({
  organizationSlug: z.string().min(1).max(100).optional(),
});

/** Type for a branding query. */
export type BrandingQuery = z.infer<typeof BrandingQuerySchema>;

/**
 * Response schema for the public branding view, providing product name, subtitle,
 * footer text, and organization display name.
 */
export const BrandingViewSchema = z.object({
  productName: z.string(),
  productSubtitle: z.string().optional(),
  footerText: z.string().optional(),
  organizationDisplayName: z.string().optional(),
});

/** Type for the public branding view response. */
export type BrandingViewDTO = z.infer<typeof BrandingViewSchema>;

// ── Organization Settings ─────────────────────────────────────────

/**
 * Schema for organization-level settings, including branding fields and timezone configuration.
 */
export const OrganizationSettingsSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  productName: z.string().nullable(),
  productSubtitle: z.string().nullable(),
  footerText: z.string().nullable(),
  organizationDisplayName: z.string().nullable(),
  timezone: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Represents organization-level settings including branding and timezone. */
export type OrganizationSettingsDTO = z.infer<
  typeof OrganizationSettingsSchema
>;

/**
 * Request schema for updating organization branding settings (product name, subtitle,
 * footer text, display name, and timezone).
 */
export const UpdateBrandingRequestSchema = z.object({
  productName: z.string().min(1).max(200).optional(),
  productSubtitle: z.string().max(500).optional(),
  footerText: z.string().max(500).optional(),
  organizationDisplayName: z.string().max(200).optional(),
  timezone: z.string().min(1).max(100).optional(),
});

/** Type for an update-branding request. */
export type UpdateBrandingRequest = z.infer<typeof UpdateBrandingRequestSchema>;
