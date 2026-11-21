import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@exam/db/schema/pg";
import { createExamRepo } from "@exam/db/repository/examRepo";
import type { Exam } from "@exam/domain";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import { buildTestApp, uniquePrefix, type TestContext } from "./testHelpers.js";

/**
 * #1040: PATCH presence semantics for the draft policy columns.
 *
 * The exams row stores `control_flags` as a jsonb column the repo update
 * replaces WHOLE-COLUMN, and `result_publication_mode` as a scalar column.
 * These tests pin the wire contract that an OMITTED field is never
 * interpreted as "reset this policy to its default":
 *
 * - an unrelated PATCH ({title}) must leave the persisted publication mode
 *   and control flags untouched (API response AND database row);
 * - a partial controlFlags payload merges with the current authoritative
 *   flags and the stored object still satisfies the canonical full schema;
 * - the legacy `controlFlags.showResultImmediately` input keeps its
 *   create-parity coercion ONLY when explicitly sent;
 * - a PATCH whose fields all resolve to the current values performs no
 *   business-state write and emits no `exam.update` audit event.
 */
describe("exam PATCH policy-field presence semantics (#1040)", () => {
  let ctx: TestContext;
  let courseId: string;
  let questionId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "P1B Presence Course",
        code: `P1B-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;

    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "P1B presence question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  function adminCtx() {
    return {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
  }

  async function createDraftExam(
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: `P1B-${uniquePrefix()}`,
        courseId,
        durationMinutes: 30,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
        ...overrides,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  async function patchExam(
    id: string,
    payload: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${id}`,
      payload,
      cookies: { "auth-token": ctx.adminToken },
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  async function readStoredExam(id: string): Promise<Exam> {
    const stored = (await createExamRepo(ctx.db).findById(
      adminCtx(),
      id,
    )) as Exam | null;
    expect(stored).not.toBeNull();
    return stored as Exam;
  }

  async function countExamUpdateAudits(examId: string): Promise<number> {
    const rows = await ctx.db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "exam.update"),
          eq(schema.auditLogs.targetId, examId),
        ),
      );
    return rows.length;
  }

  /** Full canonical control-flags vocabulary (non-default values where safe). */
  const FULL_FLAGS = {
    shuffleQuestions: false,
    shuffleOptions: true,
    detectTabSwitch: false,
    disableCopyPaste: false,
    requireQueue: true,
    batchSize: 5,
    batchInterval: 7,
    restrictIp: false,
    requireLockdown: false,
    showResultImmediately: false,
  } as const;

  const CANONICAL_FLAG_KEYS = [
    "shuffleQuestions",
    "shuffleOptions",
    "detectTabSwitch",
    "disableCopyPaste",
    "requireQueue",
    "batchSize",
    "batchInterval",
    "restrictIp",
    "requireLockdown",
    "showResultImmediately",
  ].sort();

  // ── Case A: omitted publication mode survives an unrelated PATCH ──

  it("PATCH {title} on a draft keeps resultPublicationMode=manual (API + DB)", async () => {
    const id = await createDraftExam({ resultPublicationMode: "manual" });
    const { statusCode, body } = await patchExam(id, {
      title: "Changed title",
    });
    expect(statusCode).toBe(200);
    expect(body.title).toBe("Changed title");
    expect(body.resultPublicationMode).toBe("manual");
    expect((await readStoredExam(id)).resultPublicationMode).toBe("manual");
  });

  it("PATCH {title} on a draft keeps resultPublicationMode=after_grading (API + DB)", async () => {
    const id = await createDraftExam({
      resultPublicationMode: "after_grading",
    });
    const { statusCode, body } = await patchExam(id, {
      title: "Changed title",
    });
    expect(statusCode).toBe(200);
    expect(body.resultPublicationMode).toBe("after_grading");
    expect((await readStoredExam(id)).resultPublicationMode).toBe(
      "after_grading",
    );
  });

  // ── Case B: partial controlFlags merge with the authoritative state ──

  it("PATCH partial controlFlags changes only the explicit flag and keeps the rest (API + DB)", async () => {
    const id = await createDraftExam({
      resultPublicationMode: "after_grading",
      controlFlags: { ...FULL_FLAGS },
    });
    const { statusCode, body } = await patchExam(id, {
      controlFlags: { shuffleQuestions: true },
    });
    expect(statusCode).toBe(200);

    const apiFlags = body.controlFlags as Record<string, unknown>;
    expect(apiFlags.shuffleQuestions).toBe(true);
    expect(apiFlags.requireQueue).toBe(true);
    expect(apiFlags.batchSize).toBe(5);
    expect(apiFlags.batchInterval).toBe(7);
    expect(apiFlags.shuffleOptions).toBe(true);

    const stored = await readStoredExam(id);
    expect(stored.controlFlags).toEqual({
      ...FULL_FLAGS,
      shuffleQuestions: true,
    });
    // The stored object remains a COMPLETE canonical control-flags value —
    // the jsonb column is whole-column replaced, so the merge must persist
    // the full vocabulary, not the partial payload.
    expect(Object.keys(stored.controlFlags).sort()).toEqual(
      CANONICAL_FLAG_KEYS,
    );
    // The omitted publication policy is untouched by the flags PATCH too.
    expect(stored.resultPublicationMode).toBe("after_grading");
  });

  it("PATCH controlFlags without the legacy flag leaves the publication mode untouched", async () => {
    const id = await createDraftExam({ resultPublicationMode: "manual" });
    const { statusCode, body } = await patchExam(id, {
      controlFlags: { shuffleQuestions: true },
    });
    expect(statusCode).toBe(200);
    expect(body.resultPublicationMode).toBe("manual");
    expect((await readStoredExam(id)).resultPublicationMode).toBe("manual");
  });

  // ── Case C: legacy showResultImmediately compatibility ──

  it("explicit legacy showResultImmediately=true coerces the mode to immediate and persists full flags", async () => {
    const id = await createDraftExam({
      resultPublicationMode: "manual",
      controlFlags: { ...FULL_FLAGS },
    });
    const { statusCode, body } = await patchExam(id, {
      controlFlags: { showResultImmediately: true },
    });
    expect(statusCode).toBe(200);
    expect(body.resultPublicationMode).toBe("immediate");
    const stored = await readStoredExam(id);
    expect(stored.resultPublicationMode).toBe("immediate");
    expect(stored.controlFlags).toEqual({
      ...FULL_FLAGS,
      showResultImmediately: true,
    });
  });

  it("explicit legacy showResultImmediately=false coerces the mode to manual and persists full flags", async () => {
    const id = await createDraftExam({ resultPublicationMode: "immediate" });
    const { statusCode, body } = await patchExam(id, {
      controlFlags: { showResultImmediately: false },
    });
    expect(statusCode).toBe(200);
    expect(body.resultPublicationMode).toBe("manual");
    const stored = await readStoredExam(id);
    expect(stored.resultPublicationMode).toBe("manual");
    expect(stored.controlFlags.showResultImmediately).toBe(false);
    expect(Object.keys(stored.controlFlags).sort()).toEqual(
      CANONICAL_FLAG_KEYS,
    );
  });

  it("an explicit resultPublicationMode wins over the legacy flag (explicit > legacy)", async () => {
    const id = await createDraftExam({ resultPublicationMode: "manual" });
    const { statusCode, body } = await patchExam(id, {
      resultPublicationMode: "after_grading",
      controlFlags: { showResultImmediately: true },
    });
    expect(statusCode).toBe(200);
    expect(body.resultPublicationMode).toBe("after_grading");
    expect((await readStoredExam(id)).resultPublicationMode).toBe(
      "after_grading",
    );
  });

  // ── Case D: no-op PATCH writes no business state and audits nothing ──

  it("same-value PATCH {title} writes nothing and emits no exam.update audit", async () => {
    const id = await createDraftExam({
      title: "Same title",
      resultPublicationMode: "manual",
      controlFlags: { ...FULL_FLAGS },
    });
    await ctx.drainAuditWrites();
    const auditsBefore = await countExamUpdateAudits(id);
    const storedBefore = await readStoredExam(id);

    const { statusCode, body } = await patchExam(id, { title: "Same title" });
    expect(statusCode).toBe(200);
    expect(body.title).toBe("Same title");

    await ctx.drainAuditWrites();
    expect(await countExamUpdateAudits(id)).toBe(auditsBefore);
    const storedAfter = await readStoredExam(id);
    expect(storedAfter.resultPublicationMode).toBe("manual");
    expect(storedAfter.controlFlags).toEqual(storedBefore.controlFlags);
    expect(storedAfter.updatedAt).toEqual(storedBefore.updatedAt);
  });

  it("same-value partial controlFlags keeps the stored flags complete (no column wipe, no audit)", async () => {
    const id = await createDraftExam({
      resultPublicationMode: "manual",
      controlFlags: { ...FULL_FLAGS },
    });
    await ctx.drainAuditWrites();
    const auditsBefore = await countExamUpdateAudits(id);

    // shuffleQuestions is already false in FULL_FLAGS — a same-value partial
    // must not wipe the column nor resurrect the default publication mode.
    const { statusCode, body } = await patchExam(id, {
      controlFlags: { shuffleQuestions: false },
    });
    expect(statusCode).toBe(200);

    await ctx.drainAuditWrites();
    expect(await countExamUpdateAudits(id)).toBe(auditsBefore);
    const stored = await readStoredExam(id);
    expect(stored.controlFlags).toEqual({ ...FULL_FLAGS });
    expect(stored.resultPublicationMode).toBe("manual");
    const apiFlags = body.controlFlags as Record<string, unknown>;
    expect(apiFlags).toEqual({ ...FULL_FLAGS });
  });
});
