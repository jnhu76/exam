import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { EmailSender } from "@exam/domain";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { createEmailSender, SmtpEmailSender } from "../email/senders.js";

declare module "fastify" {
  interface FastifyInstance {
    /** The active email sender (disabled/fake/smtp), built from runtime config. */
    emailSender: EmailSender;
  }
}

/**
 * Email plugin (M3): builds the active {@link EmailSender} from runtime config
 * and decorates the Fastify instance with it. Routes use `fastify.emailSender`
 * — never nodemailer directly. On close, the SMTP transporter (if any) is
 * released so pooled connections do not leak.
 */
const emailPlugin: FastifyPluginAsync = async (fastify) => {
  const config = getRuntimeConfig();
  const sender = createEmailSender({
    enabled: config.email.enabled,
    transport: config.email.transport,
    from: config.email.from,
    fromName: config.email.fromName,
    fakeMode: config.email.fakeMode,
    fakeDelayMs: config.email.fakeDelayMs,
    fakeSendEnteredFile: config.email.fakeSendEnteredFile,
    smtp: config.email.smtp,
  });
  fastify.decorate<EmailSender>("emailSender", sender);

  fastify.addHook("onClose", async () => {
    // Only the SMTP sender owns a long-lived transporter worth closing.
    if (sender instanceof SmtpEmailSender) {
      sender.close();
    }
  });
};

export default fp(emailPlugin);
