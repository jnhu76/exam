import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config as loadEnv } from "dotenv";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  admitEnvFile,
  isManagedProfileEnv,
  loadRootEnv,
  resolveRootEnvPath,
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

  // #741 H1: the application runtime has exactly ONE env-file source — the
  // repository-root `.env`. This test lives next to the module (same depth,
  // four hops up = repo root, anchored by the workspace manifest via the
  // un-mocked statSync), so the pre-#741 two-candidate implementation
  // (apps/api/.env first, repository root second) fails to even import.
  it("resolves exactly one application env source: the repository-root .env", () => {
    expect(resolveRootEnvPath()).toBe(
      fileURLToPath(new URL("../../../../.env", import.meta.url)),
    );
    // The anchor: four hops up from this module holds the workspace
    // manifest — proving the resolved directory IS the repository root.
    expect(
      statSync(
        fileURLToPath(new URL("../../../../package.json", import.meta.url)),
      ).isFile(),
    ).toBe(true);
  });

  it("loads an existing root .env quietly without enabling override", () => {
    const path = resolveRootEnvPath();
    mockedExistsSync.mockImplementation((checked) => checked === path);

    loadRootEnv({ DATABASE_URL: "postgresql://explicit@localhost:5432/exp" });

    expect(mockedLoadEnv).toHaveBeenCalledWith({ path, quiet: true });
    expect(mockedLoadEnv.mock.calls[0]?.[0]).not.toHaveProperty("override");
  });

  it("admitEnvFile forwards the mechanism path without adding options", () => {
    admitEnvFile("/throwaway/fixture/.env");

    expect(mockedLoadEnv).toHaveBeenCalledWith({
      path: "/throwaway/fixture/.env",
      quiet: true,
    });
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
    mockedExistsSync.mockReturnValue(true);

    loadRootEnv({ APP_MODE: "development" });

    expect(mockedLoadEnv).toHaveBeenCalledWith({
      path: resolveRootEnvPath(),
      quiet: true,
    });
  });

  it("treats an unparseable APP_MODE as unmanaged — the config error stays with getRuntimeConfig", () => {
    mockedExistsSync.mockReturnValue(true);

    loadRootEnv({ APP_MODE: "bogus" });

    expect(mockedLoadEnv).toHaveBeenCalledWith({
      path: resolveRootEnvPath(),
      quiet: true,
    });
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
