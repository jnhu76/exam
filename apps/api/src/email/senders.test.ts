import { type Transporter } from "nodemailer";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DisabledEmailSender,
  FakeEmailSender,
  SmtpEmailSender,
  createEmailSender,
  type EmailSenderConfig,
} from "./senders.js";

/** Small bounded delay for polling a file the sender writes. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  it("failure mode rejects with the fixed safe classification", async () => {
    await expect(
      new FakeEmailSender("failure").send({
        to: "x@example.com",
        subject: "s",
        text: "t",
      }),
    ).rejects.toThrow("email_error:internal_error");
  });

  it("writes the send-entered witness BEFORE the simulated delay resolves (#482)", async () => {
    const witness = join(tmpdir(), `exam-fake-witness-${randomUUID()}`);
    try {
      let settled = false;
      const send = new FakeEmailSender("success", 500, witness).send({
        to: "x@example.com",
        subject: "s",
        text: "t",
      });
      void send.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      // The witness must appear while the delay is still in flight — that
      // ordering IS the happens-before contract the deployment test relies on.
      let appeared = false;
      for (let i = 0; i < 50 && !appeared; i += 1) {
        appeared = existsSync(witness);
        if (!appeared) await sleep(10);
      }
      expect(appeared).toBe(true);
      expect(settled).toBe(false);
      await send;
    } finally {
      rmSync(witness, { force: true });
    }
  });

  it("witness content records the writing process (pid + timestamp)", async () => {
    const witness = join(tmpdir(), `exam-fake-witness-${randomUUID()}`);
    try {
      await new FakeEmailSender("success", 0, witness).send({
        to: "x@example.com",
        subject: "s",
        text: "t",
      });
      expect(readFileSync(witness, "utf-8")).toContain(String(process.pid));
    } finally {
      rmSync(witness, { force: true });
    }
  });

  it("fails the send (not silently) when the witness path is unwritable, without leaking the path", async () => {
    // A regular file where a directory would be needed: mkdir/writes fail.
    // #1012: the send must still FAIL loudly (a silent witness miss would
    // hang a test) but the path never enters the error payload.
    const blocker = join(tmpdir(), `exam-fake-witness-blocker-${randomUUID()}`);
    writeFileSync(blocker, "not a directory");
    try {
      await expect(
        new FakeEmailSender("success", 0, join(blocker, "witness")).send({
          to: "x@example.com",
          subject: "s",
          text: "t",
        }),
      ).rejects.toSatisfy((err: Error) => {
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe("email_error:internal_error");
        expect(err.message).not.toContain(blocker);
        return true;
      });
    } finally {
      rmSync(blocker, { force: true, recursive: true });
    }
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

  it("classifies a transport failure and rethrows without the provider's free text", async () => {
    const SECRET = "super-secret-password-123";
    // Transporter.sendMail returns a rejected Promise (the nodemailer
    // Promise-style API). The SmtpEmailSender must classify the rejection —
    // the allowlisted SMTP code survives, the echoed password does not (the
    // caller does NOT have to know the secret for the policy to contain it).
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
    });
    await expect(
      sender.send({ to: "to@example.com", subject: "s", text: "t" }),
    ).rejects.toSatisfy((err: Error) => {
      expect(err.message).not.toContain(SECRET);
      expect(err.message).toBe(
        "email_error:smtp_auth_failed code=EAUTH rc=535",
      );
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

  it("rejects on a rejected recipient with a fixed category that keeps the address out", async () => {
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
    // Delivery-failure semantics preserved (still rejects — the outbox marks
    // retry/dead), but the recipient address never enters the payload.
    await expect(
      sender.send({ to: "to@example.com", subject: "s", text: "t" }),
    ).rejects.toSatisfy((err: Error) => {
      expect(err.message).toBe("email_error:smtp_recipient_rejected");
      expect(err.message).not.toContain("to@example.com");
      return true;
    });
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

  it("forwards fakeSendEnteredFile to the fake sender (witness written on send)", async () => {
    const witness = join(tmpdir(), `exam-fake-witness-${randomUUID()}`);
    try {
      const sender = createEmailSender(
        baseConfig({ enabled: true, fakeSendEnteredFile: witness }),
      );
      await sender.send({ to: "x@example.com", subject: "s", text: "t" });
      expect(existsSync(witness)).toBe(true);
    } finally {
      rmSync(witness, { force: true });
    }
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
