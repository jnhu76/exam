/**
 * Phase-E Campaign U — shadow-oracle census (L0, E-RD01/E-WR01/E-RT02
 * foundations). Every semantic decision of the Rich authority stack must have
 * EXACTLY ONE production definition; a second implementation — a duplicated
 * limit table, a private docVersion gate, a local canonicalizer, a second
 * identity digest — would let a consumer drift from the authority while every
 * authority-targeted campaign stays green (they attack the authority, not the
 * shadow).
 *
 * Probes (each is a mechanical source census over the production tree, with
 * the allowed locations pinned explicitly; a hit outside the allowlist is a
 * census failure that must be resolved by moving the code or the census):
 *
 *   U1  authority symbols are defined exactly once, in their authority file
 *       (normalize/canonicalize/preflight/projection/equality/limits/version/
 *       mark-order/identity/both persisted resolvers);
 *   U2  distinctive CONTENT_LIMITS literals (131072/20000/40000) and limit
 *       key names appear only in the domain authority;
 *   U3  every docVersion gate lives in the authority stack (domain walk/
 *       normalize + the two contracts persisted resolvers) — no private
 *       version gate elsewhere;
 *   U4  Rich limit-violation message text is produced only by the authority;
 *   U5  the answer-identity digest (sha256 over the canonical serialization)
 *       is produced only by the exam-engine answer protocol.
 *
 * SCOPE NOTE: this is the same production tree the F campaign sweeps
 * (apps/api + server packages). apps/web consumes the authorities through
 * @exam/domain/@exam/contracts imports (arch lint pins the dependency
 * direction); locale copy that mentions sizes is product copy, not an oracle.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, afterAll } from "vitest";
import { CampaignRecorder } from "./campaignStats.js";

const recorder = new CampaignRecorder("U-shadow-oracle-census", []);

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

const DOMAIN_AUTHORITY = "packages/domain/src/content/contentDocument.ts";
const AUTHORITY_FILES: Record<string, string> = {
  normalizeContentDocument: DOMAIN_AUTHORITY,
  preflightContentDocumentStructure: DOMAIN_AUTHORITY,
  plainTextProjection: DOMAIN_AUTHORITY,
  contentDocumentsEqual: DOMAIN_AUTHORITY,
  canonicalMarks: DOMAIN_AUTHORITY,
  canonicalizeContentDocument: "packages/contracts/src/contentDocument.ts",
  resolveRichAnswerDocument: "packages/contracts/src/persistedRichAnswer.ts",
  resolvePersistedQuestionDocument:
    "packages/contracts/src/persistedQuestionContent.ts",
  canonicalAnswerIdentity: "packages/exam-engine/src/answerProtocol.ts",
};

/** Files allowed to carry a docVersion decision gate (the authority stack). */
const DOC_VERSION_GATES = new Set([
  DOMAIN_AUTHORITY,
  "packages/contracts/src/persistedQuestionContent.ts",
  "packages/contracts/src/persistedRichAnswer.ts",
]);

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

// Scan once; every probe reads the same in-memory census.
const SOURCES = new Map<string, string>();
for (const root of SWEEP_ROOTS) {
  for (const f of walkTsFiles(path.join(REPO_ROOT, root))) {
    SOURCES.set(path.relative(REPO_ROOT, f), readFileSync(f, "utf8"));
  }
}

/** Lines of a file matching a regex. */
const hits = (src: string, re: RegExp): string[] =>
  src.split("\n").filter((line) => re.test(line));

