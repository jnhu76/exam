import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Organization } from "@exam/domain";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";
import {
  waitForSingleOrganization,
  type LogFn,
} from "./emailDeliveryWorker.js";

/**
 * #1012 RED witnesses for the standalone email delivery worker — the ④
 * layer: the raw JSON stdout/stderr writer (no Pino, no redaction).
 *
 * The entrypoint witnesses spawn the REAL module entry (`main()` via the
 * isMain guard) as a child process — the repo's own dev entry shape
 * (`worker:email:dev` = tsx src/workers/emailDeliveryWorker.ts) — with the
 * workspace source condition `@exam/test-source`, and assert the actual
 * stdout/stderr bytes. The child is pointed at an UNREACHABLE database
 * (127.0.0.1:1) with a synthetic name that passes the test-name-safety
 * guard, so it never touches any real database and never sends email.
 *
 * The bootstrap witness drives `waitForSingleOrganization` with injected
 * deps (the existing unit seam) because the full bootstrap wait requires a
 * live database loop.
 */

const execFileAsync = promisify(execFile);

const M_SQL = "RED1012-SELECT-grade-FROM-attempts";
const M_BIND = "RED1012-bind-$1::uuid";
const M_SECRET = "RED1012-smtp-secret-9f1zq";
const M_URL = "exam_test_red1012";
const M_URL_QUERY = "red1012q";
const M_STARTUP = "RED1012-STARTUP-MARKER";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const API_DIR = resolve(HERE, "../..");

/** Spawn the real worker entry; resolve with its stdout/stderr bytes. */
function spawnWorker(
  envOverrides: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolveSpawn, rejectSpawn) => {
    execFile(
      process.execPath,
      [
        "--conditions=@exam/test-source",
        "--import",
        "tsx",
        join("src", "workers", "emailDeliveryWorker.ts"),
      ],
      {
        cwd: API_DIR,
        env: { ...process.env, ...envOverrides },
        timeout: 60_000,
      },
      (error, stdout, stderr) => {
        // The worker exits 1 on startup failure by design; only a spawn
        // failure (ENOENT etc.) rejects.
        if (error && (error as { code?: string }).code === "ENOENT") {
          rejectSpawn(error);
          return;
        }
        resolveSpawn({
          stdout: String(stdout),
          stderr: String(stderr),
          code: error ? ((error as { code?: number }).code ?? null) : 0,
        });
      },
    );
  });
}

describe("standalone email delivery worker — #1012 RED witnesses (real entrypoint bytes)", () => {
  it("witness: the `connecting to database` line prints the database URL beyond the masked userinfo", async () => {
    // Test mode resolves the DB URL from TEST_DATABASE_URL (DATABASE_URL is
    // ignored in APP_MODE=test); the override points at an unreachable port
    // with a marker in the db name + query, so the child touches nothing.
    const { stdout, stderr } = await spawnWorker({
      TEST_DATABASE_URL: `postgresql://reduser:redpw@127.0.0.1:1/${M_URL}?${M_URL_QUERY}=1`,
    });
    const leaked = [M_URL, M_URL_QUERY].filter((m) => stdout.includes(m));
    expect(
      leaked,
      `database URL bytes leaked to stdout: ${leaked.join(", ")}\nstdout: ${stdout}\nstderr: ${stderr}`,
    ).toEqual([]);
  }, 90_000);

  it("witness: a top-level startup failure prints the raw error message AND stack to stderr", async () => {
    // An invalid EMAIL_TRANSPORT fails settings resolution with the raw
    // value echoed into the error message (settings.ts enumLeaf) — a
    // deterministic, offline marker carrier for the isMain catch.
    const { stdout, stderr } = await spawnWorker({
      EMAIL_TRANSPORT: `${M_STARTUP}-x`,
    });
    const lines = stderr
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    const failure = lines.find((l) => l.msg === "worker failed to start");
    expect(
      failure,
      `expected a "worker failed to start" JSON line on stderr\nstderr: ${stderr}\nstdout: ${stdout}`,
    ).toBeDefined();

    // RED core: the marker (raw config value) must not reach stderr bytes.
    expect(
      stderr.includes(M_STARTUP),
      `startup marker leaked to stderr: ${stderr}`,
    ).toBe(false);
    expect(
      stdout.includes(M_STARTUP),
      `startup marker leaked to stdout: ${stdout}`,
    ).toBe(false);

    // RED core: the raw stack (source paths) must not be printed either.
    expect(
      typeof failure?.stack === "string" &&
        (failure.stack as string).length > 0,
      "stack field must be absent from the startup-failure line",
    ).toBe(false);
  }, 90_000);
});

describe("waitForSingleOrganization — #1012 RED witness (bootstrap heartbeat write failure)", () => {
  function createDeps() {
    return {
      orgRepo: {
        resolveOptionalBrandingTenant: vi.fn(),
      },
      heartbeatRepo: {
        upsert: vi.fn(),
      },
      workerInstanceId: "red-witness-worker-1",
      pollIntervalMs: 5000,
      isShuttingDown: vi.fn().mockReturnValue(false),
      sleep: vi.fn().mockResolvedValue(undefined),
      log: vi.fn() as MockedFunction<LogFn>,
    };
  }

  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("witness: a marker-laden database error from the bootstrap heartbeat write is logged raw", async () => {
    const org: Organization = {
      id: "org-1",
      name: "Org",
      displayName: "Org",
      slug: "org",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    deps.orgRepo.resolveOptionalBrandingTenant
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(org);
    deps.heartbeatRepo.upsert
      .mockRejectedValueOnce(
        new Error(
          `db write failed: sql=${M_SQL} bind=${M_BIND} secret=${M_SECRET}`,
        ),
      )
      .mockResolvedValueOnce({});

    const result = await waitForSingleOrganization(deps);
    expect(result).toBe(org);

    const heartbeatFailure = deps.log.mock.calls.find(
      ([level, msg]) =>
        level === "warn" && msg === "heartbeat write failed (non-fatal)",
    );
    expect(
      heartbeatFailure,
      "expected a heartbeat write failure log call",
    ).toBeDefined();
    const meta = heartbeatFailure![2] as { error?: string } | undefined;
    const leaked = [M_SQL, M_BIND, M_SECRET].filter((m) =>
      (meta?.error ?? "").includes(m),
    );
    expect(
      leaked,
      `markers leaked through the heartbeat-write-failure log: ${leaked.join(", ")}\nmeta: ${JSON.stringify(meta)}`,
    ).toEqual([]);
  });
});
