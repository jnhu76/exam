import { randomUUID } from "node:crypto";
import type { PublicBrandingContext, RequestContext } from "@exam/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createSqliteDatabase, migrateSqlite } from "../sqlite.js";
import { createCourseRepo } from "./courseRepo.js";
import { createOrganizationRepo } from "./organizationRepo.js";
import { createQuestionRepo } from "./questionRepo.js";
import { createSettingsRepo } from "./settingsRepo.js";

const permissions: RequestContext["permissions"] = [];

function createContext(
  organizationId: string,
  role: RequestContext["role"] = "Admin",
  targetOrganizationId?: string,
): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role,
    permissions,
    sessionId: randomUUID(),
    ...(targetOrganizationId ? { targetOrganizationId } : {}),
  };
}

describe("repository tenant isolation", () => {
  const publicBrandingContext: PublicBrandingContext = {
    purpose: "public_branding",
  };

  let database: ReturnType<typeof createSqliteDatabase>;
  let organizationRepo: ReturnType<typeof createOrganizationRepo>;
  let settingsRepo: ReturnType<typeof createSettingsRepo>;
  let courseRepo: ReturnType<typeof createCourseRepo>;
  let questionRepo: ReturnType<typeof createQuestionRepo>;
  const rootContext = createContext("system", "SuperAdmin", "system");

  beforeEach(() => {
    database = createSqliteDatabase(":memory:");
    migrateSqlite(database.db);
    organizationRepo = createOrganizationRepo(database.db);
    settingsRepo = createSettingsRepo(database.db);
    courseRepo = createCourseRepo(database.db);
    questionRepo = createQuestionRepo(database.db);
  });

  it("keeps tenant-scoped course queries isolated", async () => {
    const alpha = await organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: "alpha",
    });
    const beta = await organizationRepo.create(rootContext, {
      name: "beta",
      displayName: "Beta",
      slug: "beta",
    });
    const alphaContext = createContext(alpha.id);
    const betaContext = createContext(beta.id);

    const course = await courseRepo.create(alphaContext, {
      name: "Safety",
      code: "SAFE",
      description: "",
    });

    expect(await courseRepo.findById(alphaContext, course.id)).toMatchObject({
      id: course.id,
      organizationId: alpha.id,
    });
    expect(await courseRepo.findById(betaContext, course.id)).toBeNull();
    expect(await courseRepo.list(betaContext)).toEqual([]);
  });

  it("updates and deletes tenant records without crossing tenant boundaries", async () => {
    const alpha = await organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: "alpha",
    });
    const beta = await organizationRepo.create(rootContext, {
      name: "beta",
      displayName: "Beta",
      slug: "beta",
    });
    const alphaContext = createContext(alpha.id);
    const betaContext = createContext(beta.id);
    const course = await courseRepo.create(alphaContext, {
      name: "Safety",
      code: "SAFE",
      description: "",
    });

    expect(
      await courseRepo.update(betaContext, course.id, { name: "Wrong tenant" }),
    ).toBeNull();
    expect(await courseRepo.delete(betaContext, course.id)).toBe(false);

    expect(
      await courseRepo.update(alphaContext, course.id, {
        name: "Safety updated",
      }),
    ).toMatchObject({ id: course.id, name: "Safety updated" });
    expect(await courseRepo.delete(alphaContext, course.id)).toBe(true);
    expect(await courseRepo.findById(alphaContext, course.id)).toBeNull();
  });

  it("requires SuperAdmin to select a target tenant explicitly", async () => {
    const alpha = await organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: "alpha",
    });
    const superAdminContext = createContext(alpha.id, "SuperAdmin");

    await expect(
      courseRepo.create(superAdminContext, {
        name: "Safety",
        code: "SAFE",
        description: "",
      }),
    ).rejects.toThrow("targetOrganizationId");

    const targetedContext = createContext(alpha.id, "SuperAdmin", alpha.id);
    expect(
      await courseRepo.create(targetedContext, {
        name: "Safety",
        code: "SAFE",
        description: "",
      }),
    ).toMatchObject({ organizationId: alpha.id });
  });

  it("filters question lookups by organizationId", async () => {
    const alpha = await organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: "alpha",
    });
    const beta = await organizationRepo.create(rootContext, {
      name: "beta",
      displayName: "Beta",
      slug: "beta",
    });
    const alphaContext = createContext(alpha.id);
    const betaContext = createContext(beta.id);
    const course = await courseRepo.create(alphaContext, {
      name: "Safety",
      code: "SAFE",
      description: "",
    });
    const question = await questionRepo.create(alphaContext, {
      courseId: course.id,
      type: "true_false",
      content: "Is this statement correct?",
      options: [],
      standardAnswer: true,
      attachments: [],
      score: 1,
      difficulty: 1,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
    });

    expect(
      await questionRepo.findById(alphaContext, question.id),
    ).toMatchObject({
      id: question.id,
      organizationId: alpha.id,
    });
    expect(await questionRepo.findById(betaContext, question.id)).toBeNull();
  });

  it("returns only public branding fields before login", async () => {
    const alpha = await organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: "alpha",
    });
    const alphaContext = createContext(alpha.id);

    await settingsRepo.upsert(alphaContext, {
      productName: "LAN Exam",
      productSubtitle: "Internal assessment",
      timezone: "Asia/Shanghai",
    });

    const tenant = await organizationRepo.resolveBrandingTenant(
      publicBrandingContext,
      "alpha",
    );
    const branding = await settingsRepo.getPublicBranding({
      purpose: "public_branding",
      organizationId: tenant.id,
    });

    expect(branding).toEqual({
      productName: "LAN Exam",
      productSubtitle: "Internal assessment",
      organizationDisplayName: "Alpha",
    });
    expect(branding).not.toHaveProperty("timezone");
    expect(branding).not.toHaveProperty("organizationId");
  });
});
