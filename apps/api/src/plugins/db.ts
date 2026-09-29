import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createDatabase } from "@exam/db/src/database.js";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import type { Database } from "@exam/db/src/types.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { AUDIT_DRAIN_TIMEOUT_MS } from "./auditLifecycle.js";
import {
  installCapacityResearchInstrumentation,
  isCapacityResearchEnabled,
} from "../lib/capacityResearch.js";
import {
  logResearch586PoolMode,
  parseResearch586PoolMax,
  RESEARCH_586_POOL_ENV,
} from "../lib/research586.js";

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
  // EXAM-586 RESEARCH ONLY / NON_CANONICAL (#586): with the research env
  // unset, `createDatabase(database.url)` below is the byte-identical
  // canonical path; with EXAM_586_RESEARCH_POOL_MAX=10|20|30 the value is
  // passed as an explicit postgres.js `max`. This seam exists only on the
  // research/586-fedora-pool-1 branch image and must never become a product
  // setting (protocol §8).
  const research586PoolMax = parseResearch586PoolMax(
    process.env[RESEARCH_586_POOL_ENV],
  );
  logResearch586PoolMode(research586PoolMax);
  const conn =
    research586PoolMax === null
      ? await createDatabase(database.url)
      : await createPostgresDatabase(database.url, undefined, {
          max: research586PoolMax,
        });
  // RESEARCH ONLY (#550): observation wrapper, inert unless CAPACITY_RESEARCH=1.
  if (isCapacityResearchEnabled()) {
    installCapacityResearchInstrumentation(conn.sql);
  }
  fastify.decorate<Database>("db", conn.db);
  fastify.addHook("onClose", async () => {
    await conn.sql.end({ timeout: Math.ceil(AUDIT_DRAIN_TIMEOUT_MS / 1000) });
  });
};

export default fp(dbPlugin);
