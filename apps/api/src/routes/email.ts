import { FastifyPluginAsync } from "fastify";
import {
  SendTestEmailRequestSchema,
  SendTestEmailResponseSchema,
} from "@exam/contracts";
import { DisabledEmailSender } from "../email/senders.js";
import { sanitizeEmailError } from "../email/sanitizeError.js";

/** OpenAPI security scheme requiring cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/**
 * Fastify plugin that registers email admin routes (M3).
 *
 * All routes require Admin authentication. There is no `/admin` prefix in
 * this project — admin-ness is enforced per-route via `requireRole(["Admin"])`.
 */
export const emailRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/email/test — send a one-off test email using the configured
   * sender.
   *
   * Behavior:
   *  - `EMAIL_ENABLED=false` → `{ ok: true, status: "disabled" }` (no error).
   *  - sender resolves        → `{ ok: true, status: "sent" }`.
   *  - sender rejects         → `{ ok: false, status: "failed", error }` where
   *    `error` is sanitized (never contains SMTP password / config).
   *
   * `to` is validated as an email so the endpoint cannot be used as an open
   * relay and rejects malformed input fast.
   */
  fastify.post(
    "/email/test",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        body: SendTestEmailRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: SendTestEmailResponseSchema },
      },
    },
    async (request) => {
      const { to } = SendTestEmailRequestSchema.parse(request.body);
      const sender = fastify.emailSender;

      if (sender instanceof DisabledEmailSender) {
        return { ok: true, status: "disabled" as const };
      }

      try {
        await sender.send({
          to,
          subject: "Test email",
          text: "This is a test email from the exam platform.",
        });
        return { ok: true, status: "sent" as const };
      } catch (err) {
        return {
          ok: false,
          status: "failed" as const,
          error: sanitizeEmailError(err),
        };
      }
    },
  );
};
