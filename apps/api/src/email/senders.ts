import nodemailer, { type Transporter } from "nodemailer";
import type { EmailMessage, EmailSender } from "@exam/domain";
import { sanitizeEmailError } from "./sanitizeError.js";

/**
 * Email sender configuration derived from runtime config (M3). Kept free of
 * Fastify/nodemailer imports so it is unit-testable in isolation.
 */
export type EmailTransport = "fake" | "smtp";
export type EmailFakeMode = "success" | "failure";

/** SMTP-specific options. `null` when transport is not `smtp`. */
export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  requireTls: boolean;
  tlsRejectUnauthorized: boolean;
  tlsServername: string | null;
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
}

export interface EmailSenderConfig {
  enabled: boolean;
  transport: EmailTransport;
  from: string;
  fromName: string | null;
  fakeMode: EmailFakeMode;
  smtp: SmtpOptions | null;
}

/**
 * No-op sender used when `EMAIL_ENABLED=false`. Never throws, never touches
 * the network. Safe default so a disabled deployment cannot accidentally send.
 */
export class DisabledEmailSender implements EmailSender {
  async send(_message: EmailMessage): Promise<void> {
    /* intentionally empty — disabled mode */
  }
}

/**
 * Deterministic fake sender for tests and local dev. `success` always
 * resolves; `failure` always rejects with a fixed message so `lastError` is
 * assertable. Never touches the network.
 */
export class FakeEmailSender implements EmailSender {
  constructor(private readonly mode: EmailFakeMode) {}
  async send(_message: EmailMessage): Promise<void> {
    if (this.mode === "failure") {
      throw new EmailSendError("Fake email sender failure");
    }
  }
}

/**
 * Wraps a nodemailer transporter behind the {@link EmailSender} interface.
 *
 * The transporter is injected (not constructed here) so:
 *  - the factory builds the real SMTP transporter from config, and
 *  - tests can inject a `jsonTransport: true` transporter or a failing stub
 *    without touching the network.
 *
 * `send` conforms to the `EmailSender` contract (returns `Promise<void>`).
 * Errors are sanitized (no password/config leak) and rethrown as
 * {@link EmailSendError} so the worker stores a safe string.
 */
export class SmtpEmailSender implements EmailSender {
  /** Secrets to scrub from any send error (e.g. the SMTP password). */
  private readonly scrubSecrets: string[];

  constructor(
    private readonly opts: {
      from: string;
      fromName?: string | null;
      transporter: Transporter;
      scrubSecrets?: string[];
    },
  ) {
    this.scrubSecrets = (opts.scrubSecrets ?? []).filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
  }

  async send(message: EmailMessage): Promise<void> {
    const fromAddress =
      this.opts.fromName && this.opts.fromName.length > 0
        ? `"${this.opts.fromName}" <${this.opts.from}>`
        : this.opts.from;
    try {
      await this.opts.transporter.sendMail({
        from: fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    } catch (err) {
      throw new EmailSendError(sanitizeEmailError(err, this.scrubSecrets));
    }
  }

  /** Release the underlying transporter's resources (pooled SMTP connections). */
  close(): void {
    this.opts.transporter.close?.();
  }
}

/**
 * Error thrown by all senders on failure, carrying an already-sanitized
 * message. The worker stores `err.message` directly into `lastError`.
 */
export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}

/**
 * Build the SMTP transporter options nodemailer expects from a
 * {@link SmtpOptions} config block. Centralized so config→transport mapping
 * has exactly one definition and the TLS knobs are explicit.
 */
function buildNodemailerTransport(smtp: SmtpOptions): Record<string, unknown> {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth:
      smtp.user || smtp.password
        ? { user: smtp.user, pass: smtp.password }
        : undefined,
    requireTLS: smtp.requireTls,
    tls: {
      rejectUnauthorized: smtp.tlsRejectUnauthorized,
      ...(smtp.tlsServername ? { servername: smtp.tlsServername } : {}),
    },
    connectionTimeout: smtp.connectionTimeoutMs,
    greetingTimeout: smtp.greetingTimeoutMs,
    socketTimeout: smtp.socketTimeoutMs,
  };
}

/**
 * Select the active sender from runtime config (M3 transport selection):
 *
 * | Condition                                    | Sender              |
 * | -------------------------------------------- | ------------------- |
 * | `enabled === false`                          | DisabledEmailSender |
 * | `enabled && transport === "fake"`            | FakeEmailSender     |
 * | `enabled && transport === "smtp"`            | SmtpEmailSender     |
 *
 * Invalid configuration fails fast: `smtp` transport without an SMTP host,
 * or `smtp` with no SMTP options, throws before any send is attempted.
 */
export function createEmailSender(config: EmailSenderConfig): EmailSender {
  if (!config.enabled) {
    return new DisabledEmailSender();
  }
  if (config.transport === "fake") {
    return new FakeEmailSender(config.fakeMode);
  }
  if (config.transport === "smtp") {
    if (!config.smtp || !config.smtp.host || config.smtp.host.length === 0) {
      throw new Error("EMAIL_TRANSPORT=smtp requires SMTP_HOST to be set");
    }
    const transporter = nodemailer.createTransport(
      buildNodemailerTransport(config.smtp) as Parameters<
        typeof nodemailer.createTransport
      >[0],
    );
    return new SmtpEmailSender({
      from: config.from,
      fromName: config.fromName,
      transporter,
      // The SMTP password is the one secret the SMTP sender knows; scrubbing
      // it from any provider-echoed error text is the sanitizer's job.
      scrubSecrets: [config.smtp.password],
    });
  }
  throw new Error(
    `Unsupported EMAIL_TRANSPORT value: ${String(config.transport)}`,
  );
}
