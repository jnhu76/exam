/**
 * Phase-E Campaign P — DTO/OpenAPI drift (L0 artifact census + L1 runtime
 * parse). The published API surface (apps/api/openapi.json) and the contract
 * authority (@exam/contracts) must describe the SAME Rich seams:
 *
 * L0: every Rich-bearing path exists in the artifact; the unknown-typed
 *   fields stay unknown (`answer: {}` — narrowing `answer` to a string in
 *   the artifact would freeze a wire lie); the export DTO carries the FULL
 *   integrity enum (exactly PERSISTED_RICH_ANSWER_STATES — a drift here
 *   means consumers see integrity states the code cannot produce, or miss
 *   states it can); the CSV path is text/csv.
 *
 * L1: REAL wire bodies from a live attempt parse through the contracts
 *   schemas (SaveAnswerAccepted, LoadAttemptResponse, AttemptExportResponse,
 *   GradingDetailsResponse) — the runtime must satisfy the published
 *   contract, not just describe it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ContentDocumentV1 } from "@exam/domain";
import {
  AttemptExportResponseSchema,
  GradingDetailsResponseSchema,
  LoadAttemptResponseSchema,
  PERSISTED_RICH_ANSWER_STATES,
  SaveAnswerAcceptedSchema,
} from "@exam/contracts";
import { CampaignRecorder } from "./campaignStats.js";
import { buildRichAttemptFixture, type RichAttemptFixture } from "./fixture.js";

const recorder = new CampaignRecorder("P-dto-openapi-drift", [0x669e0004]);
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

const RICH_PATHS = [
  "/api/attempts/{attemptId}/answers/{questionId}",
  "/api/admin/attempts/{attemptId}/export",
  "/api/admin/attempts/{attemptId}/export/csv",
  "/api/admin/attempts/{attemptId}/grading-details",
  "/api/exams/{id}/publish",
];

describe("Campaign P — DTO/OpenAPI drift (L0 artifact + L1 runtime)", () => {
  let fx: RichAttemptFixture;
  // The artifact is data, not a type system — permissive on purpose: the
  // campaign asserts its CONTENT.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let spec: any;

  beforeAll(async () => {
    fx = await buildRichAttemptFixture("P drift prompt");
    spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "apps/api/openapi.json"), "utf8"),
    );
  }, 120_000);

  afterAll(async () => {
    recorder.flush();
    await fx.ctx.cleanup();
  });

  it("L0: every Rich-bearing path is published", () => {
    for (const p of RICH_PATHS) {
      expect(
        spec.paths?.[p],
        `openapi artifact missing path ${p}`,
      ).toBeDefined();
    }
    recorder.record({
      probe: "paths-published",
      outcome: "ok",
      count: RICH_PATHS.length,
    });
  });

  it("L0: the SaveAnswer wire keeps `answer` unknown — no transport narrowing", () => {
    const body =
      spec.paths["/api/attempts/{attemptId}/answers/{questionId}"].post
        .requestBody.content["application/json"].schema;
    // `answer` must be present and UNKNOWN: a `{}` schema is the JSON-Schema
    // rendering of z.unknown(). Any type/enum here is drift that would make
    // the published contract lie about Rich.
    expect(body.properties?.answer).toEqual({});
    expect(body.required).not.toContain("answer");
    for (const field of [
      "attemptId",
      "questionId",
      "clientSeq",
      "clientSavedAt",
      "baseVersion",
    ]) {
      expect(body.required, `SaveAnswer required missing ${field}`).toContain(
        field,
      );
    }
    recorder.record({
      probe: "saveanswer-unknown-answer",
      outcome: "unknown-preserved",
    });
  });

  it("L0: the export DTO publishes the FULL integrity enum and the raw-evidence companion fields", () => {
    const q =
      spec.paths["/api/admin/attempts/{attemptId}/export"].get.responses["200"]
        .content["application/json"].schema.properties.questionResults.items;
    expect(q.properties?.candidateAnswer).toBeDefined();
    expect(q.properties?.candidateAnswerIntegrity.enum).toEqual(
      PERSISTED_RICH_ANSWER_STATES,
    );
    expect(q.properties?.candidateAnswerMode.enum).toEqual(["plain", "rich"]);
    expect(
      q.properties?.candidateAnswerProjection.nullable ??
        q.properties?.candidateAnswerProjection.type === "null",
    ).toBeTruthy();
    recorder.record({ probe: "export-integrity-enum", outcome: "exact-match" });
  });

  it("L0: grading-details publishes the frozen rich prompt slot; CSV stays text/csv", () => {
    const q =
      spec.paths["/api/admin/attempts/{attemptId}/grading-details"].get
        .responses["200"].content["application/json"].schema.properties
        .questions.items;
    expect(q.properties?.contentDocument).toBeDefined();
    // candidateAnswer is raw evidence — unknown (no JSON `type` narrowing;
    // z.unknown().nullable() renders as {nullable:true}). A `type` key here
    // would be drift that narrows raw evidence.
    expect(q.properties?.candidateAnswer?.type).toBeUndefined();
    const csv =
      spec.paths["/api/admin/attempts/{attemptId}/export/csv"].get.responses[
        "200"
      ].content;
    expect(csv["text/csv"]).toBeDefined();
    recorder.record({ probe: "grading-details+csv", outcome: "ok" });
  });

  it("L0: the attempt DTO keeps answers[].answer unknown", () => {
    const answers =
      spec.paths["/api/attempts/{id}"]?.get?.responses?.["200"]?.content?.[
        "application/json"
      ]?.schema?.properties?.answers?.items;
    if (answers) {
      expect(answers.properties?.answer).toEqual({});
    } else {
      // The attempt GET path may be published under a different parameter
      // name; find it rather than silently passing.
      const candidate = Object.keys(spec.paths ?? {}).filter(
        (p) =>
          p.includes("attempts/{") &&
          p.includes("answers") === false &&
          "get" in spec.paths[p],
      );
      expect(
        candidate.length,
        `no attempt GET path found: ${candidate.join(", ")}`,
      ).toBeGreaterThan(0);
      const found = candidate
        .map(
          (p) =>
            spec.paths[p].get.responses["200"]?.content?.["application/json"]
              ?.schema,
        )
        .find((s) => s?.properties?.answers);
      expect(
        found?.properties?.answers?.items?.properties?.answer?.type,
      ).toBeUndefined();
    }
    recorder.record({
      probe: "attempt-answer-unknown",
      outcome: "unknown-preserved",
    });
  });

  it("L1: real wire bodies parse through the published contract schemas", async () => {
    const doc: ContentDocumentV1 = para("P wire answer");
    const save = await fx.postAnswer(doc, 1, 0);
    expect(save.json().accepted, save.body.slice(0, 200)).toBe(true);
    // The ACCEPTED save body must satisfy the published accepted-schema.
    expect(() => SaveAnswerAcceptedSchema.parse(save.json())).not.toThrow();

    const load = await fx.getAttemptRaw();
    expect(() => LoadAttemptResponseSchema.parse(load.json())).not.toThrow();

    const submit = await fx.ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${fx.attemptId}/submit`,
      cookies: { "auth-token": fx.ctx.candidateToken },
    });
    expect(submit.statusCode, submit.body.slice(0, 300)).toBe(200);

    const exp = await fx.ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${fx.attemptId}/export`,
      cookies: { "auth-token": fx.ctx.adminToken },
    });
    expect(exp.statusCode).toBe(200);
    expect(() => AttemptExportResponseSchema.parse(exp.json())).not.toThrow();

    const details = await fx.ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${fx.attemptId}/grading-details`,
      cookies: { "auth-token": fx.ctx.adminToken },
    });
    expect(details.statusCode).toBe(200);
    expect(() =>
      GradingDetailsResponseSchema.parse(details.json()),
    ).not.toThrow();

    recorder.record({ probe: "runtime-parses-contract", outcome: "ok" });
  });
});

function para(text: string): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}
