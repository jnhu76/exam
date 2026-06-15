import { FastifyPluginAsync } from "fastify";
import {
  BrandingQuerySchema,
  BrandingViewSchema,
  OrganizationSettingsSchema,
  UpdateBrandingRequestSchema,
} from "@exam/contracts";
import { createSettingsRepo } from "@exam/db/src/repository/settingsRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { PublicBrandingContext } from "@exam/domain";
import { ensureTargetOrg } from "./helpers.js";
import { recordAudit } from "./audit.js";
import { buildErrorResponse } from "../lib/errorResponse.js";

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/settings/branding", async (request) => {
    const query = BrandingQuerySchema.parse(request.query);
    const orgRepo = createOrganizationRepo(fastify.db);
    const settingsRepo = createSettingsRepo(fastify.db);

    const org = await orgRepo.resolveBrandingTenant(
      { purpose: "public_branding" } as PublicBrandingContext,
      query.organizationSlug,
    );

    const branding = await settingsRepo.getPublicBranding({
      purpose: "public_branding",
      organizationId: org.id,
    });

    return BrandingViewSchema.parse(branding);
  });

  fastify.get(
    "/admin/settings/branding",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
    },
    async (request) => {
      const settingsRepo = createSettingsRepo(fastify.db);
      const settings = await settingsRepo.get(ensureTargetOrg(request.ctx!));
      return settings
        ? OrganizationSettingsSchema.parse({
            ...settings,
            createdAt: settings.createdAt.toISOString(),
            updatedAt: settings.updatedAt.toISOString(),
          })
        : {};
    },
  );

  fastify.patch(
    "/admin/settings/branding",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
    },
    async (request, reply) => {
      const rawCtx = request.ctx!;
      const ctx = ensureTargetOrg(rawCtx);
      const data = UpdateBrandingRequestSchema.parse(request.body);
      const settingsRepo = createSettingsRepo(fastify.db);
      const settings = await settingsRepo.upsert(
        ctx,
        data as Record<string, string>,
      );
      if (!settings) {
        return reply
          .code(500)
          .send(buildErrorResponse(request.id, "INTERNAL_ERROR"));
      }
      recordAudit(
        fastify,
        request,
        ctx,
        "branding.update",
        "organization",
        ctx.targetOrganizationId!,
      );
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
