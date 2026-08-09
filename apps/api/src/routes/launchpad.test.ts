import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq, sql } from "drizzle-orm";
import launchpadRoutes from "./launchpad.js";
import { buildTestApp, type TestContext } from "./testHelpers.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { schema } from "@exam/db/src/schema/pg.js";

const VALID_TOKEN = "test-launchpad-setup-token-DO-NOT-USE-IN-PROD";

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    organizationName: "Launchpad Test Org",
    adminUsername: `lpadmin-${crypto.randomUUID().slice(0, 8)}`,
    adminPassword: "Launchpad-Admin-123!",
    adminName: "Launchpad Admin",
    setupToken: VALID_TOKEN,
    ...overrides,
  };
}

/**
 * Reset the worker test DB to an "uninitialized" state (no default
 * organization, no users, no audit rows) by truncating every public table
 * except the drizzle migration-metadata tables. Mirrors the
 * `truncateBusinessTables` helper but runs through the Drizzle handle the
 * TestContext exposes (so we do not need the raw `postgres` Sql client).
 */
async function resetToUninitialized(ctx: TestContext): Promise<void> {
  await ctx.db.execute(
    sql.raw(`
      TRUNCATE
        organizations,
        organization_settings,
        candidate_fields,
        users,
        candidate_profiles,
        user_role_assignments,
        courses,
        questions,
        exams,
        exam_enrollments,
        exam_attempts,
        attempt_grading_entries,
        notifications,
        email_outbox,
        worker_heartbeats,
        attempt_interruptions,
        attempt_interruption_events,
        attempt_time_adjustments,
        exam_incidents,
        exam_incident_events,
        exam_incident_actions,
        exam_incident_attempts,
        exam_incident_interruption_links,
        exam_proctor_assignments,
        exam_proctor_assignment_events,
        attempt_command_receipts,
        audit_logs,
        client_events,
        import_job_logs
      RESTART IDENTITY CASCADE
    `),
  );
}

