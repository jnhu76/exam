import { describe, expect, it } from "vitest";
import {
  EMAIL_ENV_KEYS,
  emailEnvContract,
  resolveEmailEnv,
  resolveEmailEnvFrom,
  validateEmailEnvContract,
  type EmailEnvEntry,
} from "./emailEnvContract.js";

/**
 * Independent membership oracle: the exact 24-key production cluster. This
 * list is the frozen boundary of the Phase C experiment (Issue #367). Adding
 * a 25th Email key intentionally fails this test until the contract, the
 * Compose projection, and the independent behavior tests/docs are reviewed —
 * it is NOT derived from the contract.
 */
const EXPECTED_KEYS = [
  "EMAIL_ENABLED",
  "EMAIL_TRANSPORT",
  "EMAIL_FAKE_MODE",
  "EMAIL_FAKE_DELAY_MS",
  "EMAIL_FROM",
  "EMAIL_FROM_NAME",
  "EMAIL_MAX_ATTEMPTS",
  "EMAIL_RETRY_BASE_SECONDS",
  "EMAIL_WORKER_POLL_INTERVAL_MS",
  "EMAIL_WORKER_BATCH_SIZE",
  "EMAIL_WORKER_LOCK_TIMEOUT_MS",
  "EMAIL_WORKER_HEARTBEAT_STALE_MS",
  "EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_REQUIRE_TLS",
  "SMTP_TLS_REJECT_UNAUTHORIZED",
  "SMTP_TLS_SERVERNAME",
  "SMTP_CONNECTION_TIMEOUT_MS",
  "SMTP_GREETING_TIMEOUT_MS",
  "SMTP_SOCKET_TIMEOUT_MS",
  "SMTP_USER",
  "SMTP_PASSWORD",
] as const;

