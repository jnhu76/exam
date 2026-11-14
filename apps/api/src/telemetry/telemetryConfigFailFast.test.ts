import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRuntimeConfig,
  resetRuntimeConfigForTest,
} from "../config/runtimeConfig.js";
import { initTelemetry, isTelemetryActive } from "./runtime.js";

/**
 * Fail-fast oracle: an invalid TELEMETRY_* value is operator
 * misconfiguration and must propagate like every other settings leaf —
 * startup fails instead of silently running Off. Owns the process's single
 * init decision (see runtime.ts), hence its own file. The W6 otlp pair
 * guards are asserted through getRuntimeConfig (the single settings
 * consumption seam) — initTelemetry is one decision per process, so only
 * the first case below may exercise the init path itself.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  resetRuntimeConfigForTest();
});

describe("telemetry config fail-fast", () => {
  it("a bad TELEMETRY_SAMPLE_RATIO value fails fast at init", async () => {
    vi.stubEnv("APP_MODE", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://exam:exam@localhost:5432/exam");
    vi.stubEnv("TELEMETRY_ENABLED", "true");
    vi.stubEnv("TELEMETRY_SAMPLE_RATIO", "abc");
    await expect(initTelemetry()).rejects.toThrow(/ratio between 0 and 1/);
    expect(isTelemetryActive()).toBe(false);
  });

  it("TELEMETRY_EXPORTER=otlp without an endpoint fails fast (W6 guard)", () => {
    vi.stubEnv("APP_MODE", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://exam:exam@localhost:5432/exam");
    vi.stubEnv("TELEMETRY_EXPORTER", "otlp");
    expect(() => getRuntimeConfig()).toThrow(
      /TELEMETRY_EXPORTER=otlp requires TELEMETRY_OTLP_ENDPOINT/,
    );
  });

  it("TELEMETRY_OTLP_ENDPOINT set without TELEMETRY_EXPORTER=otlp fails fast (drift guard)", () => {
    vi.stubEnv("APP_MODE", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://exam:exam@localhost:5432/exam");
    vi.stubEnv("TELEMETRY_EXPORTER", "memory");
    vi.stubEnv("TELEMETRY_OTLP_ENDPOINT", "http://collector:4318");
    expect(() => getRuntimeConfig()).toThrow(
      /TELEMETRY_OTLP_ENDPOINT is set but TELEMETRY_EXPORTER is "memory"/,
    );
  });

  it("a valid otlp pair resolves through the guard", () => {
    vi.stubEnv("APP_MODE", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://exam:exam@localhost:5432/exam");
    vi.stubEnv("TELEMETRY_ENABLED", "true");
    vi.stubEnv("TELEMETRY_EXPORTER", "otlp");
    vi.stubEnv("TELEMETRY_OTLP_ENDPOINT", " http://collector:4318 ");
    const config = getRuntimeConfig().telemetry;
    expect(config.exporter).toBe("otlp");
    expect(config.otlpEndpoint).toBe("http://collector:4318");
    expect(config.enabled).toBe(true);
  });

  it("a non-URL TELEMETRY_OTLP_ENDPOINT fails fast (config error, not init degradation)", () => {
    vi.stubEnv("APP_MODE", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://exam:exam@localhost:5432/exam");
    vi.stubEnv("TELEMETRY_EXPORTER", "otlp");
    vi.stubEnv("TELEMETRY_OTLP_ENDPOINT", "not-a-url");
    expect(() => getRuntimeConfig()).toThrow(
      /TELEMETRY_OTLP_ENDPOINT must be an absolute http\(s\) URL/,
    );
  });

  it("a non-HTTP(S) endpoint scheme fails fast (ftp:// must never report telemetry active)", () => {
    vi.stubEnv("APP_MODE", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://exam:exam@localhost:5432/exam");
    vi.stubEnv("TELEMETRY_EXPORTER", "otlp");
    vi.stubEnv("TELEMETRY_OTLP_ENDPOINT", "ftp://collector:4318");
    expect(() => getRuntimeConfig()).toThrow(
      /TELEMETRY_OTLP_ENDPOINT must be an absolute http\(s\) URL/,
    );
  });

  it("an endpoint with embedded credentials fails fast", () => {
    vi.stubEnv("APP_MODE", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://exam:exam@localhost:5432/exam");
    vi.stubEnv("TELEMETRY_EXPORTER", "otlp");
    vi.stubEnv("TELEMETRY_OTLP_ENDPOINT", "http://admin:secret@collector:4318");
    expect(() => getRuntimeConfig()).toThrow(
      /TELEMETRY_OTLP_ENDPOINT must not embed credentials/,
    );
  });

  it("an https endpoint resolves exactly like an http one", () => {
    vi.stubEnv("APP_MODE", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://exam:exam@localhost:5432/exam");
    vi.stubEnv("TELEMETRY_ENABLED", "true");
    vi.stubEnv("TELEMETRY_EXPORTER", "otlp");
    vi.stubEnv("TELEMETRY_OTLP_ENDPOINT", "https://collector:4318");
    expect(getRuntimeConfig().telemetry.otlpEndpoint).toBe(
      "https://collector:4318",
    );
  });
});
