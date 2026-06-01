import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import cors from "./plugins/cors.js";
import setupSecurity from "./plugins/security.js";
import authPlugin from "./plugins/auth.js";
import dbPlugin from "./plugins/db.js";
import tenantPlugin from "./plugins/tenant.js";
import rateLimitPlugin from "./plugins/rateLimit.js";
import heartbeatPlugin from "./plugins/heartbeat.js";
import { setupErrorHandler } from "./plugins/errors.js";
import authRoutes from "./routes/auth.js";
import settingsRoutes from "./routes/settings.js";
import organizationRoutes from "./routes/organization.js";
import candidateFieldRoutes from "./routes/candidateField.js";
import userRoutes from "./routes/user.js";
import candidateRoutes from "./routes/candidate.js";
import courseRoutes from "./routes/course.js";
import questionRoutes from "./routes/question.js";
import examRoutes from "./routes/exam.js";
import attemptRoutes from "./routes/attempts.js";
import scoreRoutes from "./routes/scores.js";
import { exportRoutes } from "./routes/export.js";

const port = Number(process.env.APP_PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(fastifyCookie);
  await app.register(cors);
  setupSecurity(app);
  setupErrorHandler(app);
  await app.register(dbPlugin);
  await app.register(authPlugin);
  await app.register(tenantPlugin);
  await app.register(rateLimitPlugin);
  await app.register(heartbeatPlugin);

  app.get("/api/health", async () => {
    return { status: "ok" };
  });

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(settingsRoutes, { prefix: "/api" });
  await app.register(organizationRoutes, { prefix: "/api" });
  await app.register(candidateFieldRoutes, { prefix: "/api" });
  await app.register(userRoutes, { prefix: "/api" });
  await app.register(candidateRoutes, { prefix: "/api" });
  await app.register(courseRoutes, { prefix: "/api" });
  await app.register(questionRoutes, { prefix: "/api" });
  await app.register(examRoutes, { prefix: "/api" });
  await app.register(attemptRoutes, { prefix: "/api" });
  await app.register(scoreRoutes, { prefix: "/api" });
  await app.register(exportRoutes, { prefix: "/api" });

  await app.listen({ port, host });
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
