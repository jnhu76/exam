import corsPlugin from "@fastify/cors";
import type { FastifyInstance } from "fastify";

export default async function cors(app: FastifyInstance) {
  await app.register(corsPlugin, {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  });
}
