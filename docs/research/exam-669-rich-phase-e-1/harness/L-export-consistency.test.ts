/**
 * Phase-E Campaign L — export consistency (L4, real PostgreSQL, E-EX01/02).
 * The export boundary is a READER: raw evidence and semantic projection must
 * never blur. For every frozen-value status injected into the durable freeze
 * record (the same DB-history reality Campaign K uses), BOTH export forms
 * must agree with the shared read authority:
 *
 * E-EX01 (JSON export): `candidateAnswer` is the untouched stored value;
 *   `candidateAnswerMode` is the frozen slot mode; `candidateAnswerIntegrity`
 *   equals `classifyPersistedRichAnswer`; `candidateAnswerProjection` is the
 *   classifier-permitted derived text (present ONLY for rich_valid /
 *   rich_noncanonical / plain-integrity states; null for empty /
 *   unsupported_version / corrupt).
 *
 * E-EX02 (CSV export): the 考生答案 cell carries the projection or the
 *   not-applicable marker — a corrupt/unsupported Rich value must never read
 *   as a normal answer, and its raw JSON must appear NOWHERE in the CSV. The
 *   appended 考生答案模式/考生答案状态 columns carry the frozen mode and the
 *   integrity token.
 *
 * Everything expected is computed from the production authorities
 * (classifyPersistedRichAnswer + plainTextProjection), never from route code.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { plainTextProjection, type ContentDocumentV1 } from "@exam/domain";
import { classifyPersistedRichAnswer } from "@exam/contracts";
import { CampaignRecorder } from "./campaignStats.js";
import { buildRichAttemptFixture, type RichAttemptFixture } from "./fixture.js";

const recorder = new CampaignRecorder("L-export-consistency", [0x669e0004]);

function para(text: string): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

type StatusCase = {
  name: string;
  value: unknown;
  csvMustNotContain: string[]; // raw-evidence markers that must stay out of the CSV
};

const STATUS_CASES: StatusCase[] = [
  {
    name: "rich_valid",
    value: para("L canonical answer"),
    csvMustNotContain: [],
  },
  {
    name: "rich_noncanonical",
    value: {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "L noncanonical", marks: ["italic", "bold"] },
          ],
        },
      ],
    },
    csvMustNotContain: [],
  },
  {
    name: "corrupt",
    value: { docVersion: 1, type: "not-doc", content: [] },
    // The corrupt value's discriminating markers must not leak into the CSV
    // as if it were answer text (F-05).
    csvMustNotContain: ["not-doc"],
  },
  {
    name: "unsupported_version",
    value: { docVersion: 2, type: "doc", content: [] },
    csvMustNotContain: [],
  },
  { name: "empty-null", value: null, csvMustNotContain: [] },
  {
    name: "string-on-rich-slot",
    value: "legacy-looking string without provenance",
    csvMustNotContain: ["legacy-looking string without provenance"],
  },
];

async function submitAndInjectSubmitted(
  fx: RichAttemptFixture,
  value: unknown,
): Promise<void> {
  const res = await fx.postAnswer(para("L draft through the wire"), 1, 0);
  expect(res.json().accepted, res.body.slice(0, 200)).toBe(true);
  const submitRes = await fx.ctx.app.inject({
    method: "POST",
    url: `/api/attempts/${fx.attemptId}/submit`,
    cookies: { "auth-token": fx.ctx.candidateToken },
  });
  expect(submitRes.statusCode, submitRes.body.slice(0, 300)).toBe(200);

  // The export reads submitted_answers for a submitted row (EXSEM answer-
  // source authority), so the freeze record is the only slot to swap.
  const rows = await fx.ctx.db
    .select({ submitted: schema.examAttempts.submittedAnswers })
    .from(schema.examAttempts)
    .where(eq(schema.examAttempts.id, fx.attemptId));
  const submitted = rows[0].submitted!;
  submitted.answers[0]!.value = value;
  await fx.ctx.db
    .update(schema.examAttempts)
    .set({ submittedAnswers: submitted })
    .where(eq(schema.examAttempts.id, fx.attemptId));
}

describe("Campaign L — export × frozen-value status (L4, E-EX01/02)", () => {
  let fx: RichAttemptFixture;

  beforeAll(async () => {
    fx = await buildRichAttemptFixture("L export prompt");
  }, 120_000);

  afterAll(async () => {
    recorder.flush();
    await fx.ctx.cleanup();
  });

  for (const tc of STATUS_CASES) {
    it(`matrix [${tc.name}]: JSON raw + integrity + authority projection; CSV cell never dresses raw evidence as answer`, async () => {
      await fx.startNewAttempt();
      await submitAndInjectSubmitted(fx, tc.value);

      // Authority expectation, computed independently of the route.
      const read = classifyPersistedRichAnswer({
        value: tc.value,
        answerMode: "rich",
      });
      const projectionPermitted =
        read.kind === "rich_valid" ||
        read.kind === "rich_noncanonical" ||
        read.kind === "plain" ||
        read.kind === "legacy_plain";

      // ── E-EX01: JSON export ──
      const jsonRes = await fx.ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${fx.attemptId}/export`,
        cookies: { "auth-token": fx.ctx.adminToken },
      });
      expect(jsonRes.statusCode, jsonRes.body.slice(0, 300)).toBe(200);
      const q = (
        jsonRes.json().questionResults as Array<Record<string, unknown>>
      ).find((x) => (x.order as number) === 0);
      expect(q, "export missing order-0 question").toBeDefined();
      expect(q?.candidateAnswer).toEqual(tc.value);
      expect(q?.candidateAnswerMode).toBe("rich");
      expect(q?.candidateAnswerIntegrity).toBe(read.kind);
      if (projectionPermitted) {
        const doc =
          read.kind === "rich_valid" || read.kind === "rich_noncanonical"
            ? read.document
            : undefined;
        const expectedProjection =
          doc !== undefined
            ? plainTextProjection(doc)
            : // plain/legacy_plain projections come from the read text.
              ((read as { text?: string }).text ?? null);
        expect(q?.candidateAnswerProjection).toBe(expectedProjection);
      } else {
        expect(q?.candidateAnswerProjection).toBeNull();
      }

      // ── E-EX02: CSV export ──
      const csvRes = await fx.ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${fx.attemptId}/export/csv`,
        cookies: { "auth-token": fx.ctx.adminToken },
      });
      expect(csvRes.statusCode, csvRes.body.slice(0, 300)).toBe(200);
      const csv = csvRes.body;
      expect(csv.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM contract
      expect(csv).toContain("考生答案状态");
      expect(csv).toContain(String(read.kind));
      if (projectionPermitted && q?.candidateAnswerProjection) {
        expect(csv).toContain(q.candidateAnswerProjection as string);
      }
      for (const marker of tc.csvMustNotContain) {
        expect(
          csv.includes(marker),
          `CSV leaked raw evidence marker "${marker}" for ${tc.name} (F-05)`,
        ).toBe(false);
      }
      recorder.record({
        probe: `matrix-${tc.name}`,
        outcome: "json-raw+csv-projection-consistent",
        integrity: read.kind,
      });
    });
  }
});
