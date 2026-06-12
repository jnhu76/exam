import { FastifyPluginAsync } from "fastify";
import {
  LoginRequestSchema,
  LoginResponseSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  MeResponseSchema,
  ChangePasswordRequestSchema,
} from "@exam/contracts";
import {
  hashPassword,
  verifyPassword,
  verifyPasswordOrDummy,
} from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { PublicBrandingContext, RequestContext, Role } from "@exam/domain";
import { NotFoundError, PermissionDeniedError } from "@exam/domain";
import {
  buildErrorResponse,
  buildValidationErrorResponse,
} from "../lib/errorResponse.js";

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/register", async (request, reply) => {
    const data = RegisterRequestSchema.parse(request.body);
    const userRepo = createUserRepo(fastify.db);
    const org = await createOrganizationRepo(fastify.db).resolveBrandingTenant(
      { purpose: "public_branding" } as PublicBrandingContext,
      data.organizationSlug,
    );
    if (
      !process.env.BOOTSTRAP_REGISTRATION_TOKEN ||
      data.bootstrapToken !== process.env.BOOTSTRAP_REGISTRATION_TOKEN
    ) {
      throw new PermissionDeniedError("Bootstrap registration is disabled");
    }

    const bootstrapCtx = {
      organizationId: org.id,
      actorId: "bootstrap",
      role: "Admin" as const,
      permissions: [],
    };
    const existingUser = await userRepo.findByOrganizationAndUsername(
      bootstrapCtx,
      data.username,
    );
    if (existingUser) {
      return reply
        .code(409)
        .send(buildErrorResponse(request.id, "USER_ALREADY_EXISTS"));
    }

    const ctx: RequestContext = {
      actorId: "bootstrap",
      organizationId: org.id,
      targetOrganizationId: org.id,
      role: "SuperAdmin",
      permissions: [],
      sessionId: "bootstrap",
    };
    const user = await userRepo.create(ctx, {
      username: data.username,
      name: data.name,
      passwordHash: await hashPassword(data.password),
      role: "Admin",
      isActive: true,
    });

    const response = RegisterResponseSchema.parse({
      id: user.id,
      username: user.username,
      name: user.name,
    });

    return reply.code(201).send(response);
  });

  fastify.post(
    "/login",
    { config: { rateLimit: { max: 10, timeWindow: 60 * 1000 } } },
    async (request, reply) => {
      const data = LoginRequestSchema.parse(request.body);
      const userRepo = createUserRepo(fastify.db);
      let org;
      try {
        org = await createOrganizationRepo(fastify.db).resolveBrandingTenant(
          { purpose: "public_branding" } as PublicBrandingContext,
          data.organizationSlug,
        );
      } catch (error) {
        if (error instanceof NotFoundError) {
          // Always perform a dummy argon2 verify to avoid leaking whether the tenant exists via timing.
          await verifyPasswordOrDummy(data.password, null);
          return reply
            .code(401)
            .send(buildErrorResponse(request.id, "AUTH_INVALID_CREDENTIALS"));
        }
        throw error;
      }

      const anonCtx = {
        organizationId: org.id,
        actorId: "anonymous",
        role: "Candidate" as const,
        permissions: [],
      };
      const user = await userRepo.findByOrganizationAndUsername(
        anonCtx,
        data.username,
      );

      const isPasswordValid = await verifyPasswordOrDummy(
        data.password,
        user?.isActive ? user.passwordHash : null,
      );
      if (!user?.isActive || !isPasswordValid) {
        return reply
          .code(401)
          .send(buildErrorResponse(request.id, "AUTH_INVALID_CREDENTIALS"));
      }

      const token = signJWT({
        actorId: user.id,
        role: user.role as Role,
        organizationId: user.organizationId,
      });

      reply.setCookie("auth-token", token, {
        httpOnly: true,
        secure: process.env.COOKIE_SECURE === "true",
        sameSite: "strict",
        maxAge: 24 * 60 * 60,
        path: "/",
      });

      const response = LoginResponseSchema.parse({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
      });

      return reply.code(200).send(response);
    },
  );

  fastify.post("/logout", async (_request, reply) => {
    reply.clearCookie("auth-token", { path: "/" });
    return reply.code(204).send();
  });

  fastify.get(
    "/me",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userRepo = createUserRepo(fastify.db);
      const ctx = request.ctx!;
      const user = await userRepo.findByOrganizationAndId(ctx, ctx.actorId);

      if (!user) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const response = MeResponseSchema.parse({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
      });
      return reply.code(200).send(response);
    },
  );

  fastify.patch(
    "/me/password",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = ChangePasswordRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsed.error));
      }
      const { currentPassword, newPassword } = parsed.data;
      const ctx = request.ctx as RequestContext;
      const targetCtx = {
        ...ctx,
        targetOrganizationId: ctx.targetOrganizationId ?? ctx.organizationId,
      };
      const userRepo = createUserRepo(fastify.db);
      const user = await userRepo.findByOrganizationAndId(
        targetCtx,
        targetCtx.actorId,
      );
      if (!user) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const isValid = await verifyPassword(currentPassword, user.passwordHash);
      if (!isValid) {
        return reply
          .code(400)
          .send(buildErrorResponse(request.id, "CURRENT_PASSWORD_INVALID"));
      }

      const newHash = await hashPassword(newPassword);
      const updated = await userRepo.update(targetCtx, user.id, {
        passwordHash: newHash,
      });
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return { ok: true as const };
    },
  );
};

export default authRoutes;
