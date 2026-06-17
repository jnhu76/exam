import { z } from "zod";

// ── Public Branding ───────────────────────────────────────────────

export const BrandingQuerySchema = z.object({
  organizationSlug: z.string().min(1).max(100).optional(),
});
export type BrandingQuery = z.infer<typeof BrandingQuerySchema>;

export const BrandingViewSchema = z.object({
  productName: z.string(),
  productSubtitle: z.string().optional(),
  footerText: z.string().optional(),
  organizationDisplayName: z.string().optional(),
});
export type BrandingViewDTO = z.infer<typeof BrandingViewSchema>;

// ── Organization Settings ─────────────────────────────────────────

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
export type OrganizationSettingsDTO = z.infer<
  typeof OrganizationSettingsSchema
>;

export const UpdateBrandingRequestSchema = z.object({
  productName: z.string().min(1).max(200).optional(),
  productSubtitle: z.string().max(500).optional(),
  footerText: z.string().max(500).optional(),
  organizationDisplayName: z.string().max(200).optional(),
  timezone: z.string().min(1).max(100).optional(),
});
export type UpdateBrandingRequest = z.infer<typeof UpdateBrandingRequestSchema>;
