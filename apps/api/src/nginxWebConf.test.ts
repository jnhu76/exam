/**
 * #925 nginx access-log privacy pin: the production edge config
 * (deploy/nginx/web.conf — baked into the web image as
 * /etc/nginx/conf.d/default.conf) must declare an explicit access-log
 * format and that format must never contain the raw request line, the raw
 * request URI, or the un-normalized path. Without an explicit log_format,
 * nginx falls back to the `combined` format whose `$request` persists full
 * URLs including query strings (the audit's finding).
 *
 * This is a drift guard over the config TEXT; syntax and runtime behavior
 * are separately verified with `nginx -t` against the deployed image
 * (recorded in the PR evidence), not here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const conf = readFileSync(
  join(process.cwd(), "..", "..", "deploy", "nginx", "web.conf"),
  "utf8",
);

/** Extracts the body of the `log_format <name> ...;` directive. */
function logFormatBody(confText: string): string | null {
  const m = /log_format\s+\S+\s+([\s\S]*?);/.exec(confText);
  return m ? m[1]! : null;
}

/**
 * The commented HTTPS activation template with comment markers stripped —
 * the documented operator path (docs/deployment/README.md) is to uncomment
 * this block into an overriding conf. Asserting on the uncommented shape
 * pins that activated HTTPS keeps the same privacy directives; without them
 * the 443 vhost would inherit the http-level combined format and re-open
 * the token-in-query leak (#925 security review, P2).
 */
function httpsTemplateBody(): string {
  const start = conf.indexOf("# server {");
  expect(start).toBeGreaterThan(-1);
  return conf
    .slice(start)
    .split("\n")
    .map((line) => line.replace(/^#\s?/, ""))
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

describe("nginx access-log privacy pin (#925)", () => {
  it("declares an explicit log_format and uses it for access_log", () => {
    expect(logFormatBody(conf)).not.toBeNull();
    const name = /log_format\s+(\S+)/.exec(conf)?.[1];
    expect(name).toBeTruthy();
    expect(conf).toMatch(new RegExp(`access_log\\s+\\S+\\s+${name};`));
  });

  it("the log format never contains the raw request line, request URI, or raw path", () => {
    const body = logFormatBody(conf)!;
    // `$request` NOT followed by `_` (so $request_method/_time stay legal).
    expect(body).not.toMatch(/\$request([^_a-zA-Z]|$)/);
    expect(body).not.toMatch(/\$request_uri/);
    expect(body).not.toMatch(/\$uri([^_a-zA-Z]|$)/);
    // No credential-bearing client headers.
    expect(body).not.toMatch(/\$http_(referer|cookie|authorization)/i);
  });

  it("the documented HTTPS activation template carries the same privacy directives", () => {
    const tpl = httpsTemplateBody();
    expect(tpl).toMatch(/access_log\s+\S+\s+exam_privacy;/);
    expect(tpl).toMatch(/error_log\s+\S+\s+crit;/);
    const routePlaceholders = tpl.match(/set \$exam_route/g) ?? [];
    expect(routePlaceholders.length).toBeGreaterThanOrEqual(2);
    expect(tpl).not.toMatch(/\$request([^_a-zA-Z]|$)/);
    expect(tpl).not.toMatch(/\$request_uri/);
  });

  it("the vhost error_log is filtered to crit (request-line quoting lives at error level)", () => {
    // Live witness (#925): an upstream-resolution failure logged the FULL
    // request line with query at error level. crit+ keeps catastrophic
    // failures; the access log carries the 5xx story instead.
    expect(conf).toMatch(/error_log\s+\S+\s+crit;/);
  });

  it("the log format keeps the safe diagnostic fields", () => {
    const body = logFormatBody(conf)!;
    expect(body).toMatch(/\$request_method/);
    expect(body).toMatch(/\$status/);
    expect(body).toMatch(/\$request_time/);
    // Server-controlled correlation: the X-Request-Id the Fastify upstream
    // stamped on the response (ADR-025 UUIDv4) — never nginx's own
    // $request_id and never a client-supplied request header.
    expect(body).toMatch(/\$sent_http_x_request_id/);
    expect(body).not.toMatch(/\$request_id/);
  });
});
