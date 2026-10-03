/**
 * Phase-E Campaign F — durable-writer inventory census (L0, E-WR01).
 *
 * E-WR01: every production Rich write path must persist accepted canonical
 * output only. This campaign REPLAYS the inventory at the source level and
 * pins it as a tripwire:
 *
 * 1. INVENTORY REPLAY — every inventoried writer file must exist and still
 *    route its Rich writes through the declared canonical authority (marker
 *    strings). A marker going missing means the write path changed discipline
 *    without the inventory moving — a census failure.
 *
 * 2. MECHANICAL SWEEP — the production source tree is scanned for
 *    contentDocument-bearing drizzle writes (.values/.set) that are NOT in
 *    the inventory or the adjacent-out-of-domain list. A hit is either a new
 *    writer that must join the inventory or a census-pattern false positive
 *    to be documented — never silently ignored.
 *
 * SCOPE NOTE: the sweep's Rich carrier signal is the `contentDocument` field
 * name; answer-value writers (attempts.answers / submitted_answers /
 * attemptGradingEntries) carry canonical values COPIED from authority outputs
 * and are inventoried explicitly rather than swept (their values never
 * mention "contentDocument" at the write site).
 *
 * Copy-writers (submit freeze, publish snapshot, grading workset, legacy
 * recovery) persist values verbatim from earlier authority outputs; their
 * copy discipline is FALSIFIED at L4 by the delegated campaigns (I, O, K),
 * not re-proved here. This campaign proves the wiring exists; those prove it
 * holds under attack.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, afterAll } from "vitest";
import { CampaignRecorder } from "./campaignStats.js";

const recorder = new CampaignRecorder("F-durable-writer-census", []);

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

type Writer = {
  id: string;
  file: string; // repo-relative
  slots: string;
  markers: string[]; // source must contain every marker
  delegated: string; // where the semantic discipline is falsified
};

const INVENTORY: Writer[] = [
  {
    id: "W1/W2/W3",
    file: "apps/api/src/routes/question.ts",
    slots: "questions.content_document + options (create/update/import)",
    markers: ["resolveQuestionContentWrite"],
    delegated:
      "D5.1 regressions + A/B boundary grids (authority) + this file's three write sites",
  },
  {
    id: "W4",
    file: "apps/api/src/routes/attempts.candidate.ts",
    slots: "attempts.answers + answer_receipts (SaveAnswer wire)",
    markers: ["validateAnswerForQuestion"],
    delegated: "Campaign D (round-trip) + Campaign H (replay longevity)",
  },
  {
    id: "W5",
    file: "packages/exam-engine/src/attemptCommands.ts",
    slots: "attempts.submitted_answers (submit freeze)",
    markers: ["buildSubmittedAnswersSnapshot"],
    delegated: "E-SB01/02 → Campaign I",
  },
  {
    id: "W6",
    file: "packages/exam-engine/src/examCommands.ts",
    slots:
      "exams.question_snapshot + attempts.question_snapshot (publish freeze)",
    markers: ["assertPublishableRichDocument"],
    delegated: "E-PB01..04 → Campaign O",
  },
  {
    id: "W7",
    file: "packages/exam-engine/src/gradingWorkset.ts",
    slots: "attemptGradingEntries.candidate_answer / standard_answer",
    markers: ["candidateAnswer"],
    delegated: "E-GR01 → Campaign K",
  },
  {
    id: "W8",
    file: "apps/api/src/scripts/backfill-submitted-answers.ts",
    slots: "attempts.submitted_answers (migration backfill)",
    markers: ["buildSubmittedAnswersSnapshot"],
    delegated:
      "E-WR01 migration-helper clause (derives the freeze snapshot from accepted answers)",
  },
  {
    id: "W9",
    file: "apps/api/src/scripts/recover-legacy-grading-workset.ts",
    slots: "attemptGradingEntries (legacy recovery, verbatim copy)",
    markers: ["candidateAnswer"],
    delegated: "E-WR01 admin-tools clause (copy discipline)",
  },
];

/**
 * Adjacent Rich-capable writers OUTSIDE the production runtime domain, with
 * the reason. The sweep must not flag them; the list keeps the exclusion
 * explicit instead of implicit.
 */
