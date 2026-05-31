import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import cors from "./plugins/cors.js";
import setupSecurity from "./plugins/security.js";
import authPlugin from "./plugins/auth.js";
import tenantPlugin from "./plugins/tenant.js";
import rateLimitPlugin from "./plugins/rateLimit.js";
import authRoutes from "./routes/auth.js";
import settingsRoutes from "./routes/settings.js";

const port = Number(process.env.APP_PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(fastifyCookie);
  await app.register(cors);
  setupSecurity(app);
  await app.register(authPlugin);
  await app.register(tenantPlugin);
  await app.register(rateLimitPlugin);

  app.get("/api/health", async () => {
    return { status: "ok" };
  });

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(settingsRoutes, { prefix: "/api" });

  await app.listen({ port, host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
