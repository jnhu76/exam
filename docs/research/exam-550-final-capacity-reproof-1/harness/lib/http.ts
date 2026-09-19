/**
 * #550 harness HTTP layer (RESEARCH ONLY).
 *
 * Load driver law (02-methodology.md): real HTTP against the real stack,
 * per-candidate identity/session state, nothing hidden (all non-2xx, timeouts
 * and connection failures are recorded), no automatic retries.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

export interface SampleRecord {
  scenario_id: string;
  run_id: string;
  ts: string;
  candidate: string;
  endpoint: string;
  phase: string;
  status: number;
  latency_ms: number;
  error_class: string | null;
  timeout: boolean;
  retry_count: number;
  topology: string;
  n: number;
}

/** Buffered JSONL writer — flushes periodically so disk writes never sit on
 * the measurement path's critical section. */
export class JsonlWriter {
  private buf: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly path: string) {}
  write(record: unknown): void {
    this.buf.push(JSON.stringify(record));
    if (this.timer === null) {
      this.timer = setTimeout(() => void this.flush(), 250);
    }
  }
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buf.length === 0) return;
    const chunk = this.buf.join("\n") + "\n";
    this.buf = [];
    const { appendFileSync } = await import("node:fs");
    appendFileSync(this.path, chunk);
  }
}

export interface HttpResponse {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
  latencyMs: number;
  errorClass: string | null;
  timedOut: boolean;
}

export interface RequestResult extends HttpResponse {
  parsed: unknown;
}

/**
 * One virtual candidate (or admin/proctor) session. keepAlive with
 * maxSockets=1 models one browser connection per candidate; localAddress
 * binds a DISTINCT loopback source IP (Linux treats all of 127/8 as local)
 * so DIRECT_LAN exercises real per-candidate socket identities.
 */
export class Client {
  private cookie: string | null = null;
  private readonly agent: http.Agent;
  readonly id: string;

  constructor(
    private readonly opts: {
      baseUrl: string;
      id?: string;
      localAddress?: string;
      timeoutMs?: number;
      /** Value for the Origin header — required in production mode (CSRF). */
      origin?: string;
    },
  ) {
    this.id = opts.id ?? randomUUID();
    this.agent = new http.Agent({
      keepAlive: true,
      maxSockets: 1,
      keepAliveMsecs: 4000,
      maxFreeSockets: 1,
    });
  }

  setCookieFrom(headers: http.IncomingHttpHeaders): void {
    const set = headers["set-cookie"];
    if (!set) return;
    for (const c of set) {
      const m = /^auth-token=([^;]+)/.exec(c);
      if (m) this.cookie = m[1];
    }
  }

  get hasSession(): boolean {
    return this.cookie !== null;
  }

  request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<HttpResponse> {
    const started = performance.now();
    return new Promise((resolve) => {
      const url = new URL(path, this.opts.baseUrl);
      const payload =
        body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request(
        url,
        {
          method,
          agent: this.agent,
          localAddress: this.opts.localAddress,
          headers: {
            ...(payload === null
              ? {}
              : {
                  "content-type": "application/json",
                  "content-length": payload.length,
                }),
            ...(this.opts.origin === undefined
              ? {}
              : { origin: this.opts.origin }),
            ...(this.cookie === null
              ? {}
              : { cookie: `auth-token=${this.cookie}` }),
            ...extraHeaders,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
              headers: res.headers,
              latencyMs: performance.now() - started,
              errorClass: null,
              timedOut: false,
            });
          });
        },
      );
      req.setTimeout(this.opts.timeoutMs ?? 30_000, () => {
        req.destroy(new Error("client-timeout"));
      });
      req.on("error", (err: NodeJS.ErrnoException) => {
        const timedOut = err.message === "client-timeout";
        resolve({
          status: 0,
          body: "",
          headers: {},
          latencyMs: performance.now() - started,
          errorClass: timedOut
            ? "timeout"
            : (err.code ?? err.message).slice(0, 60),
          timedOut,
        });
      });
      if (payload !== null) req.write(payload);
      req.end();
    });
  }

  async json(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<RequestResult> {
    const res = await this.request(method, path, body, extraHeaders);
    let parsed: unknown = null;
    try {
      parsed = res.body.length > 0 ? JSON.parse(res.body) : null;
    } catch {
      parsed = null;
    }
    return { ...res, parsed };
  }

  async login(username: string, password: string): Promise<HttpResponse> {
    const res = await this.json("POST", "/api/auth/login", {
      username,
      password,
    });
    if (res.status === 200) this.setCookieFrom(res.headers);
    return res;
  }

  async close(): Promise<void> {
    this.agent.destroy();
  }
}

/** Outcome tally across a set of recorded results. */
export function tally(results: HttpResponse[]): {
  total: number;
  ok2xx: number;
  e4xx: number;
  e429: number;
  e5xx: number;
  timeouts: number;
  connErrors: number;
} {
  const out = {
    total: results.length,
    ok2xx: 0,
    e4xx: 0,
    e429: 0,
    e5xx: 0,
    timeouts: 0,
    connErrors: 0,
  };
  for (const r of results) {
    if (r.status >= 200 && r.status < 300) out.ok2xx += 1;
    else if (r.status === 429) out.e429 += 1;
    else if (r.status >= 400 && r.status < 500) out.e4xx += 1;
    else if (r.status >= 500) out.e5xx += 1;
    else if (r.timedOut) out.timeouts += 1;
    else if (r.status === 0) out.connErrors += 1;
  }
  out.timeouts += results.filter((r) => r.timedOut).length;
  return out;
}

export function errorClassOf(r: HttpResponse): string | null {
  if (r.errorClass === "timeout") return "timeout";
  if (r.errorClass !== null) return `conn:${r.errorClass}`;
  if (r.status === 429) return "rate_limited";
  if (r.status >= 500) return "server_5xx";
  if (r.status >= 400) return `http_${r.status}`;
  return null;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));
