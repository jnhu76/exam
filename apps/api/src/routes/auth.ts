import { FastifyPluginAsync } from "fastify";
import {
  LoginRequestSchema,
  LoginResponseSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  MeResponseSchema,
  LogoutResponseSchema,
} from "@exam/contracts";
import { hashPassword, verifyPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { PublicBrandingContext, RequestContext } from "@exam/domain";
import { PermissionDeniedError } from "@exam/domain";

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/register", async (request, reply) => {
    const data = RegisterRequestSchema.parse(request.body);
    const userRepo = createUserRepo(fastify.db);
    const org = createOrganizationRepo(fastify.db).resolveBrandingTenant(
      { purpose: "public_branding" } as PublicBrandingContext,
      data.organizationSlug,
    );
    if (
      !process.env.BOOTSTRAP_REGISTRATION_TOKEN ||
      data.bootstrapToken !== process.env.BOOTSTRAP_REGISTRATION_TOKEN
    ) {
      throw new PermissionDeniedError("Bootstrap registration is disabled");
    }

    const existingUser = userRepo.findByOrganizationAndUsername(
      org.id,
      data.username,
    );
    if (existingUser) {
      return reply.code(400).send({
        message: "Username already exists",
        code: "USER_EXISTS",
      });
    }

    const ctx: RequestContext = {
      actorId: "bootstrap",
      organizationId: org.id,
      targetOrganizationId: org.id,
      role: "SuperAdmin",
      permissions: [],
      sessionId: "bootstrap",
    };
    const user = userRepo.create(ctx, {
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
      const org = createOrganizationRepo(fastify.db).resolveBrandingTenant(
        { purpose: "public_branding" } as PublicBrandingContext,
        data.organizationSlug,
      );

      const user = userRepo.findByOrganizationAndUsername(
        org.id,
        data.username,
      );
      if (!user?.isActive) {
        return reply.code(401).send({
          message: "Invalid username or password",
          code: "INVALID_CREDENTIALS",
        });
      }

      const isPasswordValid = await verifyPassword(
        data.password,
        user.passwordHash,
      );
      if (!isPasswordValid) {
        return reply.code(401).send({
          message: "Invalid username or password",
          code: "INVALID_CREDENTIALS",
        });
      }

      const token = signJWT({
        actorId: user.id,
        role: user.role,
        organizationId: user.organizationId,
      });

      reply.setCookie("auth-token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
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
    return reply.code(200).send({ success: true });
  });

  fastify.get(
    "/me",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userRepo = createUserRepo(fastify.db);
      const ctx = request.ctx!;
      const user = userRepo.findByOrganizationAndId(
        ctx.organizationId,
        ctx.actorId,
      );

      if (!user) {
        return reply.code(404).send({
          message: "User not found",
          code: "USER_NOT_FOUND",
        });
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
};

export default authRoutes;
