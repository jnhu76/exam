import type { FastifyInstance } from "fastify";

export default function setupSecurity(app: FastifyInstance): void {
  app.addHook("preHandler", (_req, reply, done) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "0");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    done();
  });
}
