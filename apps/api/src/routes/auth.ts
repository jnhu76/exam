import { FastifyPluginAsync } from "fastify";
import {
  LoginRequestSchema,
  LoginResponseSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  MeResponseSchema,
  LogoutResponseSchema,
  ChangePasswordRequestSchema,
} from "@exam/contracts";
import { hashPassword, verifyPassword } from "@exam/auth/src/password.js";
import { signJWT, verifyJWT } from "@exam/auth/src/session.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { PublicBrandingContext, RequestContext } from "@exam/domain";
import { PermissionDeniedError, ValidationError } from "@exam/domain";

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
      const org = await createOrganizationRepo(
        fastify.db,
      ).resolveBrandingTenant(
        { purpose: "public_branding" } as PublicBrandingContext,
        data.organizationSlug,
      );

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
      if (!user?.isActive) {
        await verifyPassword(
          data.password,
          "$argon2id$v=19$m=65536,t=3,p=4$dummy$dummy",
        ).catch(() => {});
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
        sessionVersion: user.sessionVersion ?? 0,
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

  fastify.post("/logout", async (request, reply) => {
    const token = request.cookies["auth-token"];
    if (token) {
      try {
        const payload = verifyJWT(token);
        await createUserRepo(fastify.db).incrementSessionVersion(
          payload.actorId,
        );
      } catch {}
    }
    reply.clearCookie("auth-token", { path: "/" });
    return reply.code(200).send({ success: true });
  });

  fastify.get(
    "/me",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userRepo = createUserRepo(fastify.db);
      const ctx = request.ctx!;
      const user = await userRepo.findByOrganizationAndId(ctx, ctx.actorId);

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

  fastify.patch(
    "/me/password",
    { preHandler: fastify.authenticate },
    async (request: any, reply: any) => {
      const parsed = ChangePasswordRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues.map((i) => i.message).join("; "),
          },
        });
      }
      const { currentPassword, newPassword } = parsed.data;
      const ctx = request["ctx"] as RequestContext;
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
          .send({ error: { code: "NOT_FOUND", message: "User not found" } });
      }

      const isValid = await verifyPassword(currentPassword, user.passwordHash);
      if (!isValid) {
        return reply.code(400).send({
          error: {
            code: "INVALID_PASSWORD",
            message: "Current password is incorrect",
          },
        });
      }

      const newHash = await hashPassword(newPassword);
      const updated = await userRepo.update(targetCtx, user.id, {
        passwordHash: newHash,
      });
      if (!updated) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "User not found" } });
      }
      await userRepo.incrementSessionVersion(user.id);
      return { ok: true as const };
    },
  );
};

export default authRoutes;
