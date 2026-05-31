import Fastify from "fastify";
import cors from "./plugins/cors.js";
import setupSecurity from "./plugins/security.js";

const port = Number(process.env.APP_PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors);
  setupSecurity(app);

  app.get("/api/health", async () => {
    return { status: "ok" };
  });

  await app.listen({ port, host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
