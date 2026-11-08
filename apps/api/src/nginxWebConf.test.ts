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

/**
 * Active (non-comment) config text only: the commented HTTPS template must
 * never satisfy the guards for the ACTIVE vhost — if the active
 * access_log/error_log lines are removed, the guards must go red while the
 * template stays intact (architecture-review finding: the earlier
 * whole-file regexes matched the template's commented copy and masked
 * exactly that regression).
 */
function activeConfig(confText: string): string {
  return confText
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

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
    const active = activeConfig(conf);
    expect(logFormatBody(active)).not.toBeNull();
    const name = /log_format\s+(\S+)/.exec(active)?.[1];
    expect(name).toBeTruthy();
    expect(active).toMatch(new RegExp(`access_log\\s+\\S+\\s+${name};`));
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
    expect(tpl).toMatch(/error_log\s+\S+\s+error;/);
    const routePlaceholders = tpl.match(/set \$exam_route/g) ?? [];
    expect(routePlaceholders.length).toBeGreaterThanOrEqual(2);
    expect(tpl).not.toMatch(/\$request([^_a-zA-Z]|$)/);
    expect(tpl).not.toMatch(/\$request_uri/);
  });

  it("the vhost error_log keeps native error-level diagnostics (Owner Decision A)", () => {
    // #925 live witness: nginx core quotes the FULL request line (with
    // query) in error-level messages, e.g. upstream resolution failures.
    // Owner Decision A accepts that raw-URL exposure so a self-managed
    // deployment keeps nginx's native fault diagnostics; `crit` would
    // suppress them and is banned. This is a SEPARATE claim from the
    // access-log privacy pins above — never merge the two into one
    // "no raw URLs in nginx logs" statement. Active config only — the
    // commented template has its own pin below.
    expect(activeConfig(conf)).toMatch(/error_log\s+\S+\s+error;/);
    expect(activeConfig(conf)).not.toMatch(/error_log\s+\S+\s+crit;/);
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
