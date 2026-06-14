import corsPlugin from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

export default async function cors(app: FastifyInstance) {
  const { origin } = getRuntimeConfig().cors;
  await app.register(corsPlugin, {
    origin,
    credentials: true,
  });
}
