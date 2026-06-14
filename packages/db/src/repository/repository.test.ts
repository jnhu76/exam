import { randomUUID } from "node:crypto";
import type { PublicBrandingContext, RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { getTestDb } from "../testDb.js";
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

  let organizationRepo: ReturnType<typeof createOrganizationRepo>;
  let settingsRepo: ReturnType<typeof createSettingsRepo>;
  let courseRepo: ReturnType<typeof createCourseRepo>;
  let questionRepo: ReturnType<typeof createQuestionRepo>;
  const rootContext = createContext("system", "Admin", "system");

  beforeAll(async () => {
    const { db } = await getTestDb();
    organizationRepo = createOrganizationRepo(db);
    settingsRepo = createSettingsRepo(db);
    courseRepo = createCourseRepo(db);
    questionRepo = createQuestionRepo(db);
  });

  it("keeps tenant-scoped course queries isolated", async () => {
    const suffix = randomUUID().slice(0, 8);
    const alpha = await organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: `alpha-${suffix}`,
    });
    const beta = await organizationRepo.create(rootContext, {
      name: "beta",
      displayName: "Beta",
      slug: `beta-${suffix}`,
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
    const suffix = randomUUID().slice(0, 8);
    const alpha = await organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: `alpha-${suffix}`,
    });
    const beta = await organizationRepo.create(rootContext, {
      name: "beta",
      displayName: "Beta",
      slug: `beta-${suffix}`,
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

  it("Admin repository ops are scoped to organizationId (Phase 1 single-tenant)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const alpha = await organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: `alpha-${suffix}`,
    });
    const adminContext = createContext(alpha.id, "Admin", alpha.id);

    expect(
      await courseRepo.create(adminContext, {
        name: "Safety",
        code: "SAFE",
        description: "",
      }),
    ).toMatchObject({ organizationId: alpha.id });
  });

  it("filters question lookups by organizationId", async () => {
    const suffix = randomUUID().slice(0, 8);
    const alpha = await organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug: `alpha-${suffix}`,
    });
    const beta = await organizationRepo.create(rootContext, {
      name: "beta",
      displayName: "Beta",
      slug: `beta-${suffix}`,
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
    const suffix = randomUUID().slice(0, 8);
    const slug = `alpha-${suffix}`;
    const alpha = await organizationRepo.create(rootContext, {
      name: "alpha",
      displayName: "Alpha",
      slug,
    });
    const alphaContext = createContext(alpha.id);

    await settingsRepo.upsert(alphaContext, {
      productName: "LAN Exam",
      productSubtitle: "Internal assessment",
      timezone: "Asia/Shanghai",
    });

    const tenant = await organizationRepo.resolveBrandingTenant(
      publicBrandingContext,
      slug,
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
