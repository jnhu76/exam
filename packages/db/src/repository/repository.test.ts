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

  it("keeps tenant-scoped course queries isolated", () => {
    const alpha = organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: "alpha",
    });
    const beta = organizationRepo.create(rootContext, {
      name: "beta",
      displayName: "Beta",
      slug: "beta",
    });
    const alphaContext = createContext(alpha.id);
    const betaContext = createContext(beta.id);

    const course = courseRepo.create(alphaContext, {
      name: "Safety",
      code: "SAFE",
      description: "",
    });

    expect(courseRepo.findById(alphaContext, course.id)).toMatchObject({
      id: course.id,
      organizationId: alpha.id,
    });
    expect(courseRepo.findById(betaContext, course.id)).toBeNull();
    expect(courseRepo.list(betaContext)).toEqual([]);
  });

  it("updates and deletes tenant records without crossing tenant boundaries", () => {
    const alpha = organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: "alpha",
    });
    const beta = organizationRepo.create(rootContext, {
      name: "beta",
      displayName: "Beta",
      slug: "beta",
    });
    const alphaContext = createContext(alpha.id);
    const betaContext = createContext(beta.id);
    const course = courseRepo.create(alphaContext, {
      name: "Safety",
      code: "SAFE",
      description: "",
    });

    expect(
      courseRepo.update(betaContext, course.id, { name: "Wrong tenant" }),
    ).toBeNull();
    expect(courseRepo.delete(betaContext, course.id)).toBe(false);

    expect(
      courseRepo.update(alphaContext, course.id, { name: "Safety updated" }),
    ).toMatchObject({ id: course.id, name: "Safety updated" });
    expect(courseRepo.delete(alphaContext, course.id)).toBe(true);
    expect(courseRepo.findById(alphaContext, course.id)).toBeNull();
  });

  it("requires SuperAdmin to select a target tenant explicitly", () => {
    const alpha = organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: "alpha",
    });
    const superAdminContext = createContext(alpha.id, "SuperAdmin");

    expect(() =>
      courseRepo.create(superAdminContext, {
        name: "Safety",
        code: "SAFE",
        description: "",
      }),
    ).toThrow("targetOrganizationId");

    const targetedContext = createContext(alpha.id, "SuperAdmin", alpha.id);
    expect(
      courseRepo.create(targetedContext, {
        name: "Safety",
        code: "SAFE",
        description: "",
      }),
    ).toMatchObject({ organizationId: alpha.id });
  });

  it("filters question lookups by organizationId", () => {
    const alpha = organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: "alpha",
    });
    const beta = organizationRepo.create(rootContext, {
      name: "beta",
      displayName: "Beta",
      slug: "beta",
    });
    const alphaContext = createContext(alpha.id);
    const betaContext = createContext(beta.id);
    const course = courseRepo.create(alphaContext, {
      name: "Safety",
      code: "SAFE",
      description: "",
    });
    const question = questionRepo.create(alphaContext, {
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

    expect(questionRepo.findById(alphaContext, question.id)).toMatchObject({
      id: question.id,
      organizationId: alpha.id,
    });
    expect(questionRepo.findById(betaContext, question.id)).toBeNull();
  });

  it("returns only public branding fields before login", () => {
    const alpha = organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: "alpha",
    });
    const alphaContext = createContext(alpha.id);

    settingsRepo.upsert(alphaContext, {
      productName: "LAN Exam",
      productSubtitle: "Internal assessment",
      timezone: "Asia/Shanghai",
    });

    const tenant = organizationRepo.resolveBrandingTenant(
      publicBrandingContext,
      "alpha",
    );
    const branding = settingsRepo.getPublicBranding({
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
