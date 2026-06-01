import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createDatabase } from "@exam/db/src/database.js";
import type { SqliteDatabase } from "@exam/db/src/sqlite.js";

declare module "fastify" {
  interface FastifyInstance {
    db: SqliteDatabase;
  }
}

const dbPlugin: FastifyPluginAsync = async (fastify) => {
  const conn = createDatabase();
  if (conn.kind === "sqlite") {
    fastify.decorate("db", conn.db);
  } else {
    fastify.decorate("db", conn.db as unknown as SqliteDatabase);
  }
};

export default fp(dbPlugin);
