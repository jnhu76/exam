import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createDatabase } from "@exam/db/src/database.js";
import type { Database } from "@exam/db/src/types.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}

const dbPlugin: FastifyPluginAsync = async (fastify) => {
  const conn = await createDatabase();
  fastify.decorate<Database>("db", conn.db);
};

export default fp(dbPlugin);
