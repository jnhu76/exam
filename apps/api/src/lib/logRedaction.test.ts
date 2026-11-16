import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Fastify, {
  type FastifyInstance,
  type LightMyRequestResponse,
} from "fastify";
import { z } from "zod";
import { DrizzleQueryError } from "drizzle-orm/errors";
import {
  ResponseSerializationError,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {
  SENSITIVE_LOG_PATHS,
  REDACT_CONFIG,
  REDACTED_ERROR_MESSAGE,
  serializeErrorForLog,
  routeTemplateOf,
  serializeReqForLog,
  UNROUTED_LOG_PLACEHOLDER,
} from "./logRedaction.js";
import { setupErrorHandler } from "../plugins/errors.js";
import { setupRequestIdHeader } from "../plugins/requestIdHeader.js";

/** Marker standing in for a frozen standard answer leaked into an error. */
const ANSWER_MARKER = "SECRET-standard-answer-4c7e";

/**
 * #998 synthetic, mutually distinct leak witnesses. They stand in for the
 * data-derived payloads that must never reach a log line: SQL text fragments,
 * bound parameter values, raw URL path/query bytes, and spoofed identity
 * fields. Never real user data.
 */
const SQL_MARKER = "SQL-synth-table-column-9f31";
const PARAM_MARKER = "PARAM-synth-bound-value-6b02";
const URL_MARKER = "URL-synth-path-query-3d77";
const NAME_MARKER = "NAME-synth-identifier-5c19";
const CODE_MARKER = "CODE-synth-value-8e40";

/** pino emits numeric levels; 50 is `error`. */
const PINO_LEVEL_ERROR = 50;

/**
 * Builds a payload with one marker value at every declared sensitive path
 * (dot-paths become nesting), plus a control field that must survive.
 */
function payloadWithMarkers(paths: readonly string[]): {
  payload: Record<string, unknown>;
  markers: Map<string, string>;
  control: { key: string; value: string };
} {
  const control = { key: "requestId", value: "control-not-sensitive" };
  const markers = new Map<string, string>();
  const payload: Record<string, unknown> = { [control.key]: control.value };
  paths.forEach((path, i) => {
    const marker = `SECRET-${i}`;
    markers.set(path, marker);
    const parts = path.split(".");
    let node = payload;
    for (const part of parts.slice(0, -1)) {
      if (typeof node[part] !== "object" || node[part] === null) {
        node[part] = {};
      }
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]!] = marker;
  });
  return { payload, markers, control };
}

/** Same logger wiring shape as server.ts, with output captured in memory. */
async function withCapturingLogger(
  fn: (app: FastifyInstance, lines: string[]) => Promise<void>,
): Promise<string[]> {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const app = Fastify({
    logger: {
      level: "info",
      redact: REDACT_CONFIG,
      serializers: { err: serializeErrorForLog },
      stream,
    },
  });
  try {
    await fn(app, lines);
  } finally {
    await app.close();
  }
  return lines;
}

/** Logger options shape used by both harnesses (mirrors server.ts wiring). */
interface CapturedLoggerOptions {
  level: string;
  redact: typeof REDACT_CONFIG;
  serializers?: { err: typeof serializeErrorForLog };
}

/**
 * Runs a route whose handler returns a payload violating the declared Zod
 * response schema (a frozen standard answer where an option letter belongs).
 * This exercises the REAL production construction chain: type-provider
 * serializerCompiler -> ResponseSerializationError with the ZodError as
 * `cause` -> setupErrorHandler logging `{ err }` through pino.
 */
async function withSerializationFailureApp(
  loggerOptions: CapturedLoggerOptions,
  fn: (app: FastifyInstance, lines: string[]) => Promise<void>,
): Promise<string[]> {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const app = Fastify({ logger: { ...loggerOptions, stream } });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  setupErrorHandler(app);
  app.get(
    "/grading-details",
    {
      schema: {
        response: { 200: z.object({ expected: z.enum(["a", "b", "c"]) }) },
      },
    },
    async () => ({ expected: ANSWER_MARKER }),
  );
  try {
    await app.ready();
    const res = await fn(app, lines).then(() =>
      app.inject({ method: "GET", url: "/grading-details" }),
    );
    expect(res.statusCode).toBe(500);
  } finally {
    await app.close();
  }
  return lines;
}