describe("emailEnvContract membership", () => {
  it("covers exactly the 24-key production Email cluster", () => {
    expect([...EMAIL_ENV_KEYS].sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it("has unique keys (no duplicates)", () => {
    const keys = [...EMAIL_ENV_KEYS];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every entry targets the app deployment target", () => {
    for (const key of EMAIL_ENV_KEYS) {
      expect(emailEnvContract[key].target, key).toBe("app");
    }
  });

  it("every entry has a supported primitive kind", () => {
    const supported = new Set([
      "booleanTruthy",
      "boolean",
      "positiveInt",
      "nonNegativeInt",
      "string",
      "secretString",
      "enum",
    ]);
    for (const key of EMAIL_ENV_KEYS) {
      expect(supported.has(emailEnvContract[key].kind), key).toBe(true);
    }
  });

  it("kinds classify the cluster as frozen (no accidental reclassification)", () => {
    const kindOf = (key: (typeof EXPECTED_KEYS)[number]) =>
      emailEnvContract[key].kind;
    // Strict booleans
    for (const key of [
      "SMTP_SECURE",
      "SMTP_REQUIRE_TLS",
      "SMTP_TLS_REJECT_UNAUTHORIZED",
    ] as const) {
      expect(kindOf(key), key).toBe("boolean");
    }
    expect(kindOf("EMAIL_ENABLED")).toBe("booleanTruthy");
    // Numeric
    for (const key of [
      "EMAIL_MAX_ATTEMPTS",
      "EMAIL_RETRY_BASE_SECONDS",
      "EMAIL_WORKER_POLL_INTERVAL_MS",
      "EMAIL_WORKER_BATCH_SIZE",
      "EMAIL_WORKER_LOCK_TIMEOUT_MS",
      "EMAIL_WORKER_HEARTBEAT_STALE_MS",
      "EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS",
      "SMTP_PORT",
      "SMTP_CONNECTION_TIMEOUT_MS",
      "SMTP_GREETING_TIMEOUT_MS",
      "SMTP_SOCKET_TIMEOUT_MS",
    ] as const) {
      expect(kindOf(key), key).toBe("positiveInt");
    }
    expect(kindOf("EMAIL_FAKE_DELAY_MS")).toBe("nonNegativeInt");
    // Enums
    expect(kindOf("EMAIL_TRANSPORT")).toBe("enum");
    expect(kindOf("EMAIL_FAKE_MODE")).toBe("enum");
    // Strings
    for (const key of [
      "EMAIL_FROM",
      "EMAIL_FROM_NAME",
      "SMTP_HOST",
      "SMTP_TLS_SERVERNAME",
    ] as const) {
      expect(kindOf(key), key).toBe("string");
    }
    for (const key of ["SMTP_USER", "SMTP_PASSWORD"] as const) {
      expect(kindOf(key), key).toBe("secretString");
    }
  });

  it("defaults have the correct primitive representation per kind", () => {
    for (const key of EMAIL_ENV_KEYS) {
      const entry = emailEnvContract[key];
      switch (entry.kind) {
        case "booleanTruthy":
        case "boolean":
          expect(typeof entry.default, key).toBe("boolean");
          break;
        case "positiveInt":
        case "nonNegativeInt":
          expect(typeof entry.default, key).toBe("number");
          expect(Number.isInteger(entry.default), key).toBe(true);
          break;
        case "string":
        case "secretString":
        case "enum":
          expect(typeof entry.default, key).toBe("string");
          break;
      }
    }
  });

  it("enum entries carry non-empty values that contain their default", () => {
    for (const key of EMAIL_ENV_KEYS) {
      const entry = emailEnvContract[key];
      if (entry.kind !== "enum") continue;
      expect(entry.values, key).toBeDefined();
      expect(entry.values!.length, key).toBeGreaterThan(0);
      expect(entry.values!.includes(String(entry.default)), key).toBe(true);
    }
  });
});

// ── Fail-loud contract validation ────────────────────────────────────────
describe("validateEmailEnvContract fail-loud", () => {
  const GOOD: Readonly<Record<string, EmailEnvEntry>> = {
    FAKE_PORT: { kind: "positiveInt", default: 1234, target: "app" },
    FAKE_BOOL: { kind: "boolean", default: true, target: "app" },
  };

  it("accepts a valid contract", () => {
    expect(() => validateEmailEnvContract(GOOD)).not.toThrow();
  });

  it("rejects an unsupported kind", () => {
    expect(() =>
      validateEmailEnvContract({
        ...GOOD,
        // @ts-expect-error deliberate bad kind for the fail-loud test
        FAKE_URL: { kind: "url", default: "x", target: "app" },
      }),
    ).toThrow(/unsupported kind/);
  });

  it("rejects an unsupported deployment target", () => {
    expect(() =>
      validateEmailEnvContract({
        ...GOOD,
        // @ts-expect-error deliberate bad target for the fail-loud test
        FAKE_TOP: { kind: "string", default: "", target: "db" },
      }),
    ).toThrow(/unsupported deployment target/);
  });

  it("rejects a positiveInt whose default is a string", () => {
    expect(() =>
      validateEmailEnvContract({
        ...GOOD,
        FAKE_BAD: { kind: "positiveInt", default: "587", target: "app" },
      }),
    ).toThrow(/default must be a positive integer/);
  });

  it("rejects a boolean whose default is not a boolean", () => {
    expect(() =>
      validateEmailEnvContract({
        ...GOOD,
        FAKE_BAD: { kind: "boolean", default: "true", target: "app" },
      }),
    ).toThrow(/default must be a boolean/);
  });

  it("rejects a nonNegativeInt with a negative default", () => {
    expect(() =>
      validateEmailEnvContract({
        ...GOOD,
        FAKE_BAD: { kind: "nonNegativeInt", default: -1, target: "app" },
      }),
    ).toThrow(/default must be a non-negative integer/);
  });

  it("rejects an enum whose default is outside its values", () => {
    expect(() =>
      validateEmailEnvContract({
        ...GOOD,
        FAKE_MODE: {
          kind: "enum",
          default: "auto",
          values: ["manual"],
          target: "app",
        },
      }),
    ).toThrow(/values containing its default/);
  });

  it("rejects an enum without values", () => {
    expect(() =>
      validateEmailEnvContract({
        ...GOOD,
        FAKE_MODE: { kind: "enum", default: "auto", target: "app" },
      }),
    ).toThrow(/values containing its default/);
  });
});

// ── Resolver with SYNTHETIC fixtures ─────────────────────────────────────
// Mechanism is tested against synthetic contract fixtures so the helper tests
// never duplicate production Email defaults (see Issue #367 Phase C §15).
const SYNTHETIC: Readonly<Record<string, EmailEnvEntry>> = {
  FAKE_PORT: { kind: "positiveInt", default: 1234, target: "app" },
  FAKE_COUNT: { kind: "nonNegativeInt", default: 0, target: "app" },
  FAKE_TLS: { kind: "boolean", default: true, target: "app" },
  FAKE_SWITCH: { kind: "booleanTruthy", default: false, target: "app" },
  FAKE_NAME: { kind: "string", default: "hello world", target: "app" },
  FAKE_SECRET: { kind: "secretString", default: "", target: "app" },
  FAKE_MODE: {
    kind: "enum",
    default: "auto",
    values: ["auto", "manual"],
    target: "app",
  },
};

function resolveSynthetic(env: Record<string, string>, key: string) {
  return resolveEmailEnvFrom(SYNTHETIC, env, key);
}

describe("resolveEmailEnvFrom synthetic fixtures", () => {
  it("positiveInt: defaults, overrides, whitespace, strict failures", () => {
    expect(resolveSynthetic({}, "FAKE_PORT")).toBe(1234);
    expect(resolveSynthetic({ FAKE_PORT: "2525" }, "FAKE_PORT")).toBe(2525);
    expect(resolveSynthetic({ FAKE_PORT: " 2525 " }, "FAKE_PORT")).toBe(2525);
    expect(() => resolveSynthetic({ FAKE_PORT: "" }, "FAKE_PORT")).toThrow();
    expect(() => resolveSynthetic({ FAKE_PORT: "abc" }, "FAKE_PORT")).toThrow();
    expect(() => resolveSynthetic({ FAKE_PORT: "-5" }, "FAKE_PORT")).toThrow();
    expect(() =>
      resolveSynthetic({ FAKE_PORT: "10.5" }, "FAKE_PORT"),
    ).toThrow();
  });

  it("nonNegativeInt: zero allowed, negative rejected", () => {
    expect(resolveSynthetic({}, "FAKE_COUNT")).toBe(0);
    expect(resolveSynthetic({ FAKE_COUNT: "0" }, "FAKE_COUNT")).toBe(0);
    expect(resolveSynthetic({ FAKE_COUNT: "7" }, "FAKE_COUNT")).toBe(7);
    // Empty string coerces to 0 and is accepted (mirrors the pre-contract
    // nonNegativeIntSchema behavior for EMAIL_FAKE_DELAY_MS).
    expect(resolveSynthetic({ FAKE_COUNT: "" }, "FAKE_COUNT")).toBe(0);
    expect(() =>
      resolveSynthetic({ FAKE_COUNT: "-1" }, "FAKE_COUNT"),
    ).toThrow();
  });

  it("boolean: strict true/false, default, invalid rejected", () => {
    expect(resolveSynthetic({}, "FAKE_TLS")).toBe(true);
    expect(resolveSynthetic({ FAKE_TLS: "false" }, "FAKE_TLS")).toBe(false);
    expect(resolveSynthetic({ FAKE_TLS: "true" }, "FAKE_TLS")).toBe(true);
    expect(() => resolveSynthetic({ FAKE_TLS: "yes" }, "FAKE_TLS")).toThrow();
    expect(() => resolveSynthetic({ FAKE_TLS: "1" }, "FAKE_TLS")).toThrow();
    expect(() => resolveSynthetic({ FAKE_TLS: "" }, "FAKE_TLS")).toThrow();
  });

  it("booleanTruthy: lenient true/1, everything else false, never throws", () => {
    expect(resolveSynthetic({}, "FAKE_SWITCH")).toBe(false);
    expect(resolveSynthetic({ FAKE_SWITCH: "true" }, "FAKE_SWITCH")).toBe(true);
    expect(resolveSynthetic({ FAKE_SWITCH: "1" }, "FAKE_SWITCH")).toBe(true);
    expect(resolveSynthetic({ FAKE_SWITCH: "TRUE" }, "FAKE_SWITCH")).toBe(
      false,
    );
    expect(resolveSynthetic({ FAKE_SWITCH: "yes" }, "FAKE_SWITCH")).toBe(false);
    expect(resolveSynthetic({ FAKE_SWITCH: "" }, "FAKE_SWITCH")).toBe(false);
  });

  it("string: trimmed, default when unset", () => {
    expect(resolveSynthetic({}, "FAKE_NAME")).toBe("hello world");
    expect(resolveSynthetic({ FAKE_NAME: "  x y  " }, "FAKE_NAME")).toBe("x y");
    expect(resolveSynthetic({ FAKE_NAME: "" }, "FAKE_NAME")).toBe("");
  });

  it("secretString: verbatim, never trimmed", () => {
    expect(resolveSynthetic({}, "FAKE_SECRET")).toBe("");
    expect(resolveSynthetic({ FAKE_SECRET: "  keep  " }, "FAKE_SECRET")).toBe(
      "  keep  ",
    );
  });

  it("enum: trimmed membership, invalid rejected, default when unset", () => {
    expect(resolveSynthetic({}, "FAKE_MODE")).toBe("auto");
    expect(resolveSynthetic({ FAKE_MODE: "manual" }, "FAKE_MODE")).toBe(
      "manual",
    );
    expect(resolveSynthetic({ FAKE_MODE: "  manual  " }, "FAKE_MODE")).toBe(
      "manual",
    );
    expect(() =>
      resolveSynthetic({ FAKE_MODE: "auto-manual" }, "FAKE_MODE"),
    ).toThrow(/one of: auto, manual/);
  });

  it("rejects an unknown contract key", () => {
    expect(() => resolveSynthetic({}, "NOPE")).toThrow(
      /Unknown Email env contract key/,
    );
  });
});

// ── Production resolver spot checks (hard-coded expected values) ─────────
// These are independent oracles — they intentionally do NOT read expected
// values from the contract (Issue #367 §6).
describe("resolveEmailEnv production cluster", () => {
  it("resolves typed values for representative keys", () => {
    expect(resolveEmailEnv({}, "SMTP_PORT")).toBe(587);
    expect(resolveEmailEnv({}, "SMTP_REQUIRE_TLS")).toBe(true);
    expect(resolveEmailEnv({}, "EMAIL_ENABLED")).toBe(false);
    expect(resolveEmailEnv({}, "EMAIL_TRANSPORT")).toBe("fake");
    expect(resolveEmailEnv({}, "EMAIL_FAKE_MODE")).toBe("success");
    expect(resolveEmailEnv({}, "EMAIL_FROM")).toBe("no-reply@example.local");
    expect(resolveEmailEnv({}, "EMAIL_MAX_ATTEMPTS")).toBe(3);
    expect(resolveEmailEnv({}, "EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS")).toBe(8000);
  });

  it("a temporarily changed contract default breaks this independent oracle", () => {
    // Proof the contract cannot silently redefine product semantics: if the
    // SMTP_PORT semantic default ever changes, this hard-coded expectation
    // must fail until a human reviews it (Phase C mutation experiment).
    expect(resolveEmailEnv({}, "SMTP_PORT")).toBe(587);
  });
});
