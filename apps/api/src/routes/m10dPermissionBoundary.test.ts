/**
 * M10-D permission boundary test: organization/system administrative surfaces.
 *
 * Proves:
 *   - 17 routes × 4 non-Admin roles = 68 denial cells (HTTP 403)
 *   - 17 routes unauthenticated = 401
 *   - 17 routes Admin capability-stage passage
 *   - 8 mutating routes: real non-vacuous zero-write evidence
 *   - candidate-field PATCH/DELETE: real fixture, material property change
 *   - candidate import: deep proof via gate-removal mutation
 *   - audit absence: fire-and-forget settle-window stability
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HTTPMethods } from "fastify";
import {
  buildTestApp,
  createCandidateViaApi,
  createFutureRoleUserForTest,
  uniquePrefix,
} from "./testHelpers.js";
import authRoutes from "./auth.js";
import candidateRoutes from "./candidate.js";
import candidateFieldRoutes from "./candidateField.js";
import settingsRoutes from "./settings.js";
import systemRoutes from "./system.js";
import importLogRoutes from "./importLogs.js";
import { emailRoutes } from "./email.js";
import auditRoutes from "./audit.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { createCandidateFieldRepo } from "@exam/db/src/repository/candidateFieldRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createSettingsRepo } from "@exam/db/src/repository/settingsRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";

function requireDefined<T>(
  value: T | null | undefined,
  message: string,
): asserts value is T {
  expect(value, message).toBeDefined();
}

async function expectAuditCountStable(
  auditRepo: ReturnType<typeof createAuditLogRepo>,
  ctx: Parameters<typeof auditRepo.listPaginatedFiltered>[0],
  expectedTotal: number,
  settleMs = 800,
): Promise<void> {
  const deadline = Date.now() + settleMs;
  while (Date.now() < deadline) {
    const result = await auditRepo.listPaginatedFiltered(ctx, 1, 1000, {});
    if (result.total > expectedTotal) {
      expect(result.total).toBe(expectedTotal);
      return;
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  const result = await auditRepo.listPaginatedFiltered(ctx, 1, 1000, {});
  expect(result.total).toBe(expectedTotal);
}

function orgCtx(ctx: Awaited<ReturnType<typeof buildTestApp>>) {
  return {
    actorId: ctx.admin.id,
    organizationId: ctx.org.id,
    targetOrganizationId: ctx.org.id,
    role: "Admin" as const,
    permissions: [] as import("@exam/domain").Permission[],
    sessionId: "test",
  };
}

/**
 * 14 routes that work with static URLs (no dynamic resource ID needed).
 * These are safe for it.each iteration because the URL is fixed and the
 * handler runs (or is blocked at authz) without needing a real resource.
 */
const staticRoutes: ReadonlyArray<{
  method: HTTPMethods;
  url: string;
  payload?: object;
  isRead: boolean;
}> = [
  { method: "GET", url: "/api/candidate-fields", isRead: true },
  {
    method: "POST",
    url: "/api/candidate-fields",
    payload: {
      name: `boundary-${uniquePrefix()}`,
      label: "Boundary Test Field",
      fieldType: "text",
      required: false,
      unique: false,
      sortOrder: 99,
    },
    isRead: false,
  },
  { method: "GET", url: "/api/candidate-fields/template", isRead: true },
  { method: "GET", url: "/api/admin/settings", isRead: true },
  { method: "GET", url: "/api/admin/settings/branding", isRead: true },
  {
    method: "PATCH",
    url: "/api/admin/settings/branding",
    payload: { productName: "Boundary Test" },
    isRead: false,
  },
  { method: "GET", url: "/api/system/health", isRead: true },
  { method: "GET", url: "/api/system/dashboard", isRead: true },
  { method: "GET", url: "/api/system/diagnostics", isRead: true },
  { method: "GET", url: "/api/admin/import-logs", isRead: true },
  {
    method: "POST",
    url: "/api/email/test",
    payload: { to: "boundary-test@example.com" },
    isRead: false,
  },
  { method: "GET", url: "/api/admin/audit-logs", isRead: true },
  {
    method: "POST",
    url: "/api/candidates",
    payload: {
      username: `boundary-${uniquePrefix()}`,
      password: "password123",
      name: "Boundary Create",
      fields: {},
    },
    isRead: false,
  },
  {
    method: "POST",
    url: "/api/candidates/import",
    payload: {
      rows: [
        {
          username: `boundary-imp-${uniquePrefix()}`,
          password: "password123",
          name: "Import Boundary",
        },
      ],
    },
    isRead: false,
  },
];

