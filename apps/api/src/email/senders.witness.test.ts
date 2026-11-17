import { type Transporter } from "nodemailer";
import { describe, expect, it } from "vitest";
import { SmtpEmailSender } from "./senders.js";

/**
 * #1012 RED witnesses for `SmtpEmailSender` — the ① layer of the exit chain:
 * provider error → EmailSendError message. The transporter is injected (the
 * repo's own seam, senders.test.ts) so no network or real SMTP is touched;
 * the rejection SHAPES are what production nodemailer produces.
 *
 * The thrown EmailSendError.message is the exact string that
 * outboxService.ts:124 / routes/email.ts:81 persist or serve, so a marker in
 * it is a marker in every downstream sink.
 *
 * No `scrubSecrets` is passed on purpose: the caller only knows its OWN
 * configured password — a provider echoing any OTHER secret must still be
 * contained by the policy itself.
 */

const M_SQL = "RED1012-SELECT-grade-FROM-attempts";
const M_BIND = "RED1012-bind-$1::uuid";
const M_SECRET = "RED1012-smtp-secret-9f1zq";
const M_RCPT = "red1012-candidate@example.invalid";
const M_CODE = "RED1012-EAUTH";
const M_COMMAND = "RED1012-CMD-AUTH-PLAIN";
const M_RESPONSE = "RED1012-535-auth-failed-for-remote";
const M_RESPONSE_CODE = "RED1012-rc-535";

function rejectingTransporter(reason: unknown): Transporter {
  return {
    sendMail: () => Promise.reject(reason),
    close() {},
  } as unknown as Transporter;
}

async function sendMessageError(reason: unknown): Promise<string> {
  const sender = new SmtpEmailSender({
    from: "no-reply@example.local",
    transporter: rejectingTransporter(reason),
  });
  try {
    await sender.send({
      to: "witness@example.local",
      subject: "s",
      text: "t",
    });
    throw new Error("expected send() to reject");
  } catch (err) {
    if (!(err instanceof Error)) {
      throw new Error(`expected Error, got: ${String(err)}`);
    }
    return err.message;
  }
}

describe("SmtpEmailSender — #1012 RED witnesses", () => {
  it("witness: nodemailer-shaped provider error free text survives into EmailSendError.message", async () => {
    const message = await sendMessageError(
      Object.assign(
        new Error(
          `provider echoed: sql=${M_SQL} bind=${M_BIND} secret=${M_SECRET} rcpt=${M_RCPT}`,
        ),
        {
          code: M_CODE,
          command: M_COMMAND,
          response: M_RESPONSE,
          responseCode: M_RESPONSE_CODE,
        },
      ),
    );
    const leaked = [
      M_SQL,
      M_BIND,
      M_SECRET,
      M_RCPT,
      M_CODE,
      M_COMMAND,
      M_RESPONSE,
      M_RESPONSE_CODE,
    ].filter((m) => message.includes(m));
    expect(
      leaked,
      `markers survived into EmailSendError.message: ${leaked.join(", ")}\nmessage: ${message}`,
    ).toEqual([]);
  });

  it("witness: a rejected single recipient's address survives into EmailSendError.message", async () => {
    const transporter = {
      sendMail: () =>
        Promise.resolve({
          messageId: "some-id",
          accepted: [],
          rejected: [M_RCPT],
        }),
      close() {},
    } as unknown as Transporter;
    const sender = new SmtpEmailSender({
      from: "no-reply@example.local",
      transporter,
    });
    let message = "";
    try {
      await sender.send({ to: M_RCPT, subject: "s", text: "t" });
      throw new Error("expected send() to reject");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(
      message,
      "recipient address must not persist into the delivery-failure reason",
    ).not.toContain(M_RCPT);
  });

  it("witness: a plain string rejection survives into EmailSendError.message", async () => {
    const message = await sendMessageError(
      `SMTP banner dump: ${M_SQL} ${M_SECRET}`,
    );
    const leaked = [M_SQL, M_SECRET].filter((m) => message.includes(m));
    expect(
      leaked,
      `markers leaked from string rejection: ${leaked.join(", ")}\nmessage: ${message}`,
    ).toEqual([]);
  });

  it("witness: a plain-object rejection with custom toString() survives into EmailSendError.message", async () => {
    const message = await sendMessageError({
      toString() {
        return `provider payload: ${M_BIND} rcpt=${M_RCPT}`;
      },
    });
    const leaked = [M_BIND, M_RCPT].filter((m) => message.includes(m));
    expect(
      leaked,
      `markers leaked via toString(): ${leaked.join(", ")}\nmessage: ${message}`,
    ).toEqual([]);
  });
});