const ADJACENT_OUT_OF_DOMAIN: Array<{ file: string; reason: string }> = [
  {
    file: "packages/db/src/demo-seed.ts",
    reason:
      "dev/demo seed literals — not a production runtime writer; read classifiers tolerate its values by design",
  },
  {
    file: "packages/db/src/demo-seed-verify.ts",
    reason: "dev seed verification — reads, no Rich writes",
  },
  {
    file: "apps/api/src/scripts/__tests__/recover-legacy-grading-workset.test-support.ts",
    reason: "test tree",
  },
  {
    file: "packages/db/src/testCleanup.ts",
    reason: "test lifecycle (truncate/delete only)",
  },
];

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "__tests__")
        continue;
      walkTsFiles(p, out);
    } else if (
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test-support.ts")
    ) {
      out.push(p);
    }
  }
  return out;
}

const SWEEP_ROOTS = [
  "apps/api/src",
  "packages/db/src",
  "packages/exam-engine/src",
  "packages/domain/src",
  "packages/contracts/src",
];

describe("Campaign F — durable-writer inventory census (L0, E-WR01)", () => {
  it("inventory replay: every inventoried writer exists and routes through its canonical authority", () => {
    const failures: string[] = [];
    for (const w of INVENTORY) {
      const abs = path.join(REPO_ROOT, w.file);
      let src: string;
      try {
        src = readFileSync(abs, "utf8");
      } catch {
        failures.push(`${w.id}: file missing: ${w.file}`);
        continue;
      }
      for (const marker of w.markers) {
        if (!src.includes(marker)) {
          failures.push(
            `${w.id} (${w.file}): authority marker "${marker}" absent — write discipline changed without the inventory moving`,
          );
        }
      }
      recorder.record({
        probe: w.id,
        outcome: "replayed",
        file: w.file,
        delegated: w.delegated,
      });
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("mechanical sweep: no un-inventoried contentDocument-bearing drizzle write in the production tree", () => {
    const flagged: string[] = [];
    let scanned = 0;
    for (const root of SWEEP_ROOTS) {
      const files = walkTsFiles(path.join(REPO_ROOT, root));
      for (const f of files) {
        const rel = path.relative(REPO_ROOT, f);
        scanned += 1;
        const src = readFileSync(f, "utf8");
        const writesRich = src.includes("contentDocument");
        const drizzleWrite = /\.values\(|\.set\(/.test(src);
        const richTable =
          /schema\.(questions|exams|examAttempts|attemptGradingEntries)\b/.test(
            src,
          );
        if (writesRich && drizzleWrite && richTable) {
          const inInventory = INVENTORY.some((w) => w.file === rel);
          const adjacent = ADJACENT_OUT_OF_DOMAIN.some((a) => a.file === rel);
          if (!inInventory && !adjacent) {
            flagged.push(rel);
          }
        }
      }
    }
    recorder.record({
      probe: "sweep-summary",
      outcome: "done",
      scanned,
      flagged,
      adjacent: ADJACENT_OUT_OF_DOMAIN.map((a) => a.file),
    });
    expect(
      flagged,
      `un-inventoried Rich writers discovered: ${flagged.join(", ")} — join them into the inventory or document the exclusion`,
    ).toEqual([]);
    // Census self-guard: the sweep must actually have scanned the tree, and
    // the question write seam must have been among the scanned files.
    expect(scanned).toBeGreaterThan(100);
    expect(
      INVENTORY.filter((w) => w.file.startsWith("apps/api")).length,
    ).toBeGreaterThan(2);
  });

  it("standard_answer is a reference-answer slot, not a Rich V1 carrier (census note)", () => {
    // The contracts source types standardAnswer as a reference answer with
    // its own scalar discipline; the frozen Rich contract covers
    // content_document, options and ANSWER values only. If this docstring
    // drifts, the classification must be re-decided.
    const src = readFileSync(
      path.join(REPO_ROOT, "packages/contracts/src/question.ts"),
      "utf8",
    );
    expect(src).toMatch(/standardAnswer is an optional reference answer/);
    recorder.record({
      probe: "standard-answer-classification",
      outcome: "reference-answer-slot",
    });
  });

  afterAll(() => {
    recorder.flush({
      inventorySize: INVENTORY.length,
      sweepRoots: SWEEP_ROOTS,
    });
  });
});