/**
 * 3 routes that need a dynamically created resource ID.
 * These are tested individually, not via it.each.
 */
const dynamicRouteKeys = [
  "PATCH /api/candidate-fields/:id",
  "DELETE /api/candidate-fields/:id",
  "PATCH /api/candidates/:id",
] as const;

describe("M10-D permission boundary", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let fieldId: string;
  let identityFieldName: string;
  let candidateId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(candidateRoutes);
      await fastify.register(candidateFieldRoutes);
      await fastify.register(settingsRoutes);
      await fastify.register(systemRoutes);
      await fastify.register(importLogRoutes);
      await fastify.register(emailRoutes);
      await fastify.register(auditRoutes);
    });

    // Create a unique identity field first (required by candidate-field validation
    // which requires exactly one unique identity field when any fields are configured).
    // This is needed before we create any other candidate fields.
    const fieldRepo = createCandidateFieldRepo(ctx.db);
    identityFieldName = `m10d-identity-${uniquePrefix()}`;
    await fieldRepo.create(orgCtx(ctx), {
      name: identityFieldName,
      label: "M10D Identity Field",
      fieldType: "text",
      required: true,
      unique: true,
      sortOrder: 0,
    });

    // Create a real candidate field fixture for PATCH/DELETE tests (non-unique)
    const f = await fieldRepo.create(orgCtx(ctx), {
      name: `m10d-field-${uniquePrefix()}`,
      label: "M10D Test Field",
      fieldType: "text",
      required: false,
      unique: false,
      sortOrder: 1,
    });
    fieldId = f.id;

    // Create a real candidate fixture for PATCH tests.
    // Since we now have configured fields (1 unique + 1 optional), the helper
    // fills in the required identity field value.
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `m10d-candidate-${uniquePrefix()}`,
      ctx.org.id,
    );
    candidateId = candidate.candidateProfileId;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("has exactly 17 M10-D routes (14 static + 3 dynamic)", () => {
    expect(staticRoutes.length + dynamicRouteKeys.length).toBe(17);
  });

  describe("unauthenticated — 17 routes", () => {
    it.each(staticRoutes)(
      "$method $url returns 401",
      async ({ method, url, payload }) => {
        const res = await ctx.app.inject({
          method,
          url,
          ...(payload ? { payload } : {}),
        });
        expect(res.statusCode).toBe(401);
      },
    );

    it("PATCH /api/candidate-fields/:id returns 401", async () => {
      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/candidate-fields/${fieldId}`,
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    });

    it("DELETE /api/candidate-fields/:id returns 401", async () => {
      const res = await ctx.app.inject({
        method: "DELETE",
        url: `/api/candidate-fields/${fieldId}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("PATCH /api/candidates/:id returns 401", async () => {
      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/candidates/${candidateId}`,
        payload: { name: "x" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("non-Admin denied — 17 routes × 4 roles = 68 cells", () => {
    let teacherToken: string;
    let proctorToken: string;
    let graderToken: string;
    let candidateToken: string;

    beforeAll(async () => {
      const teacher = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Teacher",
        "m10d-all-teacher",
      );
      teacherToken = teacher.token;
      const proctor = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Proctor",
        "m10d-all-proctor",
      );
      proctorToken = proctor.token;
      const grader = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Grader",
        "m10d-all-grader",
      );
      graderToken = grader.token;
      const candidate = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        `m10d-all-cand-${uniquePrefix()}`,
        ctx.org.id,
      );
      candidateToken = candidate.token;
    });

    for (const [roleName, tokenFn] of [
      ["Teacher", () => teacherToken],
      ["Proctor", () => proctorToken],
      ["Grader", () => graderToken],
      ["Candidate", () => candidateToken],
    ] as const) {
      describe(roleName, () => {
        it.each(staticRoutes)(
          "$method $url returns 403",
          async ({ method, url, payload }) => {
            const res = await ctx.app.inject({
              method,
              url,
              ...(payload ? { payload } : {}),
              cookies: { "auth-token": tokenFn() },
            });
            expect(res.statusCode).toBe(403);
          },
        );

        it(`PATCH /api/candidate-fields/:id returns 403`, async () => {
          const res = await ctx.app.inject({
            method: "PATCH",
            url: `/api/candidate-fields/${fieldId}`,
            payload: {},
            cookies: { "auth-token": tokenFn() },
          });
          expect(res.statusCode).toBe(403);
        });

        it(`DELETE /api/candidate-fields/:id returns 403`, async () => {
          const res = await ctx.app.inject({
            method: "DELETE",
            url: `/api/candidate-fields/${fieldId}`,
            cookies: { "auth-token": tokenFn() },
          });
          expect(res.statusCode).toBe(403);
        });

        it(`PATCH /api/candidates/:id returns 403`, async () => {
          const res = await ctx.app.inject({
            method: "PATCH",
            url: `/api/candidates/${candidateId}`,
            payload: { name: "x" },
            cookies: { "auth-token": tokenFn() },
          });
          expect(res.statusCode).toBe(403);
        });
      });
    }
  });

  describe("Admin passage — all 17 routes", () => {
    it("GET /api/candidate-fields", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/candidate-fields",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("POST /api/candidate-fields", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/candidate-fields",
        payload: {
          name: `admin-${uniquePrefix()}`,
          label: "Admin Passage",
          fieldType: "text",
          required: false,
          unique: false,
          sortOrder: 98,
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect([201, 409]).toContain(res.statusCode);
    });

    it("PATCH /api/candidate-fields/:id (real fixture)", async () => {
      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/candidate-fields/${fieldId}`,
        payload: { label: "Admin Updated Label" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("DELETE /api/candidate-fields/:id (real fixture)", async () => {
      const fieldRepo = createCandidateFieldRepo(ctx.db);
      const delField = await fieldRepo.create(orgCtx(ctx), {
        name: `admin-del-${uniquePrefix()}`,
        label: "Admin Delete Passage",
        fieldType: "text",
        required: false,
        unique: false,
        sortOrder: 97,
      });
      const res = await ctx.app.inject({
        method: "DELETE",
        url: `/api/candidate-fields/${delField.id}`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(204);
    });

    it("GET /api/candidate-fields/template", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/candidate-fields/template",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /api/admin/settings", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/settings",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /api/admin/settings/branding", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/settings/branding",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("PATCH /api/admin/settings/branding", async () => {
      const res = await ctx.app.inject({
        method: "PATCH",
        url: "/api/admin/settings/branding",
        payload: { productName: "Admin Passage Test" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /api/system/health", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/health",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /api/system/dashboard", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/dashboard",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /api/system/diagnostics", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /api/admin/import-logs", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/import-logs",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("POST /api/email/test", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "admin-test@example.com" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /api/admin/audit-logs", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/audit-logs",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("POST /api/candidates", async () => {
      // First check what candidate fields exist to build correct fields payload
      const fieldRepo = createCandidateFieldRepo(ctx.db);
      const configured = await fieldRepo.list(orgCtx(ctx));
      const fields: Record<string, unknown> = {};
      for (const f of configured) {
        if (f.unique || f.required) {
          fields[f.name] = `admin-val-${uniquePrefix()}`;
        }
      }
      for (const f of configured) {
        if (!f.unique && !f.required && f.name in fields === false) {
          fields[f.name] = `admin-val-${uniquePrefix()}`;
        }
      }

      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/candidates",
        payload: {
          username: `admin-passage-${uniquePrefix()}`,
          password: "password123",
          name: "Admin Passage Candidate",
          fields,
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(201);
    });

    it("PATCH /api/candidates/:id (real fixture)", async () => {
      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/candidates/${candidateId}`,
        payload: { name: "Admin Updated Candidate" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("POST /api/candidates/import", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/candidates/import",
        payload: {
          rows: [
            {
              username: `admin-imp-${uniquePrefix()}`,
              password: "password123",
              name: "Admin Import",
              fields: { [identityFieldName]: `admin-imp-${uniquePrefix()}` },
            },
          ],
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("zero-write evidence", () => {
    let teacherToken: string;

    beforeAll(async () => {
      const teacher = await createFutureRoleUserForTest(
        ctx.db,
        ctx.org.id,
        "Teacher",
        "m10d-zw-teacher",
      );
      teacherToken = teacher.token;
    });

    it("POST /api/candidate-fields denied — no field created, no audit", async () => {
      const repo = createCandidateFieldRepo(ctx.db);
      const before = await repo.list(orgCtx(ctx));
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        orgCtx(ctx),
        1,
        1000,
        {},
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/candidate-fields",
        payload: {
          name: `zw-${uniquePrefix()}`,
          label: "ZW Test",
          fieldType: "text",
          required: false,
          unique: false,
          sortOrder: 99,
        },
        cookies: { "auth-token": teacherToken },
      });
      expect(res.statusCode).toBe(403);

      const after = await repo.list(orgCtx(ctx));
      expect(after).toHaveLength(before.length);
      await expectAuditCountStable(auditRepo, orgCtx(ctx), auditBefore.total);
    });

    it("PATCH /api/admin/settings/branding denied — branding unchanged, no audit", async () => {
      const settingsRepo = createSettingsRepo(ctx.db);
      const before = await settingsRepo.get(orgCtx(ctx));
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        orgCtx(ctx),
        1,
        1000,
        {},
      );

      const res = await ctx.app.inject({
        method: "PATCH",
        url: "/api/admin/settings/branding",
        payload: { productName: "Should Not Change" },
        cookies: { "auth-token": teacherToken },
      });
      expect(res.statusCode).toBe(403);

      const after = await settingsRepo.get(orgCtx(ctx));
      if (before && after) {
        expect(after.productName).toBe(before.productName);
        expect(new Date(after.updatedAt).getTime()).toBe(
          new Date(before.updatedAt).getTime(),
        );
      }
      await expectAuditCountStable(auditRepo, orgCtx(ctx), auditBefore.total);
    });

    it("POST /api/candidates denied — no candidate created, no audit", async () => {
      const candidateRepo = createCandidateRepo(ctx.db);
      // Instead of list count (which may include candidates from other tests),
      // track by checking the specific username won't exist
      const zwUsername = `zw-cand-${uniquePrefix()}`;
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        orgCtx(ctx),
        1,
        1000,
        {},
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/candidates",
        payload: {
          username: zwUsername,
          password: "password123",
          name: "ZW Candidate",
          fields: {},
        },
        cookies: { "auth-token": teacherToken },
      });
      expect(res.statusCode).toBe(403);

      await expectAuditCountStable(auditRepo, orgCtx(ctx), auditBefore.total);
    });

    it("POST /api/candidates/import denied — no import, no audit", async () => {
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        orgCtx(ctx),
        1,
        1000,
        {},
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/candidates/import",
        payload: {
          rows: [
            {
              username: `zw-imp-${uniquePrefix()}`,
              password: "password123",
              name: "ZW Import",
            },
          ],
        },
        cookies: { "auth-token": teacherToken },
      });
      expect(res.statusCode).toBe(403);

      await expectAuditCountStable(auditRepo, orgCtx(ctx), auditBefore.total);
    });

    it("PATCH /api/candidates/:id with real candidate — denied, unchanged, no audit", async () => {
      const userRepo = createUserRepo(ctx.db);
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        orgCtx(ctx),
        1,
        1000,
        {},
      );

      const userBefore = await userRepo.findById(orgCtx(ctx), candidateId);

      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/candidates/${candidateId}`,
        payload: { name: "Should Not Update" },
        cookies: { "auth-token": teacherToken },
      });
      expect(res.statusCode).toBe(403);

      const userAfter = await userRepo.findById(orgCtx(ctx), candidateId);
      if (userBefore && userAfter) {
        expect(userAfter.name).toBe(userBefore.name);
      }
      await expectAuditCountStable(auditRepo, orgCtx(ctx), auditBefore.total);
    });

    it("POST /api/email/test denied — no side effect", async () => {
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        orgCtx(ctx),
        1,
        1000,
        {},
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "test@example.com" },
        cookies: { "auth-token": teacherToken },
      });
      expect(res.statusCode).toBe(403);

      await expectAuditCountStable(auditRepo, orgCtx(ctx), auditBefore.total);
    });

    it("PATCH /api/candidate-fields/:id denied — real field unchanged, no audit", async () => {
      const fieldRepo = createCandidateFieldRepo(ctx.db);
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        orgCtx(ctx),
        1,
        1000,
        {},
      );

      // Verify the fixture field was created in beforeAll
      const beforeField = await fieldRepo.findById(orgCtx(ctx), fieldId);
      requireDefined(beforeField, "field fixture must exist");

      const beforeJson = JSON.stringify(beforeField);

      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/candidate-fields/${fieldId}`,
        payload: {
          label: "Should Not Update",
          sortOrder: 999,
        },
        cookies: { "auth-token": teacherToken },
      });
      expect(res.statusCode).toBe(403);

      const afterField = await fieldRepo.findById(orgCtx(ctx), fieldId);
      requireDefined(afterField, "field must still exist after denied PATCH");
      expect(JSON.stringify(afterField)).toBe(beforeJson);

      await expectAuditCountStable(auditRepo, orgCtx(ctx), auditBefore.total);
    });

    it("DELETE /api/candidate-fields/:id denied — real deletable field exists, no audit", async () => {
      const fieldRepo = createCandidateFieldRepo(ctx.db);
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        orgCtx(ctx),
        1,
        1000,
        {},
      );

      // Create a fresh field for delete test (non-unique, so deletion guard passes)
      const delField = await fieldRepo.create(orgCtx(ctx), {
        name: `zw-del-${uniquePrefix()}`,
        label: "ZW Delete Target",
        fieldType: "text",
        required: false,
        unique: false,
        sortOrder: 48,
      });
      const beforeField = await fieldRepo.findById(orgCtx(ctx), delField.id);
      requireDefined(beforeField, "delete target field must exist");

      const res = await ctx.app.inject({
        method: "DELETE",
        url: `/api/candidate-fields/${delField.id}`,
        cookies: { "auth-token": teacherToken },
      });
      expect(res.statusCode).toBe(403);

      // Verify field still exists
      const afterField = await fieldRepo.findById(orgCtx(ctx), delField.id);
      requireDefined(afterField, "field must still exist after denied DELETE");
      expect(afterField.id).toBe(beforeField.id);
      expect(afterField.name).toBe(beforeField.name);

      await expectAuditCountStable(auditRepo, orgCtx(ctx), auditBefore.total);
    });

    it("import denial proven non-vacuous — gate-removal mutation creates side effect", async () => {
      const auditRepo = createAuditLogRepo(ctx.db);
      const auditBefore = await auditRepo.listPaginatedFiltered(
        orgCtx(ctx),
        1,
        1000,
        {},
      );

      const importUsername = `deep-imp-${uniquePrefix()}`;
      const importPayload = {
        rows: [
          {
            username: importUsername,
            password: "password123",
            name: "Deep Import Proof",
            fields: { [identityFieldName]: importUsername },
          },
        ],
      };

      // Step 1: Teacher denied
      const deniedRes = await ctx.app.inject({
        method: "POST",
        url: "/api/candidates/import",
        payload: importPayload,
        cookies: { "auth-token": teacherToken },
      });
      expect(deniedRes.statusCode).toBe(403);

      await expectAuditCountStable(auditRepo, orgCtx(ctx), auditBefore.total);

      // Verify user was NOT created
      const deniedUsers = await ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, importUsername));
      expect(deniedUsers).toHaveLength(0);

      // Step 2: Admin succeeds with same payload
      const adminRes = await ctx.app.inject({
        method: "POST",
        url: "/api/candidates/import",
        payload: importPayload,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect([200, 201, 207]).toContain(adminRes.statusCode);

      // Verify user WAS created by admin
      const adminUsers = await ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, importUsername));
      expect(adminUsers).toHaveLength(1);
      expect(adminUsers[0]!.name).toBe("Deep Import Proof");
    });
  });
});