describe("launchpad routes", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp(launchpadRoutes, { prefix: "/api" });
  });

  afterAll(async () => {
    // If a test left the DB in the uninitialized state, restore the seeded
    // default org so subsequent test files in the same worker see the
    // expected seeded state. best-effort; cleanup() closes the app.
    try {
      const rows = await ctx.db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(eq(schema.organizations.slug, "default"))
        .limit(1);
      if (rows.length === 0) {
        const now = new Date();
        await ctx.db.insert(schema.organizations).values({
          id: crypto.randomUUID(),
          name: "Default Organization",
          displayName: "Default Organization",
          slug: "default",
          createdAt: now,
          updatedAt: now,
        });
      }
    } catch {
      // ignore — cleanup is best-effort
    }
    await ctx.cleanup();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTest();
  });

  // ── GET /api/launchpad/status — initialized (default seeded org exists) ──
  it("GET /api/launchpad/status returns initialized=true when default org exists", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/launchpad/status",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ initialized: true });
  });

  // ── POST /api/launchpad/bootstrap — refuses when initialized ─────────────
  it("POST /api/launchpad/bootstrap returns 409 when already initialized (no token oracle)", async () => {
    // Configure a token so the only reason for refusal is the init gate.
    vi.stubEnv("LAUNCHPAD_SETUP_TOKEN", VALID_TOKEN);
    resetRuntimeConfigForTest();

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/launchpad/bootstrap",
      payload: basePayload({ setupToken: VALID_TOKEN }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("LAUNCHPAD_ALREADY_INITIALIZED");
  });

  it("POST /api/launchpad/bootstrap returns 409 with the WRONG token too (init gate first, no oracle)", async () => {
    // The installation-initialized check MUST run before token validation,
    // so an initialized installation returns 409 regardless of token
    // validity — it never reveals whether the token is correct.
    vi.stubEnv("LAUNCHPAD_SETUP_TOKEN", VALID_TOKEN);
    resetRuntimeConfigForTest();

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/launchpad/bootstrap",
      payload: basePayload({ setupToken: "wrong-token" }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("LAUNCHPAD_ALREADY_INITIALIZED");
  });

  // ── POST /api/launchpad/bootstrap — token disabled when unset ────────────
  it("POST /api/launchpad/bootstrap returns 403 when setup token is unset (launchpad disabled)", async () => {
    vi.stubEnv("LAUNCHPAD_SETUP_TOKEN", "");
    resetRuntimeConfigForTest();

    // Use an uninitialized database state so the init gate does NOT fire
    // first; this isolates the token-disabled behavior.
    await resetToUninitialized(ctx);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/launchpad/bootstrap",
      payload: basePayload({ setupToken: "anything" }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("LAUNCHPAD_INVALID_SETUP_TOKEN");
  });

  it("POST /api/launchpad/bootstrap returns 403 when token mismatches (uninitialized)", async () => {
    vi.stubEnv("LAUNCHPAD_SETUP_TOKEN", VALID_TOKEN);
    resetRuntimeConfigForTest();

    // Uninitialized state so the init gate does not fire first.
    await resetToUninitialized(ctx);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/launchpad/bootstrap",
      payload: basePayload({ setupToken: "wrong-token" }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("LAUNCHPAD_INVALID_SETUP_TOKEN");
  });

  // ── POST /api/launchpad/bootstrap — success on uninitialized + valid token
  it("POST /api/launchpad/bootstrap creates first Admin on uninitialized install with valid token", async () => {
    vi.stubEnv("LAUNCHPAD_SETUP_TOKEN", VALID_TOKEN);
    resetRuntimeConfigForTest();

    // Uninitialized state.
    await resetToUninitialized(ctx);
    const statusBefore = await ctx.app.inject({
      method: "GET",
      url: "/api/launchpad/status",
    });
    expect(statusBefore.json()).toEqual({ initialized: false });

    const username = `lpok-${crypto.randomUUID().slice(0, 8)}`;
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/launchpad/bootstrap",
      payload: basePayload({
        adminUsername: username,
        organizationName: "Fresh Install Org",
        organizationDisplayName: "Fresh Install Display",
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      ok: true,
      organizationSlug: "default",
      adminUsername: username,
    });

    // The canonical mutation body landed: default org + one active Admin +
    // admin.bootstrap audit row, atomically.
    const orgRows = await ctx.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, "default"));
    expect(orgRows).toHaveLength(1);
    expect(orgRows[0]!.name).toBe("Fresh Install Org");
    expect(orgRows[0]!.displayName).toBe("Fresh Install Display");

    const adminRows = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username));
    expect(adminRows).toHaveLength(1);
    expect(adminRows[0]!.role).toBe("Admin");
    expect(adminRows[0]!.isActive).toBe(true);

    const assignmentRows = await ctx.db
      .select()
      .from(schema.userRoleAssignments)
      .where(eq(schema.userRoleAssignments.userId, adminRows[0]!.id));
    expect(
      assignmentRows.some(
        (a) => a.role === "Admin" && a.isPrimary && a.isActive,
      ),
    ).toBe(true);

    const auditRows = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "admin.bootstrap"));
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    // Token must NEVER appear in the audit row.
    const auditJson = JSON.stringify(auditRows);
    expect(auditJson).not.toContain(VALID_TOKEN);

    // After bootstrap, status flips to initialized and a second bootstrap
    // is refused — even with the correct token (no oracle).
    const statusAfter = await ctx.app.inject({
      method: "GET",
      url: "/api/launchpad/status",
    });
    expect(statusAfter.json()).toEqual({ initialized: true });

    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/launchpad/bootstrap",
      payload: basePayload({
        adminUsername: `lpsecond-${crypto.randomUUID().slice(0, 8)}`,
        setupToken: VALID_TOKEN,
      }),
    });
    expect(second.statusCode).toBe(409);
  });
});
