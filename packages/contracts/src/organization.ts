import { z } from "zod";

// ── Organization ──────────────────────────────────────────────────

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  settings: z
    .object({
      productName: z.string().optional(),
      productSubtitle: z.string().optional(),
      footerText: z.string().optional(),
      timezone: z.string().optional(),
    })
    .default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OrganizationDTO = z.infer<typeof OrganizationSchema>;

export const CreateOrganizationRequestSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
  settings: z
    .object({
      productName: z.string().optional(),
      productSubtitle: z.string().optional(),
      footerText: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
});
export type CreateOrganizationRequest = z.infer<
  typeof CreateOrganizationRequestSchema
>;

export const UpdateOrganizationRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  settings: z
    .object({
      productName: z.string().optional(),
      productSubtitle: z.string().optional(),
      footerText: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
});
export type UpdateOrganizationRequest = z.infer<
  typeof UpdateOrganizationRequestSchema
>;

// ── Branding ──────────────────────────────────────────────────────

export const BrandingResponseSchema = z.object({
  productName: z.string().default("考试系统"),
  productSubtitle: z.string().default(""),
  footerText: z.string().default(""),
  organizationDisplayName: z.string().default(""),
});
export type BrandingResponse = z.infer<typeof BrandingResponseSchema>;

export const UpdateBrandingRequestSchema = z.object({
  productName: z.string().min(1).max(200).optional(),
  productSubtitle: z.string().max(500).optional(),
  footerText: z.string().max(500).optional(),
  timezone: z.string().optional(),
});
export type UpdateBrandingRequest = z.infer<
  typeof UpdateBrandingRequestSchema
>;
