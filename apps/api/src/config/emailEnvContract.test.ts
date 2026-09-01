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
 * Compose projection, the runtime consumer, and the independent behavior
 * tests/docs are reviewed — it is NOT derived from the contract.
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

  it("classifies representative sensitive kinds", () => {
    // Independent spot oracles for the kind facts that most affect product
    // behavior. The full kind map lives in the contract (single authority)
    // and runtimeConfig.test.ts covers the end-to-end semantics.
    expect(emailEnvContract.EMAIL_ENABLED.kind).toBe("booleanTruthy");
    expect(emailEnvContract.SMTP_REQUIRE_TLS.kind).toBe("boolean");
    expect(emailEnvContract.EMAIL_FAKE_DELAY_MS.kind).toBe("nonNegativeInt");
    expect(emailEnvContract.SMTP_PASSWORD.kind).toBe("secretString");
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
  const GOOD: readonly EmailEnvEntry[] = [
    { key: "FAKE_PORT", kind: "positiveInt", default: 1234 },
    { key: "FAKE_BOOL", kind: "boolean", default: true },
  ];

  it("accepts a valid contract", () => {
    expect(() => validateEmailEnvContract(GOOD)).not.toThrow();
  });

  it("rejects a duplicate key (array form keeps both copies visible)", () => {
    expect(() =>
      validateEmailEnvContract([
        ...GOOD,
        { key: "FAKE_PORT", kind: "positiveInt", default: 1234 },
      ]),
    ).toThrow(/duplicate Email env contract key: FAKE_PORT/);
  });

  it("rejects an unsupported kind", () => {
    // @ts-expect-error deliberate bad kind for the fail-loud test
    const badEntry: EmailEnvEntry = { key: "K", kind: "url", default: "x" };
    expect(() => validateEmailEnvContract([...GOOD, badEntry])).toThrow(
      /unsupported kind/,
    );
  });

  const BAD_DEFAULTS: ReadonlyArray<{
    label: string;
    entry: EmailEnvEntry;
    error: RegExp;
  }> = [
    {
      label: "a positiveInt whose default is a string",
      entry: { key: "FAKE_BAD", kind: "positiveInt", default: "587" },
      error: /default must be a positive integer/,
    },
    {
      label: "a boolean whose default is not a boolean",
      entry: { key: "FAKE_BAD", kind: "boolean", default: "true" },
      error: /default must be a boolean/,
    },
    {
      label: "a nonNegativeInt with a negative default",
      entry: { key: "FAKE_BAD", kind: "nonNegativeInt", default: -1 },
      error: /default must be a non-negative integer/,
    },
    {
      label: "an enum whose default is outside its values",
      entry: {
        key: "FAKE_BAD",
        kind: "enum",
        default: "auto",
        values: ["manual"],
      },
      error: /values containing its default/,
    },
    {
      label: "an enum without values",
      entry: { key: "FAKE_BAD", kind: "enum", default: "auto" },
      error: /values containing its default/,
    },
  ];

  it.each(BAD_DEFAULTS)("rejects $label", ({ entry, error }) => {
    expect(() => validateEmailEnvContract([...GOOD, entry])).toThrow(error);
  });
});

// ── Resolver with SYNTHETIC fixtures ─────────────────────────────────────
// Mechanism is tested against synthetic contract fixtures so the helper tests
// never duplicate production Email defaults (see Issue #367 Phase C §15).
const SYNTHETIC: readonly EmailEnvEntry[] = [
  { key: "FAKE_PORT", kind: "positiveInt", default: 1234 },
  { key: "FAKE_COUNT", kind: "nonNegativeInt", default: 0 },
  { key: "FAKE_TLS", kind: "boolean", default: true },
  { key: "FAKE_SWITCH", kind: "booleanTruthy", default: false },
  { key: "FAKE_NAME", kind: "string", default: "hello world" },
  { key: "FAKE_SECRET", kind: "secretString", default: "" },
  {
    key: "FAKE_MODE",
    kind: "enum",
    default: "auto",
    values: ["auto", "manual"],
  },
];

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
// values from the contract (Issue #367 §6). The full semantic set is asserted
// by runtimeConfig.test.ts (the stronger end-semantic owner); this file keeps
// only the representative values the mutation experiment keys on.
describe("resolveEmailEnv production cluster", () => {
  it("resolves representative product semantics", () => {
    expect(resolveEmailEnv({}, "SMTP_PORT")).toBe(587);
    expect(resolveEmailEnv({}, "SMTP_REQUIRE_TLS")).toBe(true);
    expect(resolveEmailEnv({}, "EMAIL_ENABLED")).toBe(false);
    expect(resolveEmailEnv({}, "EMAIL_TRANSPORT")).toBe("fake");
    expect(resolveEmailEnv({}, "EMAIL_FAKE_MODE")).toBe("success");
  });

  it("a temporarily changed contract default breaks this independent oracle", () => {
    // Proof the contract cannot silently redefine product semantics: if the
    // SMTP_PORT semantic default ever changes, this hard-coded expectation
    // must fail until a human reviews it (Phase C mutation experiment).
    expect(resolveEmailEnv({}, "SMTP_PORT")).toBe(587);
  });
});
