import type { FastifyInstance } from "fastify";

export default function setupSecurity(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      const str = typeof body === "string" ? body : "";
      if (str.trim() === "") {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(str));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.addHook("preHandler", (_req, reply, done) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "0");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    done();
  });
}
