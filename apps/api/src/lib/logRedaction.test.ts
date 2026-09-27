import { Writable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ResponseSerializationError,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {
  SENSITIVE_LOG_PATHS,
  REDACT_CONFIG,
  serializeErrorForLog,
} from "./logRedaction.js";
import { setupErrorHandler } from "../plugins/errors.js";

/** Marker standing in for a frozen standard answer leaked into an error. */
const ANSWER_MARKER = "SECRET-standard-answer-4c7e";

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
    // Identity/classification survive: code, error type, stack.
    expect(errLine).toContain("FST_ERR_RESPONSE_SERIALIZATION");
    expect(errLine).toContain("ResponseSerializationError");
    expect(errLine).toContain("stack");
    // ZodError cause is reduced to classification, not dropped wholesale.
    expect(errLine).toContain("ZodError");
  });

  it("drops details payloads but keeps message, code and statusCode", () => {
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
    expect(out.message).toBe("题目不存在");
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
    expect(out.message).toBe("Failed to persist attempt grade");
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
    expect(json).toContain("ZodError");
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
    expect(out.type).toBe("Object");
    expect(JSON.stringify(out)).not.toContain("SECRET-marker-not-copied");
  });

  it("server.ts wires the whitelist serializer into the production logger", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../server.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("serializers: { err: serializeErrorForLog }");
  });
});
