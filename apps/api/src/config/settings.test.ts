import { describe, expect, it } from "vitest";
import {
  resolveSettings,
  settingsLeaves,
  SETTINGS,
  SettingsError,
} from "./settings.js";

/**
 * Independent behavioral oracle for the semantic settings model (#370).
 *
 * Expectations are HARDCODED product values (587, 30000, Asia/Shanghai, …) —
 * never read back from the model — so a semantic default change fails here
 * and forces human review, exactly like runtimeConfig.test.ts does for the
 * assembled config. Contract-level projection checks live in
 * scripts/repository-contract/config-contract.mjs, not here.
 */

const DEV = "development" as const;

describe("settings model shape", () => {
  it("exposes exactly the six semantic groups", () => {
    expect(Object.keys(SETTINGS)).toEqual([
      "auth",
      "app",
      "database",
      "redis",
      "email",
      "emailWorker",
    ]);
  });

  it("every leaf key equals its env name (the config ABI)", () => {
    for (const [groupName, group] of Object.entries(SETTINGS)) {
      for (const leafName of Object.keys(group)) {
        const leaf = settingsLeaves().get(leafName);
        expect(
          leaf,
          `${groupName}.${leafName} must be a registered leaf`,
        ).toBeDefined();
      }
    }
  });

  it("classifies secrets", () => {
    expect(settingsLeaves().get("JWT_SECRET")?.secret).toBe(true);
    expect(settingsLeaves().get("SMTP_PASSWORD")?.secret).toBe(true);
    expect(settingsLeaves().get("LAUNCHPAD_SETUP_TOKEN")?.secret).toBe(true);
    expect(settingsLeaves().get("SMTP_HOST")?.secret).toBe(false);
  });

  it("classifies production bindings", () => {
    const binding = (name: string) => settingsLeaves().get(name)?.binding;
    expect(binding("JWT_SECRET")).toBe("required");
    expect(binding("SMTP_PORT")).toBe("operator");
    expect(binding("PUBLIC_WEB_ORIGIN")).toBe("derived");
    expect(binding("CORS_ORIGIN")).toBe("derived");
    expect(binding("NODE_ENV")).toBe("container");
    expect(binding("APP_PORT")).toBe("container");
    expect(binding("VITE_PORT")).toBe("dev-only");
    expect(binding("DEV_API_PORT")).toBe("dev-only");
    expect(binding("DATABASE_URL")).toBe("composed");
    expect(binding("APP_MODE")).toBe("container");
  });

  it("documents raw defaults for the leaves that have one", () => {
    const raw = (name: string) => settingsLeaves().get(name)?.defaultRaw;
    expect(raw("SMTP_PORT")).toBe("587");
    expect(raw("APP_TIMEZONE")).toBe("Asia/Shanghai");
    expect(raw("EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS")).toBe("8000");
    expect(raw("HEARTBEAT_TIMEOUT_MS")).toBe("60000");
    expect(raw("COOKIE_SECURE")).toBe("false");
    expect(raw("SMTP_REQUIRE_TLS")).toBe("true");
    expect(raw("REDIS_STARTUP_TIMEOUT_MS")).toBe("8000");
    // Dependent / delegated leaves have no static default.
    expect(raw("DEADLINE_SCAN_INTERVAL_MS")).toBeNull();
    expect(raw("PUBLIC_WEB_ORIGIN")).toBeNull();
    expect(raw("DATABASE_URL")).toBeNull();
  });
});

