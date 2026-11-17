import { describe, expect, it } from "vitest";
import { sanitizeEmailError } from "./sanitizeError.js";

/**
 * #1012 RED witnesses for `sanitizeEmailError` — the shared privacy policy
 * owner for every email error exit (senders.ts:176, outboxService.ts:124,
 * routes/email.ts:81).
 *
 * Every marker below is SYNTHETIC (no real credential, recipient, or SMTP
 * server). The witnesses assert the CONTRACT the #1012 fix must establish:
 * provider-echoed free text (SQL, bind params, SMTP secrets that are NOT the
 * caller-known password, recipients, body content, candidate answers) must
 * never survive into the sanitized output, and hostile shapes (throwing
 * getters, circular causes, toJSON/toString tricks) must neither leak nor
 * throw into the business flow.
 *
 * On the UNFIXED baseline these leak/throw assertions FAIL — that is the RED
 * evidence. Guard cases that already hold are labeled GUARD; they pin the
 * boundary the fix must not regress.
 */

// ── Synthetic markers ───────────────────────────────────────────────
const M_SQL = "RED1012-SELECT-grade-FROM-attempts";
const M_BIND = "RED1012-bind-$1::uuid";
const M_SECRET = "RED1012-smtp-secret-9f1zq"; // deliberately NOT shaped like password=/pass=/bearer=
const M_RCPT = "red1012-candidate@example.invalid";
const M_BODY = "RED1012-body-Your-grade-is-72";
const M_ANSWER = "RED1012-answer-B";
const M_CODE = "RED1012-EAUTH";
const M_COMMAND = "RED1012-CMD-AUTH-PLAIN";
const M_RESPONSE = "RED1012-535-auth-failed-for-remote";
const M_RESPONSE_CODE = "RED1012-rc-535";
const M_NAME = "RED1012-PgError";
const M_STACK = "RED1012-STACK-FRAME-src/secret.ts:1:1";

const ALL_MARKERS = [
  M_SQL,
  M_BIND,
  M_SECRET,
  M_RCPT,
  M_BODY,
  M_ANSWER,
  M_CODE,
  M_COMMAND,
  M_RESPONSE,
  M_RESPONSE_CODE,
  M_NAME,
  M_STACK,
];

function leakedMarkers(output: string): string[] {
  return ALL_MARKERS.filter((m) => output.includes(m));
}

describe("sanitizeEmailError — #1012 RED witnesses", () => {
  it("witness: nodemailer-shaped Error free text (message/code/command/response/responseCode) survives into the output", () => {
    const err = Object.assign(
      new Error(
        `query failed: ${M_SQL} with ${M_BIND} for ${M_RCPT} body=${M_BODY} answer=${M_ANSWER} secret=${M_SECRET}`,
      ),
      {
        code: M_CODE,
        command: M_COMMAND,
        response: M_RESPONSE,
        responseCode: M_RESPONSE_CODE,
      },
    );
    const out = sanitizeEmailError(err);
    const leaked = leakedMarkers(out);
    expect(
      leaked,
      `markers leaked through sanitizeEmailError: ${leaked.join(", ")}\noutput: ${out}`,
    ).toEqual([]);
  });

  it("witness: a non-standard error name survives verbatim", () => {
    const err = new Error(`boom ${M_SQL}`);
    err.name = M_NAME;
    const out = sanitizeEmailError(err);
    expect(out, `output: ${out}`).not.toContain(M_NAME);
  });

  it("witness: a plain string rejection survives verbatim", () => {
    const out = sanitizeEmailError(
      `SMTP dialogue dump: ${M_SQL} ${M_BIND} ${M_SECRET}`,
    );
    const leaked = leakedMarkers(out);
    expect(
      leaked,
      `markers leaked from string rejection: ${leaked.join(", ")}\noutput: ${out}`,
    ).toEqual([]);
  });

  it("witness: a plain-object rejection with a custom toString() leaks its text", () => {
    const thrown = {
      toString() {
        return `provider payload: ${M_SQL} rcpt=${M_RCPT}`;
      },
    };
    const out = sanitizeEmailError(thrown);
    const leaked = leakedMarkers(out);
    expect(
      leaked,
      `markers leaked via toString(): ${leaked.join(", ")}\noutput: ${out}`,
    ).toEqual([]);
  });

  it("witness: a throwing `message` getter escapes the sanitizer into the business flow", () => {
    const hostile = new Error("placeholder");
    Object.defineProperty(hostile, "message", {
      get() {
        throw new Error(`getter exploded: ${M_SQL}`);
      },
    });
    let out: string | undefined;
    expect(() => {
      out = sanitizeEmailError(hostile);
    }).not.toThrow();
    expect(out ?? "", `output: ${out ?? "<threw>"}`).not.toContain(M_SQL);
  });

  // ── GUARD cases (hold on the baseline; the fix must not regress them) ──

  it("GUARD: plain object with toJSON but default toString does not leak and does not throw", () => {
    const thrown = {
      toJSON() {
        return { secret: M_SECRET, sql: M_SQL };
      },
    };
    const out = sanitizeEmailError(thrown);
    expect(typeof out).toBe("string");
    expect(out).not.toContain(M_SECRET);
    expect(out).not.toContain(M_SQL);
  });

  it("GUARD: circular cause chain neither leaks nor throws (cause is not walked)", () => {
    const root = new Error("connection failed");
    (root as { cause?: unknown }).cause = root; // self-referential
    const out = sanitizeEmailError(root);
    expect(typeof out).toBe("string");
  });

  it("GUARD: markers nested only inside `cause` do not leak via the cause chain", () => {
    const inner = new Error(`nested provider dump ${M_SQL} ${M_SECRET}`);
    const outer = new Error("outer failure");
    (outer as { cause?: unknown }).cause = inner;
    const out = sanitizeEmailError(outer);
    expect(out).not.toContain(M_SQL);
    expect(out).not.toContain(M_SECRET);
  });

  it("GUARD: a hand-crafted stack never reaches the output", () => {
    const err = new Error("boom");
    err.stack = `Error: boom\n    at ${M_STACK}`;
    const out = sanitizeEmailError(err);
    expect(out).not.toContain(M_STACK);
  });
});

