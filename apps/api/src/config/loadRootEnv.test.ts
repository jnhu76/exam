import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isManagedProfileEnv,
  loadRootEnv,
  resolveRootEnvPaths,
} from "./loadRootEnv.js";

vi.mock("dotenv", () => ({
  config: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

const mockedLoadEnv = vi.mocked(loadEnv);
const mockedExistsSync = vi.mocked(existsSync);

describe("loadRootEnv", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    mockedLoadEnv.mockReset();
    mockedExistsSync.mockReset();
  });

  afterEach(() => {
    process.env = savedEnv;
    vi.restoreAllMocks();
  });

  it("checks deployed and repository root .env paths", () => {
    expect(resolveRootEnvPaths()).toEqual([
      fileURLToPath(new URL("../../.env", import.meta.url)),
      fileURLToPath(new URL("../../../../.env", import.meta.url)),
    ]);
  });

  it("loads existing root .env paths quietly without enabling override", () => {
    const paths = resolveRootEnvPaths();
    mockedExistsSync.mockImplementation((path) => path === paths[1]);

    loadRootEnv({ DATABASE_URL: "postgresql://explicit@localhost:5432/exp" });

    expect(mockedLoadEnv).toHaveBeenCalledWith({
      path: [paths[1]],
      quiet: true,
    });
    expect(mockedLoadEnv.mock.calls[0]?.[0]).not.toHaveProperty("override");
  });

  it("does not call dotenv when no root .env file exists", () => {
    mockedExistsSync.mockReturnValue(false);

    loadRootEnv({});

    expect(mockedLoadEnv).not.toHaveBeenCalled();
  });

  // ── Profile boundary (#565): the developer .env is DEV-profile authority ──
  // A managed process (test/e2e/ci/production) receives its configuration
  // from its runner/deployment owner; importing developer-local files as a
  // second authority let a developer .env APP_PORT hijack the runner-owned
  // WSL E2E shard bind port.

  it.each(["test", "e2e", "ci", "production"])(
    "does not import the developer .env in managed APP_MODE=%s",
    (appMode) => {
      mockedExistsSync.mockReturnValue(true);

      loadRootEnv({ APP_MODE: appMode });

      expect(mockedLoadEnv).not.toHaveBeenCalled();
    },
  );

  it("does not import the developer .env when NODE_ENV selects production", () => {
    mockedExistsSync.mockReturnValue(true);

    loadRootEnv({ NODE_ENV: "production" });

    expect(mockedLoadEnv).not.toHaveBeenCalled();
  });

  it("loads the developer .env for an explicit development mode", () => {
    const paths = resolveRootEnvPaths();
    mockedExistsSync.mockReturnValue(true);

    loadRootEnv({ APP_MODE: "development" });

    expect(mockedLoadEnv).toHaveBeenCalled();
    expect(mockedLoadEnv.mock.calls[0]?.[0]?.path).toEqual(paths);
  });

  it("treats an unparseable APP_MODE as unmanaged — the config error stays with getRuntimeConfig", () => {
    const paths = resolveRootEnvPaths();
    mockedExistsSync.mockReturnValue(true);

    loadRootEnv({ APP_MODE: "bogus" });

    expect(mockedLoadEnv).toHaveBeenCalled();
    expect(mockedLoadEnv.mock.calls[0]?.[0]?.path).toEqual(paths);
  });

  it("isManagedProfileEnv mirrors the APP_MODE-authoritative resolver", () => {
    expect(isManagedProfileEnv({})).toBe(false);
    expect(isManagedProfileEnv({ APP_MODE: "development" })).toBe(false);
    expect(isManagedProfileEnv({ NODE_ENV: "test" })).toBe(true);
    expect(isManagedProfileEnv({ APP_MODE: "e2e" })).toBe(true);
    expect(isManagedProfileEnv({ APP_MODE: "bogus" })).toBe(false);
  });

  // The real wiring is loadRootEnv() with no argument — the process.env
  // default every entrypoint (server, seed, migrate, …) actually exercises.
  it("skips the developer .env via the process.env default when the running profile is managed", () => {
    mockedExistsSync.mockReturnValue(true);
    vi.stubEnv("APP_MODE", "e2e");

    loadRootEnv();

    expect(mockedLoadEnv).not.toHaveBeenCalled();
  });

  it("loads the developer .env via the process.env default for bare development", () => {
    mockedExistsSync.mockReturnValue(true);
    vi.stubEnv("APP_MODE", "development");

    loadRootEnv();

    expect(mockedLoadEnv).toHaveBeenCalled();
  });
});
