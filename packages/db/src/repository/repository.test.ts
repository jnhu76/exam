import { randomUUID } from "node:crypto";
import type { PublicBrandingContext, RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { createCourseRepo } from "./courseRepo.js";
import { createEnrollmentRepo } from "./enrollmentRepo.js";
import { createOrganizationRepo } from "./organizationRepo.js";
import { createQuestionRepo } from "./questionRepo.js";
import { createSettingsRepo } from "./settingsRepo.js";
import { schema } from "../schema/pg.js";
import type { Database } from "../types.js";

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
  let db: Database;
  let cleanup: () => Promise<void>;
  const publicBrandingContext: PublicBrandingContext = {
    purpose: "public_branding",
  };

  let organizationRepo: ReturnType<typeof createOrganizationRepo>;
  let settingsRepo: ReturnType<typeof createSettingsRepo>;
  let courseRepo: ReturnType<typeof createCourseRepo>;
  let questionRepo: ReturnType<typeof createQuestionRepo>;
  const rootContext = createContext("system", "Admin", "system");

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-repo-tenant");
    db = result.db;
    cleanup = result.cleanup;
    organizationRepo = createOrganizationRepo(db);
    settingsRepo = createSettingsRepo(db);
    courseRepo = createCourseRepo(db);
    questionRepo = createQuestionRepo(db);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
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

  it("Admin repository ops are scoped to organizationId, not targetOrganizationId (Phase 1 single-tenant)", async () => {
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
    const adminContext = createContext(alpha.id, "Admin", beta.id);

    const created = await courseRepo.create(adminContext, {
      name: "Safety",
      code: "SAFE",
      description: "",
    });
    expect(created).toMatchObject({ organizationId: alpha.id });
    expect(created.organizationId).not.toBe(beta.id);

    const alphaScopedReader = createContext(alpha.id);
    const betaScopedReader = createContext(beta.id);
    expect(
      await courseRepo.findById(alphaScopedReader, created.id),
    ).toMatchObject({ id: created.id });
    expect(await courseRepo.findById(betaScopedReader, created.id)).toBeNull();
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

describe("organizationRepo.resolveOptionalBrandingTenant", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let organizationRepo: ReturnType<typeof createOrganizationRepo>;
  const publicBrandingContext: PublicBrandingContext = {
    purpose: "public_branding",
  };
  const rootContext = createContext("system", "Admin", "system");

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-repo-org-optional");
    db = result.db;
    cleanup = result.cleanup;
    organizationRepo = createOrganizationRepo(db);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  });

  it("returns null when no organization exists", async () => {
    const result = await organizationRepo.resolveOptionalBrandingTenant(
      publicBrandingContext,
    );
    expect(result).toBeNull();
  });

  it("returns the organization when exactly one exists", async () => {
    const org = await organizationRepo.create(rootContext, {
      name: "single",
      displayName: "Single",
      slug: `single-${randomUUID().slice(0, 8)}`,
    });

    const result = await organizationRepo.resolveOptionalBrandingTenant(
      publicBrandingContext,
    );

    expect(result).toMatchObject({ id: org.id, slug: org.slug });
  });

  it("throws when multiple organizations exist", async () => {
    const suffix = randomUUID().slice(0, 8);
    await organizationRepo.create(rootContext, {
      name: "multi-a",
      displayName: "Multi A",
      slug: `multi-a-${suffix}`,
    });
    await organizationRepo.create(rootContext, {
      name: "multi-b",
      displayName: "Multi B",
      slug: `multi-b-${suffix}`,
    });

    await expect(
      organizationRepo.resolveOptionalBrandingTenant(publicBrandingContext),
    ).rejects.toThrow(
      "Multiple organizations exist; organizationSlug is required",
    );
  });
});

describe("enrollmentRepo.findByExamAndCandidateForUpdate", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  const rootContext = createContext("system", "Admin", "system");
  let orgId: string;
  let ctx: RequestContext;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-repo-enrollment");
    db = result.db;
    cleanup = result.cleanup;
    const orgRepo = createOrganizationRepo(db);
    const suffix = randomUUID().slice(0, 8);
    const org = await orgRepo.create(rootContext, {
      name: `forupdate-${suffix}`,
      displayName: `ForUpdate ${suffix}`,
      slug: `forupdate-${suffix}`,
    });
    orgId = org.id;
    ctx = createContext(orgId);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  });

  it("returns null when no enrollment exists", async () => {
    const repo = createEnrollmentRepo(db);
    const result = await repo.findByExamAndCandidateForUpdate(
      ctx,
      randomUUID(),
      randomUUID(),
    );
    expect(result).toBeNull();
  });

  it("exists as a method on the repo", async () => {
    const repo = createEnrollmentRepo(db);
    expect(typeof repo.findByExamAndCandidateForUpdate).toBe("function");
  });
});