describe("logRedaction", () => {
  // Vacuity canaries: the behavioral test below is data-driven from
  // SENSITIVE_LOG_PATHS, so an emptied list would pass silently without these.
  it("inventory still covers the critical field families", () => {
    expect(SENSITIVE_LOG_PATHS).toContain("password");
    expect(SENSITIVE_LOG_PATHS).toContain("passwordHash");
    expect(SENSITIVE_LOG_PATHS).toContain("token");
    expect(SENSITIVE_LOG_PATHS).toContain("authorization");
    expect(SENSITIVE_LOG_PATHS).toContain("req.headers.cookie");
    expect(SENSITIVE_LOG_PATHS).toContain("standardAnswer");
  });

  it("has no duplicate paths", () => {
    const unique = new Set(SENSITIVE_LOG_PATHS);
    expect(unique.size).toBe(SENSITIVE_LOG_PATHS.length);
  });

  it("pino removes every declared sensitive path from real log output", async () => {
    const { payload, markers, control } =
      payloadWithMarkers(SENSITIVE_LOG_PATHS);

    const lines = await withCapturingLogger(async (app, captured) => {
      app.get("/log-payload", async () => {
        app.log.info(payload);
        return { ok: true };
      });
      await app.ready();
      const res = await app.inject({ method: "GET", url: "/log-payload" });
      expect(res.statusCode).toBe(200);
      void captured;
    });

    const logged = lines.find((line) => line.includes(control.value));
    expect(logged, "payload log line captured").toBeDefined();

    // Behavioral core: every marker value is gone from the serialized output.
    for (const [path, marker] of markers) {
      expect(logged, `redacted: ${path}`).not.toContain(marker);
    }
    // The non-sensitive control field survives, proving the line was emitted.
    expect(logged).toContain(control.value);
  });
});