describe("sanitizeEmailError — #1016 bounded cause inspection witnesses", () => {
  // #1016: the classifier now READS a bounded cause chain (code / responseCode
  // / cause only), so nested causes become a live attack surface. These
  // witnesses pin that the newly-read levels leak nothing: even when a
  // nested cause carries a recognizable allowlisted code, only the closed
  // classification is emitted — never the cause's free text.

  it("witness: nested cause free text never leaks even when the cause code is recognizable", () => {
    const inner = Object.assign(
      new Error(
        `db failure: ${M_SQL} with ${M_BIND} secret=${M_SECRET} rcpt=${M_RCPT}`,
      ),
      { code: "08006" },
    );
    const outer = new Error("drizzle wrapper failed");
    (outer as { cause?: unknown }).cause = inner;
    const out = sanitizeEmailError(outer);
    const leaked = leakedMarkers(out);
    expect(
      leaked,
      `markers leaked via cause inspection: ${leaked.join(", ")}\noutput: ${out}`,
    ).toEqual([]);
    // Operability is preserved: the SQLSTATE survives, only as classification.
    expect(out).toBe("email_error:db_connection_failed code=08006");
  });

  it("witness: a throwing `cause` getter carrying markers neither throws nor leaks", () => {
    const hostile = new Error("outer");
    Object.defineProperty(hostile, "cause", {
      get() {
        throw new Error(`getter exploded: ${M_SQL} ${M_SECRET}`);
      },
    });
    let out: string | undefined;
    expect(() => {
      out = sanitizeEmailError(hostile);
    }).not.toThrow();
    const leaked = leakedMarkers(out ?? "");
    expect(
      leaked,
      `markers leaked via throwing cause getter: ${leaked.join(", ")}\noutput: ${out ?? "<threw>"}`,
    ).toEqual([]);
    expect(out).toBe("email_error:internal_error");
  });

  it("witness: a throwing nested `code` getter carrying markers neither throws nor leaks", () => {
    const inner = new Error("inner");
    Object.defineProperty(inner, "code", {
      get() {
        throw new Error(`code getter: ${M_SQL} ${M_SECRET}`);
      },
    });
    const outer = new Error("outer");
    (outer as { cause?: unknown }).cause = inner;
    let out: string | undefined;
    expect(() => {
      out = sanitizeEmailError(outer);
    }).not.toThrow();
    const leaked = leakedMarkers(out ?? "");
    expect(
      leaked,
      `markers leaked via throwing code getter: ${leaked.join(", ")}\noutput: ${out ?? "<threw>"}`,
    ).toEqual([]);
    expect(out).toBe("email_error:internal_error");
  });

  it("witness: a circular cause chain carrying markers neither throws nor leaks", () => {
    const err = new Error(`circular carrier ${M_SQL} ${M_SECRET}`);
    (err as { cause?: unknown }).cause = err;
    let out: string | undefined;
    expect(() => {
      out = sanitizeEmailError(err);
    }).not.toThrow();
    const leaked = leakedMarkers(out ?? "");
    expect(
      leaked,
      `markers leaked via circular cause: ${leaked.join(", ")}\noutput: ${out ?? "<threw>"}`,
    ).toEqual([]);
    expect(out).toBe("email_error:internal_error");
  });
});
