import { randomUUID } from "node:crypto";
import type {
  BrandingView,
  PublicBrandingContext,
  RequestContext,
} from "@exam/domain";
import { ValidationError } from "@exam/domain";
import { eq } from "drizzle-orm";
import type { SqliteDatabase } from "../sqlite.js";
import { organizations, organizationSettings } from "../schema/sqlite.js";
import { now, resolveOrganizationId } from "./baseRepo.js";

type BrandingUpdate = {
  productName?: string;
  productSubtitle?: string;
  footerText?: string;
  organizationDisplayName?: string;
  timezone?: string;
};

export function createSettingsRepo(db: SqliteDatabase) {
  return {
    get(ctx: RequestContext) {
      return (
        db
          .select()
          .from(organizationSettings)
          .where(
            eq(organizationSettings.organizationId, resolveOrganizationId(ctx)),
          )
          .get() ?? null
      );
    },
    upsert(ctx: RequestContext, input: BrandingUpdate) {
      const tenantId = resolveOrganizationId(ctx);
      const timestamp = now();
      const settings = {
        id: randomUUID(),
        organizationId: tenantId,
        ...input,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      db.insert(organizationSettings)
        .values(settings)
        .onConflictDoUpdate({
          target: organizationSettings.organizationId,
          set: { ...input, updatedAt: timestamp },
        })
        .run();

      return db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, tenantId))
        .get();
    },
    delete(ctx: RequestContext) {
      return (
        db
          .delete(organizationSettings)
          .where(
            eq(organizationSettings.organizationId, resolveOrganizationId(ctx)),
          )
          .run().changes > 0
      );
    },
    getPublicBranding(ctx: PublicBrandingContext): BrandingView {
      if (!ctx.organizationId) {
        throw new ValidationError(
          "Public branding lookup requires organizationId",
        );
      }

      const organization = db
        .select()
        .from(organizations)
        .where(eq(organizations.id, ctx.organizationId))
        .get();
      if (!organization) {
        throw new ValidationError("Branding organization not found");
      }

      const settings = db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, organization.id))
        .get();

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
