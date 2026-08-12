import { describe, expect, it } from "vitest";
import {
  parseAppMode,
  resolveDatabaseUrl,
  resolveDatabaseUrlFromEnv,
} from "./databaseUrl.js";

/**
 * Helpers: build a minimal env with the given overrides. Defaults avoid leaking
 * the host shell's real DATABASE_URL/TEST_DATABASE_URL into the resolver.
 */
function env(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: undefined,
    TEST_DATABASE_URL: undefined,
    TEST_DB_URL: undefined,
    APP_MODE: undefined,
    NODE_ENV: undefined,
    ALLOW_UNSAFE_TEST_DATABASE_URL: undefined,
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("parseAppMode", () => {
  it("uses APP_MODE when set and valid", () => {
    expect(parseAppMode(env({ APP_MODE: "e2e" }))).toBe("e2e");
    expect(parseAppMode(env({ APP_MODE: "production" }))).toBe("production");
    expect(parseAppMode(env({ APP_MODE: "ci" }))).toBe("ci");
  });

  it("falls back to NODE_ENV when APP_MODE is unset", () => {
    expect(parseAppMode(env({ NODE_ENV: "production" }))).toBe("production");
    expect(parseAppMode(env({ NODE_ENV: "test" }))).toBe("test");
  });

  it("defaults to development when neither is set", () => {
    expect(parseAppMode(env())).toBe("development");
  });

  it("treats empty APP_MODE as unset (falls back to NODE_ENV)", () => {
    expect(parseAppMode(env({ APP_MODE: "", NODE_ENV: "test" }))).toBe("test");
  });

  it("throws on an invalid APP_MODE", () => {
    expect(() => parseAppMode(env({ APP_MODE: "staging" }))).toThrow(
      /Invalid APP_MODE/,
    );
  });
});

describe("resolveDatabaseUrl — test-like modes", () => {
  it("uses TEST_DATABASE_URL in test mode", () => {
    const url = resolveDatabaseUrl(
      env({
        APP_MODE: "test",
        TEST_DATABASE_URL: "postgresql://u:p@h:5432/exam_test",
      }),
    );
    expect(url).toBe("postgresql://u:p@h:5432/exam_test");
  });

  it("uses TEST_DATABASE_URL in e2e mode", () => {
    expect(
      resolveDatabaseUrl(
        env({
          APP_MODE: "e2e",
          TEST_DATABASE_URL: "postgresql://u:p@h:5432/exam_e2e",
        }),
      ),
    ).toBe("postgresql://u:p@h:5432/exam_e2e");
  });

  it("falls back to TEST_DB_URL (legacy)", () => {
    expect(
      resolveDatabaseUrl(
        env({ APP_MODE: "ci", TEST_DB_URL: "postgresql://u:p@h:5432/exam_ci" }),
      ),
    ).toBe("postgresql://u:p@h:5432/exam_ci");
  });

  it("prefers TEST_DATABASE_URL over TEST_DB_URL", () => {
    expect(
      resolveDatabaseUrl(
        env({
          APP_MODE: "test",
          TEST_DATABASE_URL: "postgresql://u:p@h:5432/exam_test",
          TEST_DB_URL: "postgresql://u:p@h:5432/legacy",
        }),
      ),
    ).toBe("postgresql://u:p@h:5432/exam_test");
  });

  it("throws when no test URL is set (never falls back to DATABASE_URL)", () => {
    expect(() =>
      resolveDatabaseUrl(
        env({ APP_MODE: "test", DATABASE_URL: "postgresql://u:p@h:5432/exam" }),
      ),
    ).toThrow(/TEST_DATABASE_URL is required/);
  });

  it("rejects a test DB name without test/e2e/ci", () => {
    expect(() =>
      resolveDatabaseUrl(
        env({
          APP_MODE: "test",
          TEST_DATABASE_URL: "postgresql://u:p@h:5432/exam",
        }),
      ),
    ).toThrow(/does not contain "test", "e2e", or "ci"/);
  });

  it("allows an unsafe name when ALLOW_UNSAFE_TEST_DATABASE_URL=1", () => {
    expect(
      resolveDatabaseUrl(
        env({
          APP_MODE: "test",
          TEST_DATABASE_URL: "postgresql://u:p@h:5432/exam",
          ALLOW_UNSAFE_TEST_DATABASE_URL: "1",
        }),
      ),
    ).toBe("postgresql://u:p@h:5432/exam");
  });

  it("extracts the db name from a URL with query params", () => {
    // Name safety must read the path segment, not the query string.
    expect(() =>
      resolveDatabaseUrl(
        env({
          APP_MODE: "test",
          TEST_DATABASE_URL: "postgresql://u:p@h:5432/exam?sslmode=require",
        }),
      ),
    ).toThrow(/does not contain/);
  });
});

describe("resolveDatabaseUrl — dev/prod modes", () => {
  it("uses DATABASE_URL in development", () => {
    expect(
      resolveDatabaseUrl(
        env({
          APP_MODE: "development",
          DATABASE_URL: "postgresql://u:p@h:5432/exam",
        }),
      ),
    ).toBe("postgresql://u:p@h:5432/exam");
  });

  it("uses DATABASE_URL in production", () => {
    expect(
      resolveDatabaseUrl(
        env({
          APP_MODE: "production",
          DATABASE_URL: "postgresql://u:p@h:5432/exam",
        }),
      ),
    ).toBe("postgresql://u:p@h:5432/exam");
  });

  it("throws in development when DATABASE_URL is unset (no hardcoded default)", () => {
    // A missing DATABASE_URL is a misconfiguration, not a guessed localhost
    // connection. The dev compose exposes port 15432, not 5432; a hardcoded
    // fallback would guess the wrong port and fail confusingly (or, worse,
    // connect to an unintended local instance). Fail fast and require .env.
    expect(() => resolveDatabaseUrl(env({ APP_MODE: "development" }))).toThrow(
      /DATABASE_URL is required in development/,
    );
  });

  it("throws in production when DATABASE_URL is missing", () => {
    expect(() => resolveDatabaseUrl(env({ APP_MODE: "production" }))).toThrow(
      /DATABASE_URL is required in production/,
    );
  });

  it("does NOT enforce name-safety on the dev/prod DATABASE_URL", () => {
    // A dev/prod DB named "exam" is legitimate; only test modes are guarded.
    expect(
      resolveDatabaseUrl(
        env({
          APP_MODE: "development",
          DATABASE_URL: "postgresql://u:p@h:5432/exam",
        }),
      ),
    ).toBe("postgresql://u:p@h:5432/exam");
  });
});

describe("resolveDatabaseUrlFromEnv", () => {
  it("delegates to resolveDatabaseUrl with the provided env", () => {
    expect(
      resolveDatabaseUrlFromEnv(
        env({
          APP_MODE: "test",
          TEST_DATABASE_URL: "postgresql://u:p@h:5432/exam_test",
        }),
      ),
    ).toBe("postgresql://u:p@h:5432/exam_test");
  });
});
