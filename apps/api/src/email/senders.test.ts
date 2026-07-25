import { type Transporter } from "nodemailer";
import { describe, expect, it } from "vitest";
import {
  DisabledEmailSender,
  FakeEmailSender,
  SmtpEmailSender,
  createEmailSender,
  type EmailSenderConfig,
} from "./senders.js";

/**
 * A recording transporter: captures the payload handed to `sendMail` so tests
 * can assert exactly what the sender passed to the transport, without any
 * network and without relying on nodemailer's `info` shape.
 */
function recordingTransporter(capture: Record<string, unknown>[]): Transporter {
  return {
    sendMail: (mail: Record<string, unknown>) => {
      capture.push(mail);
      return Promise.resolve({ messageId: "rec-1" });
    },
    close() {},
  } as unknown as Transporter;
}

/** A config snippet used for the disabled/fake factory cases. */
const baseConfig = (
  overrides: Partial<EmailSenderConfig>,
): EmailSenderConfig => ({
  enabled: false,
  transport: "fake",
  from: "no-reply@example.local",
  fromName: "Exam Platform",
  fakeMode: "success",
  smtp: null,
  ...overrides,
});

describe("DisabledEmailSender", () => {
  it("send resolves with providerMessageId null", async () => {
    const sender = new DisabledEmailSender();
    const result = await sender.send({
      to: "x@example.com",
      subject: "s",
      text: "t",
    });
    expect(result).toEqual({ providerMessageId: null });
  });
});

describe("FakeEmailSender", () => {
  it("success mode resolves with providerMessageId null", async () => {
    const result = await new FakeEmailSender("success").send({
      to: "x@example.com",
      subject: "s",
      text: "t",
    });
    expect(result).toEqual({ providerMessageId: null });
  });

  it("failure mode rejects with the fixed message", async () => {
    await expect(
      new FakeEmailSender("failure").send({
        to: "x@example.com",
        subject: "s",
        text: "t",
      }),
    ).rejects.toThrow("Fake email sender failure");
  });
});

describe("SmtpEmailSender", () => {
  it("sends the expected from/to/subject/text/html via the transport and returns the messageId", async () => {
    const captured: Record<string, unknown>[] = [];
    const sender = new SmtpEmailSender({
      from: "no-reply@example.local",
      fromName: "Exam Platform",
      transporter: recordingTransporter(captured),
    });
    const result = await sender.send({
      to: "to@example.com",
      subject: "Hello",
      text: "Body text",
      html: "<b>Body text</b>",
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      to: "to@example.com",
      subject: "Hello",
      text: "Body text",
      html: "<b>Body text</b>",
    });
    expect(result).toEqual({ providerMessageId: "rec-1" });
  });

  it("passes fromName as an object From (safe header formatting) when set", async () => {
    const captured: Record<string, unknown>[] = [];
    const sender = new SmtpEmailSender({
      from: "no-reply@example.local",
      fromName: "Exam Platform",
      transporter: recordingTransporter(captured),
    });
    await sender.send({ to: "to@example.com", subject: "s", text: "t" });
    // nodemailer accepts `{ name, address }` for `from`; it handles the
    // RFC 5322 formatting / escaping itself, which avoids header injection
    // when fromName contains quotes or commas.
    expect(captured[0]?.from).toEqual({
      name: "Exam Platform",
      address: "no-reply@example.local",
    });
  });

  it("falls back to a bare from address when fromName is unset", async () => {
    const captured: Record<string, unknown>[] = [];
    const sender = new SmtpEmailSender({
      from: "no-reply@example.local",
      transporter: recordingTransporter(captured),
    });
    await sender.send({ to: "to@example.com", subject: "s", text: "t" });
    expect(captured[0]?.from).toBe("no-reply@example.local");
  });

  it("sanitizes a transport failure (no password leak) and rethrows", async () => {
    const SECRET = "super-secret-password-123";
    // Transporter.sendMail returns a rejected Promise (the nodemailer
    // Promise-style API). The SmtpEmailSender must sanitize the rejection.
    const failingTransporter = {
      sendMail: () =>
        Promise.reject(
          Object.assign(new Error(`auth failed for ${SECRET}`), {
            code: "EAUTH",
            responseCode: 535,
          }),
        ),
      close() {},
    } as unknown as Transporter;
    const sender = new SmtpEmailSender({
      from: "no-reply@example.local",
      transporter: failingTransporter,
      scrubSecrets: [SECRET],
    });
    // The thrown sanitized error must contain the SMTP code but NOT the password.
    await expect(
      sender.send({ to: "to@example.com", subject: "s", text: "t" }),
    ).rejects.toSatisfy((err: Error) => {
      expect(err.message).not.toContain(SECRET);
      expect(err.message).toContain("EAUTH");
      return true;
    });
  });

  it("returns null messageId when sendMail succeeds without a messageId", async () => {
    const transporter = {
      sendMail: () => Promise.resolve({}),
      close() {},
    } as unknown as Transporter;
    const sender = new SmtpEmailSender({
      from: "no-reply@example.local",
      transporter,
    });
    const result = await sender.send({
      to: "to@example.com",
      subject: "s",
      text: "t",
    });
    expect(result).toEqual({ providerMessageId: null });
  });

  it("rejects when the transport indicates the single recipient was rejected", async () => {
    const transporter = {
      sendMail: () =>
        Promise.resolve({
          messageId: "some-id",
          accepted: [],
          rejected: ["to@example.com"],
        }),
      close() {},
    } as unknown as Transporter;
    const sender = new SmtpEmailSender({
      from: "no-reply@example.local",
      transporter,
    });
    await expect(
      sender.send({ to: "to@example.com", subject: "s", text: "t" }),
    ).rejects.toThrow("was rejected by the SMTP server");
  });
});

describe("createEmailSender (factory)", () => {
  it("returns DisabledEmailSender when disabled", () => {
    expect(
      createEmailSender(baseConfig({ enabled: false })).constructor.name,
    ).toBe("DisabledEmailSender");
  });

  it("returns FakeEmailSender when enabled + transport fake", () => {
    expect(
      createEmailSender(
        baseConfig({ enabled: true, transport: "fake", fakeMode: "success" }),
      ).constructor.name,
    ).toBe("FakeEmailSender");
  });

  it("returns SmtpEmailSender when enabled + transport smtp (with valid config)", () => {
    const sender = createEmailSender(
      baseConfig({
        enabled: true,
        transport: "smtp",
        smtp: {
          host: "smtp.example.com",
          port: 587,
          secure: false,
          user: "u",
          password: "p",
          requireTls: true,
          tlsRejectUnauthorized: true,
          tlsServername: null,
          connectionTimeoutMs: 10000,
          greetingTimeoutMs: 10000,
          socketTimeoutMs: 10000,
        },
      }),
    );
    expect(sender.constructor.name).toBe("SmtpEmailSender");
  });

  it("throws on smtp transport without a host", () => {
    expect(() =>
      createEmailSender(
        baseConfig({
          enabled: true,
          transport: "smtp",
          smtp: {
            host: "",
            port: 587,
            secure: false,
            user: "u",
            password: "p",
            requireTls: true,
            tlsRejectUnauthorized: true,
            tlsServername: null,
            connectionTimeoutMs: 10000,
            greetingTimeoutMs: 10000,
            socketTimeoutMs: 10000,
          },
        }),
      ),
    ).toThrow();
  });
});
