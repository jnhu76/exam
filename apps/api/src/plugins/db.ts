import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createDatabase } from "@exam/db/src/database.js";
import type { Database } from "@exam/db/src/types.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { AUDIT_DRAIN_TIMEOUT_MS } from "./auditLifecycle.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}

/**
 * Fastify plugin that creates a database connection from runtime config
 * and decorates the Fastify instance with a `db` property for use by
 * repository functions throughout the application.
 */
const dbPlugin: FastifyPluginAsync = async (fastify) => {
  const { database } = getRuntimeConfig();
  const conn = await createDatabase(database.url);
  fastify.decorate<Database>("db", conn.db);
  fastify.addHook("onClose", async () => {
    await conn.sql.end({ timeout: Math.ceil(AUDIT_DRAIN_TIMEOUT_MS / 1000) });
  });
};

export default fp(dbPlugin);