describe("err channel whitelist serializer (EXSEM-017 observability boundary)", () => {
  // Characterization canary pinning the premise the whitelist stands on:
  // pino's DEFAULT err serializer copies the whole wrapped error, so the
  // ZodError cause of a ResponseSerializationError lands verbatim in the log
  // (issues[].received, issues[].message and the aggregated message all carry
  // the rejected payload values). If this ever fails, the default behavior
  // changed and the whitelist's necessity needs re-examination.
  it("witness: default err serializer logs the wrapped payload verbatim", async () => {
    const lines = await withSerializationFailureApp(
      { level: "info", redact: REDACT_CONFIG },
      async () => {},
    );
    const leaked = lines.filter((line) => line.includes(ANSWER_MARKER));
    expect(
      leaked.length,
      "marker reaches the log via err.cause",
    ).toBeGreaterThan(0);
  });

  it("whitelist serializer keeps classification but strips wrapped payloads", async () => {
    const lines = await withSerializationFailureApp(
      {
        level: "info",
        redact: REDACT_CONFIG,
        serializers: { err: serializeErrorForLog },
      },
      async () => {},
    );

    const errLine = lines.find((line) =>
      line.includes("Response serialization error"),
    );
    expect(errLine, "error-handler log line captured").toBeDefined();
    for (const line of lines) {
      expect(line, "no marker anywhere in log output").not.toContain(
        ANSWER_MARKER,
      );
    }
    // Identity/classification survive as fixed labels plus the safe code;
    // raw message/stack do not (#998 policy).
    expect(errLine).toContain("FST_ERR_RESPONSE_SERIALIZATION");
    expect(errLine).toContain("response_serialization_error");
    expect(errLine).toContain("stack");
    // ZodError cause is reduced to its fixed classification label.
    expect(errLine).toContain("zod_error");
  });

  it("drops details payloads and raw text, keeps safe code and statusCode", () => {
    const err = Object.assign(new Error("题目不存在"), {
      code: "RESOURCE_NOT_FOUND",
      statusCode: 404,
      details: {
        fields: [{ field: "questionIds", standardAnswer: ANSWER_MARKER }],
      },
    });

    const out = serializeErrorForLog(err) as Record<string, unknown>;
    const json = JSON.stringify(out);
    expect(json).not.toContain(ANSWER_MARKER);
    // Authored text has no proven runtime trust source: the message is the
    // #998 constant, while registry codes and plausible statuses survive.
    expect(out.message).toBe(REDACTED_ERROR_MESSAGE);
    expect(out.code).toBe("RESOURCE_NOT_FOUND");
    expect(out.statusCode).toBe(404);
  });

  it("reduces cause chains to classification (no cause messages or row data)", () => {
    const root = Object.assign(
      new Error("duplicate key value violates unique constraint"),
      {
        code: "23505",
        detail: `Key (question_id)=("${ANSWER_MARKER}") already exists.`,
      },
    );
    const wrapped = new Error("Failed to persist attempt grade", {
      cause: root,
    });

    const out = serializeErrorForLog(wrapped) as Record<string, unknown>;
    const json = JSON.stringify(out);
    expect(json).not.toContain(ANSWER_MARKER);
    // Cause messages are data-derived and must not reach the log; the
    // SQLSTATE code survives for constraint diagnosis.
    expect(json).not.toContain("duplicate key value violates");
    expect((out.cause as { code?: string }).code).toBe("23505");
    expect(out.message).toBe(REDACTED_ERROR_MESSAGE);
  });

  it("handles the real ResponseSerializationError + ZodError shapes", () => {
    const parsed = z
      .object({ expected: z.enum(["a", "b", "c"]) })
      .safeParse({ expected: ANSWER_MARKER });
    const err = new ResponseSerializationError("GET", "/grading-details", {
      cause: parsed.error!,
    });

    const json = JSON.stringify(serializeErrorForLog(err));
    expect(json).not.toContain(ANSWER_MARKER);
    expect(json).toContain("FST_ERR_RESPONSE_SERIALIZATION");
    expect(json).toContain("response_serialization_error");
    expect(json).toContain("zod_error");
  });

  it("terminates on circular cause chains", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    const b: Error & { cause?: unknown } = new Error("b", { cause: a });
    a.cause = b;
    expect(() => JSON.stringify(serializeErrorForLog(a))).not.toThrow();
  });

  it("reduces non-Error err values to a type marker without copying contents", () => {
    const plain = { code: "X", info: "SECRET-marker-not-copied" };
    const out = serializeErrorForLog(plain) as Record<string, unknown>;
    // #998 review round 2: the marker derives from typeof checks only, never
    // from the input's constructor.name.
    expect(out.type).toBe("object");
    expect(JSON.stringify(out)).not.toContain("SECRET-marker-not-copied");
  });

  it("server.ts wires the whitelist serializer into the production logger", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../server.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain(
      "serializers: { req: serializeReqForLog, err: serializeErrorForLog }",
    );
  });
});

