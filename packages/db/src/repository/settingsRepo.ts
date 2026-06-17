import { randomUUID } from "node:crypto";
import type {
  BrandingView,
  PublicBrandingContext,
  RequestContext,
} from "@exam/domain";
import { NotFoundError, ValidationError } from "@exam/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../types.js";
import { organizations, organizationSettings } from "../schema/pg.js";
import { now, resolveOrganizationId } from "./baseRepo.js";

type BrandingUpdate = {
  productName?: string;
  productSubtitle?: string;
  footerText?: string;
  organizationDisplayName?: string;
  timezone?: string;
};

/** Creates a repository for the `organizationSettings` table with branding lookups. */
export function createSettingsRepo(db: Database) {
  return {
    /** Fetches the organization settings for the tenant, or null if not configured. */
    async get(ctx: RequestContext) {
      const rows = await db
        .select()
        .from(organizationSettings)
        .where(
          eq(organizationSettings.organizationId, resolveOrganizationId(ctx)),
        );
      return rows[0] ?? null;
    },
    /**
     * Upserts organization settings for the tenant. Creates on first call,
     * updates on subsequent calls. Returns the resulting settings row.
     */
    async upsert(ctx: RequestContext, input: BrandingUpdate) {
      const tenantId = resolveOrganizationId(ctx);
      const timestamp = now();
      const settings = {
        id: randomUUID(),
        organizationId: tenantId,
        ...input,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db
        .insert(organizationSettings)
        .values(settings)
        .onConflictDoUpdate({
          target: organizationSettings.organizationId,
          set: { ...input, updatedAt: timestamp },
        });

      const rows = await db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, tenantId));
      return rows[0] ?? null;
    },
    /** Deletes the organization settings for the tenant. Returns true if deleted. */
    async delete(ctx: RequestContext) {
      const result = await db
        .delete(organizationSettings)
        .where(
          eq(organizationSettings.organizationId, resolveOrganizationId(ctx)),
        );
      return (result.count ?? 0) > 0;
    },
    /**
     * Fetches the public branding view (product name, subtitle, footer,
     * organization display name) for login page display. Falls back to
     * organization-level defaults when settings are not configured.
     */
    async getPublicBranding(ctx: PublicBrandingContext): Promise<BrandingView> {
      if (!ctx.organizationId) {
        throw new ValidationError(
          "Public branding lookup requires organizationId",
        );
      }

      const orgRows = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, ctx.organizationId));
      const organization = orgRows[0] ?? null;
      if (!organization) {
        throw new NotFoundError("Branding organization not found");
      }
      const settingsRows = await db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, organization.id));
      const settings = settingsRows[0] ?? null;

      return {
        productName: settings?.productName ?? "LAN Exam Platform",
        ...(settings?.productSubtitle
          ? { productSubtitle: settings.productSubtitle }
          : {}),
        ...(settings?.footerText ? { footerText: settings.footerText } : {}),
        organizationDisplayName:
          settings?.organizationDisplayName ?? organization.displayName,
      };
    },
  };
}
