import { FastifyPluginAsync } from "fastify";
import {
  BrandingQuerySchema,
  BrandingViewSchema,
  UpdateBrandingRequestSchema,
} from "@exam/contracts";
import { createDatabase } from "@exam/db/src/database.js";
import { createSettingsRepo } from "@exam/db/src/repository/settingsRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { PublicBrandingContext, RequestContext } from "@exam/domain";
import { ensureTargetOrg } from "./helpers.js";

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/settings/branding", async (request: any) => {
    const query = BrandingQuerySchema.parse(request.query);
    const { db } = createDatabase();
    const orgRepo = createOrganizationRepo(db);
    const settingsRepo = createSettingsRepo(db);

    const org = orgRepo.resolveBrandingTenant(
      { purpose: "public_branding" } as PublicBrandingContext,
      query.organizationSlug,
    );

    const branding = settingsRepo.getPublicBranding({
      purpose: "public_branding",
      organizationId: org.id,
    });

    return BrandingViewSchema.parse(branding);
  });

  fastify.patch(
    "/admin/settings/branding",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any, reply: any) => {
      const rawCtx = request["ctx"] as RequestContext;
      const ctx = ensureTargetOrg(rawCtx);
      const data = UpdateBrandingRequestSchema.parse(request.body);
      const { db } = createDatabase();
      const settingsRepo = createSettingsRepo(db);
      const settings = settingsRepo.upsert(ctx, data as Record<string, string>);
      if (!settings) {
        return reply.code(500).send({
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to save settings",
          },
        });
      }
      return {
        id: settings.id,
        organizationId: settings.organizationId,
        productName: settings.productName,
        productSubtitle: settings.productSubtitle,
        footerText: settings.footerText,
        organizationDisplayName: settings.organizationDisplayName,
        timezone: settings.timezone,
        createdAt: settings.createdAt.toISOString(),
        updatedAt: settings.updatedAt.toISOString(),
      };
    },
  );
};

export default settingsRoutes;
