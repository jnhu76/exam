import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRootEnv, resolveRootEnvPaths } from "./loadRootEnv.js";

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
    process.env.DATABASE_URL =
      "postgresql://explicit:explicit@localhost:5432/explicit";

    loadRootEnv();

    expect(mockedLoadEnv).toHaveBeenCalledWith({
      path: [paths[1]],
      quiet: true,
    });
    expect(mockedLoadEnv.mock.calls[0]?.[0]).not.toHaveProperty("override");
    expect(process.env.DATABASE_URL).toBe(
      "postgresql://explicit:explicit@localhost:5432/explicit",
    );
  });

  it("does not call dotenv when no root .env file exists", () => {
    mockedExistsSync.mockReturnValue(false);

    loadRootEnv();

    expect(mockedLoadEnv).not.toHaveBeenCalled();
  });
});