describe("Campaign U — shadow-oracle census (L0)", () => {
  it("U1: every authority symbol is defined exactly once, in its authority file", () => {
    const violations: string[] = [];
    for (const [symbol, authority] of Object.entries(AUTHORITY_FILES)) {
      const defRe = new RegExp(`(function|const)\\s+${symbol}\\b`);
      const defining = [...SOURCES.entries()].filter(([, src]) =>
        defRe.test(src),
      );
      if (defining.length !== 1) {
        violations.push(
          `${symbol}: ${defining.length} defining files (${defining.map(([f]) => f).join(", ") || "none"})`,
        );
        continue;
      }
      const [file] = defining[0];
      if (file !== authority) {
        violations.push(
          `${symbol}: defined in ${file}, authority is ${authority}`,
        );
      }
      recorder.record({
        probe: `U1-${symbol}`,
        outcome: "single-definition",
        file,
      });
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("U2: distinctive CONTENT_LIMITS literals and key names exist only in the domain authority", () => {
    const violations: string[] = [];
    const literalRe = /\b(131072|20000|40000)\b/;
    const keyRe = /\b(serializedChars|listDepth|tableCells)\b/;
    for (const [file, src] of SOURCES) {
      if (file === DOMAIN_AUTHORITY) continue;
      for (const line of hits(src, literalRe)) {
        violations.push(
          `${file}: limit literal outside authority — ${line.trim()}`,
        );
      }
      for (const line of hits(src, keyRe)) {
        violations.push(
          `${file}: limit key outside authority — ${line.trim()}`,
        );
      }
    }
    // The authority itself must still carry them (census not vacuous).
    expect(
      hits(SOURCES.get(DOMAIN_AUTHORITY) ?? "", literalRe).length,
    ).toBeGreaterThanOrEqual(3);
    recorder.record({
      probe: "U2-limit-literals",
      outcome: "authority-only",
      violations: violations.length,
    });
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("U3: every docVersion decision gate lives in the authority stack", () => {
    const violations: string[] = [];
    const gateRe = /docVersion\s*!==?\s*(1|CONTENT_DOC_VERSION)\b/;
    let gateCount = 0;
    for (const [file, src] of SOURCES) {
      const found = hits(src, gateRe);
      gateCount += found.length;
      if (found.length === 0) continue;
      if (!DOC_VERSION_GATES.has(file)) {
        for (const line of found) {
          violations.push(`${file}: private docVersion gate — ${line.trim()}`);
        }
      }
    }
    expect(
      gateCount,
      "census must have found the authority gates",
    ).toBeGreaterThanOrEqual(5);
    recorder.record({
      probe: "U3-docVersion-gates",
      outcome: "authority-only",
      gateCount,
    });
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("U4: Rich limit-violation messages are produced only by the domain authority", () => {
    const violations: string[] = [];
    // The authority's exact Rich carrier phrases — generic "exceeds" copy of
    // unrelated domains (audit bytes, db names, client events) is out of
    // scope; this pins the Rich violation TEXT, not the word "exceeds".
    const richLimitMessageRe =
      /exceeds \\\$\{CONTENT_LIMITS\.|exceeds \\\$\{PREFLIGHT_RAW_DEPTH_BUDGET\}|(text run|latex|code block|tree depth|list nesting|table row|serialized document) exceeds/;
    for (const [file, src] of SOURCES) {
      if (file === DOMAIN_AUTHORITY) continue;
      for (const line of hits(src, richLimitMessageRe)) {
        violations.push(`${file}: limit message shadow — ${line.trim()}`);
      }
    }
    recorder.record({ probe: "U4-limit-messages", outcome: "authority-only" });
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("U5: the answer-identity digest is produced only by the exam-engine answer protocol", () => {
    const violations: string[] = [];
    const shaRe = /createHash\(\s*["']sha256["']\s*\)/;
    for (const [file, src] of SOURCES) {
      for (const line of hits(src, shaRe)) {
        if (file !== AUTHORITY_FILES.canonicalAnswerIdentity) {
          violations.push(
            `${file}: sha256 digest outside identity authority — ${line.trim()}`,
          );
        }
      }
    }
    expect(
      hits(SOURCES.get(AUTHORITY_FILES.canonicalAnswerIdentity) ?? "", shaRe)
        .length,
      "identity authority must still produce the digest",
    ).toBeGreaterThanOrEqual(1);
    recorder.record({ probe: "U5-identity-digest", outcome: "authority-only" });
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("census composition: the sweep actually covered the production tree", () => {
    expect(SOURCES.size).toBeGreaterThan(100);
    recorder.record({
      probe: "composition",
      outcome: "done",
      files: SOURCES.size,
    });
  });

  afterAll(() => {
    recorder.flush();
  });
});
