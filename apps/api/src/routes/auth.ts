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
import { RequestContext } from "@exam/domain";
import { ValidationError, NotFoundError } from "@exam/domain";

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/register", async (request: any, reply: any) => {
    const data = RegisterRequestSchema.parse(request.body);
    const userRepo = createUserRepo(fastify.db);

    // 检查用户是否已存在
    const existingUser = userRepo.findByUsername(data.username);
    if (existingUser) {
      return reply.code(400).send({
        message: "Username already exists",
        code: "USER_EXISTS",
      });
    }

    // 创建用户
    const user = userRepo.create({} as RequestContext, {
      ...data,
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

  fastify.post("/login", async (request: any, reply: any) => {
    const data = LoginRequestSchema.parse(request.body);
    const userRepo = createUserRepo(fastify.db);

    const user = userRepo.findByUsername(data.username);
    if (!user) {
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

    // 设置 HTTP-only cookie
    reply.setCookie("auth-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60, // 24 hours
    });

    const response = LoginResponseSchema.parse({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
    });

    return reply.code(200).send(response);
  });

  fastify.post("/logout", async (request: any, reply: any) => {
    reply.clearCookie("auth-token");
    return reply.code(200).send({ success: true });
  });

  fastify.get(
    "/me",
    { preHandler: fastify.authenticate },
    async (request: any, reply: any) => {
      const userRepo = createUserRepo(fastify.db);
      const user = userRepo.findById(request["ctx"], request["ctx"].actorId);

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
