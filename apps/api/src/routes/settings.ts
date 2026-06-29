import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  BrandingQuerySchema,
  BrandingViewSchema,
  OrganizationSettingsSchema,
  UpdateBrandingRequestSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import { createSettingsRepo } from "@exam/db/src/repository/settingsRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { Database } from "@exam/db/src/types.js";
import type { PublicBrandingContext } from "@exam/domain";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { recordAudit } from "./audit.js";
import { buildErrorResponse } from "../lib/errorResponse.js";

/** OpenAPI security definition for cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/**
 * Zod schema for the branding settings response returned by the
 * `PATCH /admin/settings/branding` endpoint.
 */
const brandingSettingsResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  productName: z.string().nullable(),
  productSubtitle: z.string().nullable(),
  footerText: z.string().nullable(),
  organizationDisplayName: z.string().nullable(),
  timezone: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Zod schema for the admin settings response. Returns either the full
 * `OrganizationSettings` or an empty object when no settings have been
 * configured yet. Shared by the aggregate and branding-scoped read endpoints.
 */
const adminSettingsResponseSchema = z.union([
  OrganizationSettingsSchema,
  z.object({}).strict(),
]);

/**
 * Reads the full organization settings for a tenant context and shapes them
 * for the admin settings response. Returns the validated settings object, or
 * `{}` when no settings row exists yet. Shared by the aggregate and
 * branding-scoped read endpoints to avoid duplicated read/serialize logic.
 */
async function readAdminSettings(
  db: Database,
  ctx: ReturnType<typeof ensureTargetOrg>,
): Promise<z.infer<typeof adminSettingsResponseSchema>> {
  const settingsRepo = createSettingsRepo(db);
  const settings = await settingsRepo.get(ctx);
  return settings
    ? OrganizationSettingsSchema.parse({
        ...settings,
        createdAt: settings.createdAt.toISOString(),
        updatedAt: settings.updatedAt.toISOString(),
      })
    : {};
}

/**
 * Fastify plugin that registers branding and organization settings routes.
 * Provides a public branding view endpoint and admin endpoints for reading
 * and updating branding settings.
 */
const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /settings/branding
   *
   * Returns the public branding view for the organization identified by
   * the `organizationSlug` query parameter. Unauthenticated — used by
   * login pages and public-facing UIs to display organization branding.
   */
  fastify.get(
    "/settings/branding",
    {
      schema: {
        querystring: BrandingQuerySchema,
        response: { 200: BrandingViewSchema },
      },
    },
    async (request) => {
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
    },
  );

  /**
   * GET /admin/settings
   *
   * Returns the full organization settings for the current organization.
   * Admin-only. Returns an empty object if no settings exist yet. This is the
   * aggregate read endpoint; branding-specific reads remain at
   * `/admin/settings/branding` and return the same shape.
   */
  fastify.get(
    "/admin/settings",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: adminSettingsResponseSchema,
        },
      },
    },
    async (request) => {
      return readAdminSettings(
        fastify.db,
        ensureTargetOrg(getRequestContext(request)),
      );
    },
  );

  /**
   * GET /admin/settings/branding
   *
   * Returns the full branding settings for the current organization.
   * Admin-only. Returns an empty object if no settings exist yet.
   */
  fastify.get(
    "/admin/settings/branding",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: adminSettingsResponseSchema,
        },
      },
    },
    async (request) => {
      return readAdminSettings(
        fastify.db,
        ensureTargetOrg(getRequestContext(request)),
      );
    },
  );

  /**
   * PATCH /admin/settings/branding
   *
   * Creates or updates branding settings for the current organization.
   * Admin-only. Records an audit log entry on success.
   */
  fastify.patch(
    "/admin/settings/branding",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        security: cookieAuth,
        "x-role": ["Admin"],
        body: UpdateBrandingRequestSchema,
        response: {
          200: brandingSettingsResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const rawCtx = getRequestContext(request);
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
