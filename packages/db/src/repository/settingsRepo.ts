import { randomUUID } from "node:crypto";
import type {
  BrandingView,
  PublicBrandingContext,
  RequestContext,
} from "@exam/domain";
import { ValidationError } from "@exam/domain";
import { eq } from "drizzle-orm";
import type { AnyDatabase, PostgresDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import {
  organizations as sqliteOrgs,
  organizationSettings as sqliteSettings,
} from "../schema/sqlite.js";
import {
  organizations as pgOrgs,
  organizationSettings as pgSettings,
} from "../schema/pg.js";
import { now, resolveOrganizationId } from "./baseRepo.js";

type BrandingUpdate = {
  productName?: string;
  productSubtitle?: string;
  footerText?: string;
  organizationDisplayName?: string;
  timezone?: string;
};

export function createSettingsRepo(db: AnyDatabase) {
  return {
    async get(ctx: RequestContext) {
      if (isSqlite(db)) {
        return (
          db
            .select()
            .from(sqliteSettings)
            .where(
              eq(sqliteSettings.organizationId, resolveOrganizationId(ctx)),
            )
            .get() ?? null
        );
      }
      const rows = await (db as PostgresDatabase)
        .select()
        .from(pgSettings)
        .where(eq(pgSettings.organizationId, resolveOrganizationId(ctx)));
      return rows[0] ?? null;
    },
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

      if (isSqlite(db)) {
        db.insert(sqliteSettings)
          .values(settings)
          .onConflictDoUpdate({
            target: sqliteSettings.organizationId,
            set: { ...input, updatedAt: timestamp },
          })
          .run();

        return db
          .select()
          .from(sqliteSettings)
          .where(eq(sqliteSettings.organizationId, tenantId))
          .get();
      }
      await (db as PostgresDatabase)
        .insert(pgSettings)
        .values(settings)
        .onConflictDoUpdate({
          target: pgSettings.organizationId,
          set: { ...input, updatedAt: timestamp },
        });

      const rows = await (db as PostgresDatabase)
        .select()
        .from(pgSettings)
        .where(eq(pgSettings.organizationId, tenantId));
      return rows[0] ?? null;
    },
    async delete(ctx: RequestContext) {
      if (isSqlite(db)) {
        return (
          db
            .delete(sqliteSettings)
            .where(
              eq(sqliteSettings.organizationId, resolveOrganizationId(ctx)),
            )
            .run().changes > 0
        );
      }
      const result = await (db as PostgresDatabase)
        .delete(pgSettings)
        .where(eq(pgSettings.organizationId, resolveOrganizationId(ctx)));
      return (result.count ?? 0) > 0;
    },
    async getPublicBranding(ctx: PublicBrandingContext): Promise<BrandingView> {
      if (!ctx.organizationId) {
        throw new ValidationError(
          "Public branding lookup requires organizationId",
        );
      }

      let organization: typeof sqliteOrgs.$inferSelect | null;
      let settings: typeof sqliteSettings.$inferSelect | null;

      if (isSqlite(db)) {
        organization =
          db
            .select()
            .from(sqliteOrgs)
            .where(eq(sqliteOrgs.id, ctx.organizationId))
            .get() ?? null;
        if (!organization) {
          throw new ValidationError("Branding organization not found");
        }
        settings =
          db
            .select()
            .from(sqliteSettings)
            .where(eq(sqliteSettings.organizationId, organization.id))
            .get() ?? null;
      } else {
        const orgRows = await (db as PostgresDatabase)
          .select()
          .from(pgOrgs)
          .where(eq(pgOrgs.id, ctx.organizationId));
        organization = orgRows[0] ?? null;
        if (!organization) {
          throw new ValidationError("Branding organization not found");
        }
        const settingsRows = await (db as PostgresDatabase)
          .select()
          .from(pgSettings)
          .where(eq(pgSettings.organizationId, organization.id));
        settings = settingsRows[0] ?? null;
      }

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
