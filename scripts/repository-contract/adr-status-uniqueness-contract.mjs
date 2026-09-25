#!/usr/bin/env node
/**
 * ADR current-status uniqueness contract.
 *
 * Relation checked: each ADR under docs/adr/ exposes exactly ONE unambiguous
 * CURRENT status at the document level. Two document-level marker shapes are
 * considered:
 *   1. labeled status lines in the HEADER region (before the `## Status`
 *      heading — front-matter / title block);
 *   2. the first status-vocabulary word inside the `## Status` section.
 * A file fails when its header labels disagree with each other, when a
 * header label disagrees with the section's declared status, or when it has
 * ZERO recognizable document-level current status (no labeled header status
 * and no status-vocabulary word in the `## Status` section).
 *
 * Historical failure caught (issue #611 F-1 / REC-02): ADR-010 carried a
 * front-matter "**Status:** Proposed" next to a "## Status: Accepted"
 * section — a dual-status authority conflict.
 *
 * Negative controls: the vocabulary permits scoped decisions inside one ADR
 * (e.g. ADR-003: ACCEPTED policy + DEFERRED platform) because only the FIRST
 * section word is the declared current status and body-level scoped labels
 * ("Status: Deferred until …" inside a subsection) are not document-level
 * markers; historical prose like "previously Proposed" never matches either.
 * Commit distance, file dates, and ADR numbers are never consulted.
 *
 * Usage: node scripts/repository-contract/adr-status-uniqueness-contract.mjs [root]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2]
  ? join(process.argv[2])
  : join(import.meta.dirname, "../..");
const ADR_DIR = join(ROOT, "docs/adr");
const VOCAB = ["ACCEPTED", "PROPOSED", "DEFERRED", "SUPERSEDED", "REJECTED"];
const word = /\b(ACCEPTED|PROPOSED|DEFERRED|SUPERSEDED|REJECTED)\b/i;

const errors = [];

const files = readdirSync(ADR_DIR).filter((f) => /^ADR-\d{3}.*\.md$/.test(f));
if (files.length === 0) errors.push("docs/adr/: no ADR files found");

for (const f of files) {
  const text = readFileSync(join(ADR_DIR, f), "utf-8");

  // Split header region (document-level status markers) from the Status section.
  const sectionIdx = text.search(/^##\s*Status\s*$/m);
  const header = sectionIdx >= 0 ? text.slice(0, sectionIdx) : text;
  const section =
    sectionIdx >= 0
      ? text.slice(sectionIdx).match(/^##\s*Status\s*\n+([\s\S]*?)(?=\n##\s|$)/)
      : undefined;

  // 1. Labeled status declarations in the header region ("**Status:** X",
  //    "* Status: X", "> **Status:** X" — colon inside or outside the bold).
  const labeled = [];
  for (const line of header.split("\n")) {
    if (!/status/i.test(line)) continue;
    const m = line.match(
      /status\W{0,4}(ACCEPTED|PROPOSED|DEFERRED|SUPERSEDED|REJECTED)\b/i,
    );
    if (m) labeled.push(m[1].toUpperCase());
  }

  // 2. First vocabulary word inside the `## Status` section (the declared current status).
  const sectionFirst = section
    ? section[1].match(word)?.[1]?.toUpperCase()
    : undefined;

  const labeledDistinct = [...new Set(labeled)];
  if (labeledDistinct.length > 1) {
    errors.push(
      `${f}: conflicting labeled status declarations [${labeledDistinct.join(", ")}] — one unambiguous current status is required`,
    );
  }
  if (
    labeledDistinct.length === 1 &&
    sectionFirst &&
    labeledDistinct[0] !== sectionFirst
  ) {
    errors.push(
      `${f}: labeled status ${labeledDistinct[0]} conflicts with the Status section's declared ${sectionFirst}`,
    );
  }
  if (labeledDistinct.length === 0 && !sectionFirst) {
    errors.push(
      `${f}: no recognizable document-level current status — add a labeled status line in the header or a ## Status section whose first status word (ACCEPTED/PROPOSED/DEFERRED/SUPERSEDED/REJECTED) declares it`,
    );
  }
}

if (errors.length > 0) {
  console.error("FAIL: ADR status uniqueness contract:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `PASS: ADR status uniqueness contract upheld (${files.length} ADRs).`,
);
