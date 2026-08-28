import nodemailer, { type Transporter } from "nodemailer";
import type { EmailMessage, EmailSender, EmailSendResult } from "@exam/domain";
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
  /** Simulated transport latency for the fake sender (0 = immediate). */
  fakeDelayMs?: number;
  smtp: SmtpOptions | null;
}

/**
 * No-op sender used when `EMAIL_ENABLED=false`. Never throws, never touches
 * the network. Safe default so a disabled deployment cannot accidentally send.
 */
export class DisabledEmailSender implements EmailSender {
  async send(_message: EmailMessage): Promise<EmailSendResult> {
    return { providerMessageId: null };
  }
}

/**
 * Deterministic fake sender for tests and local dev. `success` always
 * resolves; `failure` always rejects with a fixed message so `lastError` is
 * assertable. Never touches the network. `delayMs` simulates transport
 * latency before resolving/rejecting (0 = immediate).
 */
export class FakeEmailSender implements EmailSender {
  constructor(
    private readonly mode: EmailFakeMode,
    private readonly delayMs = 0,
  ) {}
  async send(_message: EmailMessage): Promise<EmailSendResult> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.mode === "failure") {
      throw new EmailSendError("Fake email sender failure");
    }
    return { providerMessageId: null };
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

  async send(message: EmailMessage): Promise<EmailSendResult> {
    // Pass `from` as an object when a display name is set: nodemailer then
    // handles the address/name formatting (and any necessary escaping) itself,
    // which is safer than interpolating fromName into an RFC 5322 string and
    // avoids header-format issues if fromName contains quotes/commas.
    const fromAddress =
      this.opts.fromName && this.opts.fromName.length > 0
        ? { name: this.opts.fromName, address: this.opts.from }
        : this.opts.from;
    try {
      const info = await this.opts.transporter.sendMail({
        from: fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
      // Inspect the SendInfo result: extract messageId, and check accepted/rejected
      // for single-recipient sends.
      const messageId =
        info && typeof info.messageId === "string" && info.messageId.length > 0
          ? info.messageId
          : null;

      // Check accepted/rejected for single-recipient sends
      if (
        info &&
        Array.isArray(info.rejected) &&
        info.rejected.length > 0 &&
        info.rejected.includes(message.to)
      ) {
        throw new EmailSendError(
          `Recipient ${message.to} was rejected by the SMTP server`,
        );
      }

      return { providerMessageId: messageId };
    } catch (err) {
      if (err instanceof EmailSendError) {
        throw err;
      }
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
    return new FakeEmailSender(config.fakeMode, config.fakeDelayMs ?? 0);
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