describe("#998 data-derived error payloads must not reach the err channel", () => {
  interface CapturedRequestRun {
    res: LightMyRequestResponse;
    lines: string[];
    /** Whole captured output — chunk boundaries are not line boundaries. */
    joined: string;
    parsed: Array<Record<string, unknown>>;
  }

  /**
   * Production-shaped wiring for request-driven witnesses: the same err/req
   * serializers, redact config, UUID genReqId + `requestIdHeader: false`
   * (server-owned request ids), the real error handler and the x-request-id
   * hook — only the stdout destination is swapped for an in-memory stream.
   */
  async function captureRequestError(
    register: (app: FastifyInstance) => void,
    url: string,
    headers?: Record<string, string>,
  ): Promise<CapturedRequestRun> {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = Fastify({
      genReqId: () => randomUUID(),
      requestIdHeader: false,
      logger: {
        level: "info",
        redact: REDACT_CONFIG,
        serializers: { req: serializeReqForLog, err: serializeErrorForLog },
        stream,
      },
    });
    setupRequestIdHeader(app);
    setupErrorHandler(app);
    register(app);
    try {
      await app.ready();
      const res = await app.inject({
        method: "GET",
        url,
        ...(headers === undefined ? {} : { headers }),
      });
      const joined = lines.join("");
      const parsed = joined
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      return { res, lines, joined, parsed };
    } finally {
      await app.close();
    }
  }

  function lineByMsg(
    parsed: Array<Record<string, unknown>>,
    msg: string,
  ): Record<string, unknown> | undefined {
    return parsed.find((entry) => entry.msg === msg);
  }

  it("unhandled 500: DrizzleQueryError SQL and bound params never reach the log", async () => {
    // 42P01 (undefined_table) is a real SQLSTATE that isConstraintError does
    // NOT map to 409, so the request reaches the unhandled-500 branch under
    // test instead of the conflict branch.
    const driverCause = Object.assign(
      new Error(`synthetic driver failure ${PARAM_MARKER}`),
      { code: "42P01" },
    );
    const boom = new DrizzleQueryError(
      `select marker from exams where code = ${SQL_MARKER}`,
      [PARAM_MARKER, "second-synthetic-bind"],
      driverCause,
    );

    const run = await captureRequestError((app) => {
      app.get("/db-failure", async () => {
        throw boom;
      });
    }, "/db-failure");

    // Log existence first: absent markers must not mean absent logs.
    expect(run.res.statusCode).toBe(500);
    const errLine = lineByMsg(run.parsed, "Unhandled request error");
    expect(errLine, "unhandled-error log line captured").toBeDefined();
    expect(errLine!.level).toBe(PINO_LEVEL_ERROR);
    // Request correlation survives: pino's reqId is the server-owned header.
    expect(errLine!.reqId).toEqual(run.res.headers["x-request-id"]);

    expect(run.joined).not.toContain(SQL_MARKER);
    expect(run.joined).not.toContain(PARAM_MARKER);

    // Fixed-label classification and usable SQLSTATE diagnosis survive.
    const err = errLine!.err as Record<string, unknown>;
    expect(err.type).toBe("drizzle_query_error");
    expect(err.message).toBe(REDACTED_ERROR_MESSAGE);
    expect(err.stack).toBe("");
    expect((err.cause as { code?: string }).code).toBe("42P01");
    expect((err.cause as { type?: string }).type).toBe("error");
  });

  it("multi-line messages and custom stacks are withheld whole, first line included", async () => {
    const boom = new Error(
      `grading context ${SQL_MARKER}\nrow payload ${PARAM_MARKER}`,
    );
    boom.stack = `SyntheticOuter: ${SQL_MARKER}\n    at inner (${PARAM_MARKER}:12:34)`;

    const run = await captureRequestError((app) => {
      app.get("/multiline-failure", async () => {
        throw boom;
      });
    }, "/multiline-failure");

    expect(run.res.statusCode).toBe(500);
    expect(
      lineByMsg(run.parsed, "Unhandled request error"),
      "unhandled-error log line captured",
    ).toBeDefined();
    expect(run.joined).not.toContain(SQL_MARKER);
    expect(run.joined).not.toContain(PARAM_MARKER);
  });

  it("markers cannot ride through the name, code or statusCode fields", async () => {
    const boom = Object.assign(new Error("plain"), {
      name: NAME_MARKER,
      code: CODE_MARKER,
      statusCode: `500-${NAME_MARKER}`,
    });

    const run = await captureRequestError((app) => {
      app.get("/field-pollution", async () => {
        throw boom;
      });
    }, "/field-pollution");

    expect(run.res.statusCode).toBe(500);
    expect(
      lineByMsg(run.parsed, "Unhandled request error"),
      "unhandled-error log line captured",
    ).toBeDefined();
    expect(run.joined).not.toContain(NAME_MARKER);
    expect(run.joined).not.toContain(CODE_MARKER);

    // Non-whitelisted field values are structurally absent, and identity
    // fields fall back to the fixed generic label.
    const err = (
      lineByMsg(run.parsed, "Unhandled request error") as {
        err: Record<string, unknown>;
      }
    ).err;
    expect(err.name).toBe("error");
    expect(err.type).toBe("error");
    expect("code" in err).toBe(false);
    expect("statusCode" in err).toBe(false);
  });

  it("error-borne fields and client headers cannot spoof the request id", async () => {
    const boom = Object.assign(new Error("plain"), {
      requestId: URL_MARKER,
      reqId: URL_MARKER,
    });

    const run = await captureRequestError(
      (app) => {
        app.get("/spoof-reqid", async () => {
          throw boom;
        });
      },
      "/spoof-reqid",
      { "x-request-id": "forged-client-value" },
    );

    expect(run.res.statusCode).toBe(500);
    const errLine = lineByMsg(run.parsed, "Unhandled request error");
    expect(errLine, "unhandled-error log line captured").toBeDefined();
    expect(errLine!.reqId).not.toBe("forged-client-value");
    expect(errLine!.reqId).toEqual(run.res.headers["x-request-id"]);
    expect(run.joined).not.toContain(URL_MARKER);
  });

  it("response serialization failure: rejected answer values and the raw URL stay out of the log", async () => {
    const run = await captureRequestError((app) => {
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      app.get(
        "/grade/:attemptId",
        {
          schema: {
            response: { 200: z.object({ expected: z.enum(["a", "b"]) }) },
          },
        },
        async () => ({ expected: ANSWER_MARKER }),
      );
    }, `/grade/${URL_MARKER}?token=${URL_MARKER}`);

    expect(run.res.statusCode).toBe(500);
    const errLine = lineByMsg(run.parsed, "Response serialization error");
    expect(errLine, "serialization-failure log line captured").toBeDefined();
    expect(errLine!.level).toBe(PINO_LEVEL_ERROR);
    expect(run.joined).not.toContain(ANSWER_MARKER);
    expect(run.joined).not.toContain(URL_MARKER);

    // Safe classification survives: the framework code and the fixed labels
    // for the wrapper and its ZodError cause.
    const err = errLine!.err as Record<string, unknown>;
    expect(err.code).toBe("FST_ERR_RESPONSE_SERIALIZATION");
    expect(err.type).toBe("response_serialization_error");
    expect((err.cause as { type?: string }).type).toBe("zod_error");
  });

  it("multi-layer wrappers keep only safe classification at every cause level", () => {
    const leaf = Object.assign(new Error(`driver detail ${SQL_MARKER}`), {
      code: "42P01",
    });
    const mid = new DrizzleQueryError(
      `select marker ${SQL_MARKER}`,
      [PARAM_MARKER],
      leaf,
    );
    const top = new Error("wrapper", { cause: mid });

    const json = JSON.stringify(serializeErrorForLog(top));
    expect(json).not.toContain(SQL_MARKER);
    expect(json).not.toContain(PARAM_MARKER);

    // Labels at every level; the recognized SQLSTATE survives at the leaf.
    const out = serializeErrorForLog(top) as Record<string, unknown>;
    expect(out.type).toBe("error");
    expect((out.cause as { type?: string }).type).toBe("drizzle_query_error");
    expect((out.cause as { cause?: { code?: string } }).cause?.code).toBe(
      "42P01",
    );
  });

  it("deep cause chains end at the fixed truncation marker without echoing layer text", () => {
    let err: Error = Object.assign(new Error("leaf"), { code: "23505" });
    for (let i = 0; i < 8; i++) {
      err = new Error(`layer-${i}-context`, { cause: err });
    }
    const json = JSON.stringify(serializeErrorForLog(err));
    expect(json).toContain("[cause chain truncated]");
    expect(json).not.toContain("layer-");
  });

  it("serializing never mutates the original error", () => {
    const cause = Object.assign(new Error("cause text"), { code: "23505" });
    const boom = new Error("top text", { cause });
    const stackBefore = boom.stack;

    serializeErrorForLog(boom);

    expect(boom.message).toBe("top text");
    expect(boom.stack).toBe(stackBefore);
    expect(boom.cause).toBe(cause);
    expect(cause.message).toBe("cause text");
    expect(cause.code).toBe("23505");
  });

  // ── review round 2: non-Error values must not leak via constructor.name ──

  it("non-Error values never leak a spoofed constructor.name, at top level, as cause, or through the real request chain", async () => {
    // Unit: crafted top-level value whose constructor.name carries the marker.
    const crafted = { constructor: { name: NAME_MARKER } };
    const out = serializeErrorForLog(crafted);
    expect(JSON.stringify(out)).not.toContain(NAME_MARKER);
    expect(out.type).toBe("object");

    // Unit: same crafted value as a cause.
    const wrapped = new Error("top", {
      cause: { constructor: { name: NAME_MARKER } },
    });
    expect(JSON.stringify(serializeErrorForLog(wrapped))).not.toContain(
      NAME_MARKER,
    );

    // Unit: a constructor.name that is an object with toJSON, plus a toJSON
    // on the value itself — neither may be copied or invoked.
    const boobyTrapped = {
      constructor: { name: { toJSON: () => NAME_MARKER } },
      toJSON: () => NAME_MARKER,
    };
    expect(JSON.stringify(serializeErrorForLog(boobyTrapped))).not.toContain(
      NAME_MARKER,
    );

    // Unit: array cause reduces to a fixed label without copying entries.
    const withArrayCause = new Error("top", { cause: [NAME_MARKER] });
    expect(JSON.stringify(serializeErrorForLog(withArrayCause))).not.toContain(
      NAME_MARKER,
    );

    // Real Fastify/Pino chain: non-Error cause on an unhandled 500.
    const run = await captureRequestError((app) => {
      app.get("/non-error-cause", async () => {
        throw new Error("top", {
          cause: { constructor: { name: NAME_MARKER } },
        });
      });
    }, "/non-error-cause");
    expect(run.res.statusCode).toBe(500);
    expect(
      run.parsed.some((entry) => entry.msg === "Unhandled request error"),
      "unhandled-error log line captured",
    ).toBe(true);
    expect(run.joined).not.toContain(NAME_MARKER);

    // Real chain: a crafted plain object thrown directly (top-level err).
    const run2 = await captureRequestError((app) => {
      app.get("/thrown-object", async () => {
        throw { constructor: { name: NAME_MARKER }, code: CODE_MARKER };
      });
    }, "/thrown-object");
    expect(run2.res.statusCode).toBe(500);
    expect(
      run2.parsed.some((entry) => entry.msg === "Unhandled request error"),
      "unhandled-error log line captured",
    ).toBe(true);
    expect(run2.joined).not.toContain(NAME_MARKER);
    expect(run2.joined).not.toContain(CODE_MARKER);
  });

  // ── review round 2: classification lookup must not hit the prototype chain ──

  it("prototype-chain keys (constructor/name) cannot break the fixed-label classification", () => {
    for (const poisoned of [
      "__proto__",
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
    ]) {
      const byName = Object.assign(new Error("plain"), { name: poisoned });
      const outByName = serializeErrorForLog(byName) as Record<string, unknown>;
      expect(outByName.type, `name=${poisoned}`).toBe("error");
      expect(outByName.name, `name=${poisoned}`).toBe("error");

      const byConstructorName = Object.assign(new Error("plain"), {
        constructor: { name: poisoned },
      });
      const outByCtor = serializeErrorForLog(byConstructorName) as Record<
        string,
        unknown
      >;
      expect(outByCtor.type, `constructor.name=${poisoned}`).toBe("error");
      expect(outByCtor.name, `constructor.name=${poisoned}`).toBe("error");

      // The identity fields survive JSON serialization as strings.
      expect(JSON.stringify(outByName)).toContain('"type":"error"');
      expect(JSON.stringify(outByCtor)).toContain('"name":"error"');
    }
  });
});

describe("#925 routeTemplateOf / serializeReqForLog", () => {
  it("returns the matched route template when routed", () => {
    expect(
      routeTemplateOf({ routeOptions: { url: "/api/exams/:id/start" } }),
    ).toBe("/api/exams/:id/start");
  });

  it("returns the fixed placeholder when unrouted — never a raw pathname", () => {
    expect(routeTemplateOf({ routeOptions: null })).toBe(
      UNROUTED_LOG_PLACEHOLDER,
    );
    expect(routeTemplateOf({})).toBe(UNROUTED_LOG_PLACEHOLDER);
  });

  it("serializeReqForLog emits server-observed facts only (no url/host)", () => {
    const out = serializeReqForLog({
      method: "POST",
      routeOptions: { url: "/api/auth/login" },
      ip: "10.0.0.9",
      socket: { remotePort: 51234 },
    });
    expect(out).toEqual({
      method: "POST",
      route: "/api/auth/login",
      remoteAddress: "10.0.0.9",
      remotePort: 51234,
    });
    expect(Object.keys(out)).not.toContain("url");
  });
});
