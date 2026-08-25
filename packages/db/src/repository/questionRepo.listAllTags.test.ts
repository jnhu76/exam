import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { createQuestionRepo } from "./questionRepo.js";
import type { Database } from "../types.js";
import { sql } from "drizzle-orm";

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
    targetOrganizationId: organizationId,
  };
}

async function insertOrg(
  db: Database,
  id: string,
  slug: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(sql`
    insert into organizations (id, name, display_name, slug, created_at, updated_at)
    values (${id}, ${slug}, ${slug}, ${slug}, ${now}::timestamptz, ${now}::timestamptz)
  `);
}

async function insertCourse(
  db: Database,
  id: string,
  organizationId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(sql`
    insert into courses (id, organization_id, name, code, description, created_at, updated_at)
    values (${id}, ${organizationId}, ${id}, ${id.slice(0, 8)}, '', ${now}::timestamptz, ${now}::timestamptz)
  `);
}

/**
 * Inserts a question row directly with a RAW jsonb `tags` value, bypassing
 * the typed repo, to simulate a legacy row whose tags column is not an array
 * (possible from pre-grammar writes or manual DB edits).
 */
async function insertQuestionWithRawTags(
  db: Database,
  organizationId: string,
  courseId: string,
  content: string,
  tagsJson: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(sql`
    insert into questions (id, organization_id, course_id, type, content, options,
      standard_answer, rubric, attachments, score, difficulty, tags, grading_rule, created_at, updated_at)
    values (${randomUUID()}, ${organizationId}, ${courseId}, 'true_false', ${content},
      '[]'::jsonb, null, null, '[]'::jsonb, 1, 1, ${tagsJson}::jsonb, '{}'::jsonb, ${now}::timestamptz, ${now}::timestamptz)
  `);
}

/**
 * P3 regression: listAllTags is raw tenant-scoped SQL that expands the tags
 * jsonb column. It must (a) survive a legacy non-array tags value without
 * erroring the whole listing, (b) stay scoped to the requesting org.
 */
describe("questionRepo.listAllTags (vocabulary resilience)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const courseA = randomUUID();
  const courseB = randomUUID();
  let ctxA: RequestContext;
  let ctxB: RequestContext;
  let repo: ReturnType<typeof createQuestionRepo>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-repo-question-tags");
    db = result.db;
    cleanup = result.cleanup;
    repo = createQuestionRepo(db);
    ctxA = createContext(orgA);
    ctxB = createContext(orgB);

    await insertOrg(db, orgA, `orga-${orgA.slice(0, 8)}`);
    await insertOrg(db, orgB, `orgb-${orgB.slice(0, 8)}`);
    await insertCourse(db, courseA, orgA);
    await insertCourse(db, courseB, orgB);

    await repo.create(ctxA, {
      courseId: courseA,
      type: "true_false",
      content: "vocab one",
      options: [],
      standardAnswer: true,
      attachments: [],
      score: 1,
      difficulty: 1,
      tags: ["beta", "alpha"],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
    });
    await repo.create(ctxA, {
      courseId: courseA,
      type: "true_false",
      content: "vocab two",
      options: [],
      standardAnswer: true,
      attachments: [],
      score: 1,
      difficulty: 1,
      tags: ["alpha", "gamma"],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
    });
    // legacy non-array tags: a scalar and an object, plus an array containing
    // a jsonb null element and an empty string (not produced by the API, but
    // survivable shapes for the expansion).
    await insertQuestionWithRawTags(
      db,
      orgA,
      courseA,
      "legacy scalar",
      '"scalar"',
    );
    await insertQuestionWithRawTags(
      db,
      orgA,
      courseA,
      "legacy object",
      '{"k":1}',
    );
    await insertQuestionWithRawTags(
      db,
      orgA,
      courseA,
      "mixed elements",
      '["real", null, ""]',
    );
    // another org's tag must never leak into org A's vocabulary
    await insertQuestionWithRawTags(
      db,
      orgB,
      courseB,
      "org b question",
      '["orgb-only"]',
    );
  });

  afterAll(async () => {
    await cleanup();
  });

  it("survives legacy non-array tags values and excludes them from the vocabulary", async () => {
    const tags = await repo.listAllTags(ctxA);
    // scalar/object legacy rows are dropped entirely; null and empty-string
    // elements inside an array are dropped; valid string elements remain.
    expect(tags).toEqual(["alpha", "beta", "gamma", "real"]);
    expect(tags.some((tag) => tag === "" || tag === null)).toBe(false);
    expect(tags.some((tag) => tag.includes("scalar"))).toBe(false);
  });

  it("excludes other organizations' tags (raw tenant-scoped SQL)", async () => {
    const tagsB = await repo.listAllTags(ctxB);
    expect(tagsB).toEqual(["orgb-only"]);
    const tagsA = await repo.listAllTags(ctxA);
    expect(tagsA).not.toContain("orgb-only");
  });

  it("returns distinct sorted tags", async () => {
    const tags = await repo.listAllTags(ctxA);
    const sortedCopy = [...tags].sort();
    expect(tags).toEqual(sortedCopy);
    expect(new Set(tags).size).toBe(tags.length);
  });
});
