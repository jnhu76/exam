import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createDatabase } from "@exam/db/database";
import { setTransactionRetryLogger } from "@exam/db/types";
import type { Database } from "@exam/db/types";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { registerRootSqlConnectionForTelemetry } from "../telemetry/runtime.js";
import { AUDIT_DRAIN_TIMEOUT_MS } from "./auditLifecycle.js";
import {
  installCapacityResearchInstrumentation,
  isCapacityResearchEnabled,
} from "../lib/capacityResearch.js";

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
  // RESEARCH ONLY (#550): observation wrapper, inert unless CAPACITY_RESEARCH=1.
  if (isCapacityResearchEnabled()) {
    installCapacityResearchInstrumentation(conn.sql);
  }
  // #964 W2: tag the root pool for the DB telemetry plugin (root vs
  // transaction statement attribution). No-op unless telemetry is On —
  // the handle only exists behind the telemetry-enabled gate. Runs BEFORE
  // the first statement of this pool can execute.
  registerRootSqlConnectionForTelemetry(conn.sql);
  fastify.decorate<Database>("db", conn.db);
  // Retry observability (#800 PR-B): transaction retries anywhere in the
  // process surface as structured warns on the Fastify logger. Wired once
  // per process; per-request correlation stays with request-scoped logs.
  setTransactionRetryLogger(fastify.log);
  fastify.addHook("onClose", async () => {
    await conn.sql.end({ timeout: Math.ceil(AUDIT_DRAIN_TIMEOUT_MS / 1000) });
  });
};

export default fp(dbPlugin);
