import { FastifyPluginAsync } from "fastify";
import {
  SendTestEmailRequestSchema,
  SendTestEmailResponseSchema,
} from "@exam/contracts";
import { DisabledEmailSender } from "../email/senders.js";
import { sanitizeEmailError } from "../email/sanitizeError.js";
import { recordBestEffortAudit } from "../audit/auditWriter.js";
import { getRequestContext } from "./helpers.js";
import { Permission } from "@exam/authz";

/** OpenAPI security scheme requiring cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/**
 * Fastify plugin that registers email admin routes (M3).
 *
 * All routes require Admin authentication. Authorization is enforced
 * per-route via capability gates.
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
   *
   * P7-E2A (ADR-017 D7): gated by the dedicated SystemEmailTest capability —
   * VIEW CAPABILITY MUST NOT AUTHORIZE SIDE EFFECT. `system.diagnostics.view`
   * no longer grants this mutation; the Maintainer preset does not receive
   * `system.email.test` by default.
   */
  fastify.post(
    "/email/test",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.SystemEmailTest),
      ],
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
        // P7-E2A (P2-3): the side effect is audited under its own action with
        // a masked recipient (never the verbatim address).
        recordBestEffortAudit(fastify, request, getRequestContext(request), {
          action: "system.email.test",
          targetType: "system",
          targetId: "email-test",
          metadata: { recipientMasked: maskEmail(to) },
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

/**
 * Masks an email address for audit metadata so the recipient is not recorded
 * verbatim (recipient addresses are personal data; the audit records only the
 * domain shape of the test recipient).
 */
function maskEmail(email: string): string {
  const [local = "", domain] = email.split("@");
  if (!domain) return "***";
  const maskedLocal =
    local.length <= 2
      ? "*".repeat(local.length)
      : `${local[0]}***${local.slice(-1)}`;
  return `${maskedLocal}@${domain}`;
}