describe("resolveSettings primitives", () => {
  it("returns every hardcoded product default in development", () => {
    const s = resolveSettings({}, DEV);
    expect(s.auth.JWT_SECRET).toBe("development-only-change-me");
    expect(s.app.HOST).toBe("0.0.0.0");
    expect(s.app.APP_TIMEZONE).toBe("Asia/Shanghai");
    expect(s.app.HEARTBEAT_SCAN_INTERVAL_MS).toBe(30000);
    expect(s.app.HEARTBEAT_TIMEOUT_MS).toBe(60000);
    expect(s.app.DEADLINE_SCAN_INTERVAL_MS).toBeUndefined();
    expect(s.app.RATE_LIMIT_MAX).toBe(100);
    expect(s.app.RATE_LIMIT_WINDOW_MS).toBe(60000);
    expect(s.app.COOKIE_SECURE).toBe(false);
    expect(s.app.VITE_PORT).toBe("5173");
    expect(s.redis.REDIS_URL).toBeNull();
    expect(s.redis.REDIS_MODE).toBeUndefined();
    expect(s.redis.REDIS_CONNECT_TIMEOUT_MS).toBe(2000);
    expect(s.redis.REDIS_COMMAND_TIMEOUT_MS).toBe(1000);
    expect(s.redis.REDIS_STARTUP_TIMEOUT_MS).toBe(8000);
    expect(s.email.EMAIL_TRANSPORT).toBe("fake");
    expect(s.email.EMAIL_FAKE_MODE).toBe("success");
    expect(s.email.EMAIL_FROM).toBe("no-reply@example.local");
    expect(s.email.EMAIL_FROM_NAME).toBe("Exam Platform");
    expect(s.email.SMTP_PORT).toBe(587);
    expect(s.email.SMTP_SECURE).toBe(false);
    expect(s.email.SMTP_REQUIRE_TLS).toBe(true);
    expect(s.email.SMTP_TLS_REJECT_UNAUTHORIZED).toBe(true);
    expect(s.email.SMTP_CONNECTION_TIMEOUT_MS).toBe(10000);
    expect(s.emailWorker.EMAIL_WORKER_POLL_INTERVAL_MS).toBe(5000);
    expect(s.emailWorker.EMAIL_WORKER_BATCH_SIZE).toBe(20);
    expect(s.emailWorker.EMAIL_WORKER_LOCK_TIMEOUT_MS).toBe(300000);
    expect(s.emailWorker.EMAIL_WORKER_HEARTBEAT_STALE_MS).toBe(60000);
    expect(s.emailWorker.EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS).toBe(8000);
  });

  it("treats set-but-empty values as unset (Compose ${KEY:-} forwards)", () => {
    const s = resolveSettings(
      {
        SMTP_PORT: "  ",
        APP_TIMEZONE: "",
        EMAIL_TRANSPORT: "",
        REDIS_URL: "   ",
        RATE_LIMIT_MAX: "",
        SMTP_REQUIRE_TLS: " ",
      },
      DEV,
    );
    expect(s.email.SMTP_PORT).toBe(587);
    expect(s.app.APP_TIMEZONE).toBe("Asia/Shanghai");
    expect(s.email.EMAIL_TRANSPORT).toBe("fake");
    expect(s.redis.REDIS_URL).toBeNull();
    expect(s.app.RATE_LIMIT_MAX).toBe(100);
    expect(s.email.SMTP_REQUIRE_TLS).toBe(true);
  });

  it("honors explicit values over defaults", () => {
    const s = resolveSettings(
      {
        SMTP_PORT: "2525",
        APP_TIMEZONE: "UTC",
        EMAIL_TRANSPORT: "smtp",
        REDIS_URL: "redis://localhost:6379",
        LAUNCHPAD_SETUP_TOKEN: "  tok  ",
      },
      DEV,
    );
    expect(s.email.SMTP_PORT).toBe(2525);
    expect(s.app.APP_TIMEZONE).toBe("UTC");
    expect(s.email.EMAIL_TRANSPORT).toBe("smtp");
    expect(s.redis.REDIS_URL).toBe("redis://localhost:6379");
    expect(s.app.LAUNCHPAD_SETUP_TOKEN).toBe("tok");
  });

  it("lenient ints fall back on garbage; strict ints throw", () => {
    const lenient = resolveSettings({ RATE_LIMIT_MAX: "abc" }, DEV);
    expect(lenient.app.RATE_LIMIT_MAX).toBe(100);
    expect(() => resolveSettings({ SMTP_PORT: "abc" }, DEV)).toThrow(
      SettingsError,
    );
    expect(() => resolveSettings({ EMAIL_FAKE_DELAY_MS: "-1" }, DEV)).toThrow(
      SettingsError,
    );
  });

  it("strict booleans reject anything but true/false", () => {
    expect(() => resolveSettings({ SMTP_SECURE: "yes" }, DEV)).toThrow(
      /SMTP_SECURE must be "true" or "false"/,
    );
    // Truthy booleans never throw — a typo means false, not startup death.
    expect(
      resolveSettings({ COOKIE_SECURE: "yes" }, DEV).app.COOKIE_SECURE,
    ).toBe(false);
    expect(resolveSettings({ COOKIE_SECURE: "1" }, DEV).app.COOKIE_SECURE).toBe(
      true,
    );
  });

  it("enums fail fast with the documented message shape", () => {
    expect(() => resolveSettings({ REDIS_MODE: "sometimes" }, DEV)).toThrow(
      /REDIS_MODE must be "off", "optional" or "required"/,
    );
    expect(() => resolveSettings({ EMAIL_TRANSPORT: "ses" }, DEV)).toThrow(
      /EMAIL_TRANSPORT must be "fake" or "smtp"/,
    );
    expect(() =>
      resolveSettings({ DEPLOYMENT_MODE: "multiTenant" }, DEV),
    ).toThrow(/Phase 1/);
    // The raw value must not leak for the deployment-mode misconfiguration.
    try {
      resolveSettings({ DEPLOYMENT_MODE: "secret-sensitive-value" }, DEV);
      throw new Error("expected throw");
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(
        "secret-sensitive-value",
      );
    }
  });

  it("validates IANA timezones against the runtime ICU database", () => {
    expect(
      resolveSettings({ APP_TIMEZONE: "America/New_York" }, DEV).app
        .APP_TIMEZONE,
    ).toBe("America/New_York");
    expect(() =>
      resolveSettings({ APP_TIMEZONE: "Not/A/Real/Zone" }, DEV),
    ).toThrow(/Invalid APP_TIMEZONE/);
  });

  it("validates PUBLIC_WEB_ORIGIN as an absolute origin when set", () => {
    expect(
      resolveSettings({ PUBLIC_WEB_ORIGIN: "http://localhost:3101" }, DEV).app
        .PUBLIC_WEB_ORIGIN,
    ).toBe("http://localhost:3101");
    // Trailing slashes are trimmed; paths/search are rejected.
    expect(
      resolveSettings({ PUBLIC_WEB_ORIGIN: "https://exam.corp/" }, DEV).app
        .PUBLIC_WEB_ORIGIN,
    ).toBe("https://exam.corp");
    expect(() =>
      resolveSettings({ PUBLIC_WEB_ORIGIN: "exam.corp" }, DEV),
    ).toThrow(/absolute origin/);
    expect(() =>
      resolveSettings({ PUBLIC_WEB_ORIGIN: "http://exam.corp/path" }, DEV),
    ).toThrow(/absolute origin/);
    // Unset in non-production stays undefined — the dev default is derived
    // from VITE_PORT by runtime policy (dependent default).
    expect(resolveSettings({}, DEV).app.PUBLIC_WEB_ORIGIN).toBeUndefined();
  });

  it("fails fast on production-required leaves, in the pinned order", () => {
    // JWT_SECRET → CORS_ORIGIN → PUBLIC_WEB_ORIGIN (historic precedence).
    expect(() => resolveSettings({}, "production")).toThrow(
      /JWT_SECRET is required in production/,
    );
    expect(() => resolveSettings({ JWT_SECRET: "s" }, "production")).toThrow(
      /CORS_ORIGIN is required in production/,
    );
    expect(() =>
      resolveSettings(
        { JWT_SECRET: "s", CORS_ORIGIN: "https://a" },
        "production",
      ),
    ).toThrow(/PUBLIC_WEB_ORIGIN is required in production/);
  });

  it("resolves optional ports to undefined so policy owns the fallback chain", () => {
    const unset = resolveSettings({}, "e2e");
    expect(unset.app.APP_PORT).toBeUndefined();
    expect(unset.app.DEV_API_PORT).toBeUndefined();
    expect(resolveSettings({ APP_PORT: "3000" }, "e2e").app.APP_PORT).toBe(
      3000,
    );
    expect(
      resolveSettings({ DEV_API_PORT: "3100" }, "e2e").app.DEV_API_PORT,
    ).toBe(3100);
    // Invalid port input is lenient (undefined → policy fallback), never a
    // startup failure.
    expect(
      resolveSettings({ APP_PORT: "not-a-port" }, "e2e").app.APP_PORT,
    ).toBeUndefined();
  });

  it("NODE_ENV maps leniently to the narrow env union", () => {
    expect(resolveSettings({ NODE_ENV: "production" }, DEV).app.NODE_ENV).toBe(
      "production",
    );
    expect(resolveSettings({ NODE_ENV: "test" }, DEV).app.NODE_ENV).toBe(
      "test",
    );
    expect(resolveSettings({ NODE_ENV: "staging" }, DEV).app.NODE_ENV).toBe(
      "development",
    );
    expect(resolveSettings({}, DEV).app.NODE_ENV).toBe("development");
  });

  it("delegated leaves resolve to undefined and never throw", () => {
    const s = resolveSettings(
      {
        DATABASE_URL: "postgresql://x",
        TEST_DATABASE_URL: "postgresql://t",
        APP_MODE: "production",
      },
      "development",
    );
    expect(s.database.DATABASE_URL).toBeUndefined();
    expect(s.database.TEST_DATABASE_URL).toBeUndefined();
    expect(s.app.APP_MODE).toBeUndefined();
  });
});
