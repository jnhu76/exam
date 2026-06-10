import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createDatabase } from "@exam/db/src/database.js";
import type { AnyDatabase } from "@exam/db/src/types.js";

declare module "fastify" {
  interface FastifyInstance {
    db: AnyDatabase;
  }
}

const dbPlugin: FastifyPluginAsync = async (fastify) => {
  const conn = createDatabase();
  fastify.decorate<AnyDatabase>("db", conn.db);
};

export default fp(dbPlugin);
