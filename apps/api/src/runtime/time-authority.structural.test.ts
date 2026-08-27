import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ADR-006 — Exam Time Authority structural guardrail.
//
// Scope: this guardrail enforces EXAM BUSINESS TIME authority — exam lifecycle,
// attempt lifecycle, deadline, restore, heartbeat/disrupted, force-submit,
// time-grant, score/export gate, and state-transition audit timestamps. It is
// NOT a "ban every wall-clock read in the system" rule. Frontend display,
// performance timing, and non-authoritative reporting are out of scope.
//
// It scans source text (NOT test files, NOT the frontend) and fails the build
// when a raw WALL-CLOCK read — empty-arg `new Date()`, `Date.now()`, or SQL
// `now()` / `CURRENT_TIMESTAMP` / `clock_timestamp(` / `transaction_timestamp(`
// — appears in an exam-business path outside a short, reason-documented
// allowlist.
//
// The canonical authority is `fastify.now()` (apps/api/src/plugins/now.ts).
// Business paths must capture one `now` per request/tick and thread it through;
// they must not read the wall clock directly or rely on DB time for exam
// lifecycle decisions.
//
// When you legitimately need a new raw-time site in a NON-business path, add it
// to ALLOWLIST below WITH a reason, and keep the list short. Business-path
// reads are never allowlisted — fix them to use fastify.now() / an explicit now.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

/** A glob-rooted directory to scan, relative to REPO_ROOT. */
interface ScanDir {
  /** Path relative to repo root. */
  dir: string;
  /** Recursive file extensions to include, e.g. [".ts"]. */
  exts: string[];
}

/**
 * Patterns that read the WALL CLOCK (the actual authority violation), not date
 * arithmetic. Crucially:
 *  - `new Date()` with NO argument reads the wall clock. `new Date(x)`,
 *    `new Date(x, y)`, `new Date(number)` are date construction/arithmetic
 *    from an existing instant and are NOT violations — so we require the call
 *    to have an empty argument list.
 *  - `Date.now()` reads the wall clock.
 *  - SQL time functions (`CURRENT_TIMESTAMP`, `clock_timestamp(`,
 *    `transaction_timestamp(`) read DB time. Note `now()` in SQL is matched,
 *    but NOT `.now()` (fastify.now() / foo.now()) — we require `now()` to be
 *    either the whole token or preceded by a non-`.` character.
 */
const RAW_TIME_PATTERNS: RegExp[] = [
  /\bnew\s+Date\s*\(\s*\)/, // new Date() — empty parens = wall clock
  /\bDate\.now\s*\(\s*\)/,
  /(?:^|[^.\w])now\s*\(\)/i, // SQL now() but not .now()
  /\bCURRENT_TIMESTAMP\b/i,
  /\bclock_timestamp\s*\(/i,
  /\btransaction_timestamp\s*\(/i,
  /\bstatement_timestamp\s*\(/i,
];

/**
 * Allowlist of source files permitted to contain raw time sources, each with a
 * reason. Kept deliberately short. Test files and the frontend are excluded
 * from scanning entirely (see isExcluded).
 */
const ALLOWLIST: { path: string; reason: string }[] = [
  {
    path: "apps/api/src/plugins/now.ts",
    reason:
      "Canonical fastify.now() implementation — the one place the wall clock is read.",
  },
  {
    path: "packages/db/src/repository/baseRepo.ts",
    reason:
      "createdAt/updatedAt storage stamps only (non-business); not used for deadline/open/close/export gates.",
  },
  {
    path: "packages/db/src/repository/systemStatsRepo.ts",
    reason:
      "Reporting/dashboard day-boundary only — NOT exam business time. Strictly: (1) reporting/dashboard only; (2) NOT used for exam lifecycle / deadline / submit / score-export gate; (3) NOT authoritative for candidate/admin runtime decisions; (4) TODO: future cleanup should derive startOfDay from APP_TIMEZONE or the org timezone explicitly. See the inline TODO in the file.",
  },
  {
    path: "packages/db/src/repository/organizationRepo.ts",
    reason:
      "Uses baseRepo now() for organization createdAt/updatedAt storage stamps only (non-business).",
  },
  {
    path: "packages/db/src/repository/settingsRepo.ts",
    reason:
      "Uses baseRepo now() for organization settings updatedAt storage stamp only (non-business).",
  },
  {
    path: "packages/db/src/repository/emailOutboxRepo.ts",
    reason:
      "Uses baseRepo now() for email_outbox createdAt/updatedAt storage stamps only (non-business). Retry/sent instants are passed in explicitly by EmailOutboxService, which owns the injected clock; the repo never reads the wall clock for outbox lifecycle decisions.",
  },
  {
    path: "packages/db/src/repository/attemptRepo.ts",
    reason:
      "refreshLastActivityIfInProgress uses SQL now() for updatedAt storage stamp only; the business-time lastActivityAt uses the caller-supplied now param (ADR-006 compliant).",
  },
  {
    path: "packages/db/src/repository/userRepo.ts",
    reason:
      "#325 epoch mutations (logout CAS / password+epoch advance) use baseRepo now() for updatedAt storage stamps only (non-business); no exam business-time decision reads the wall clock here.",
  },
  {
    path: "apps/api/src/routes/export.ts",
    reason:
      "Date.now() is used only to generate a unique CSV download filename suffix (cache-busting); not an exam business-time decision.",
  },
  {
    path: "apps/api/src/routes/testHelpers.ts",
    reason:
      "Test/factory helpers (fixture generation: openAt/closeAt/clientSavedAt, unique-id suffix); never asserts business-time authority of the server.",
  },
  {
    path: "apps/api/src/routes/attempts/attempts.testHelpers.ts",
    reason:
      "Test/factory helpers extracted from attempts.test.ts during the attempts test split (shared exam/attempt fixture generation: openAt/closeAt, createdAt/updatedAt stamps); never asserts business-time authority of the server.",
  },
  {
    path: "packages/exam-engine/src/answerProtocol.ts",
    reason:
      "The single state.now ?? new Date() fallback; the API layer always supplies state.now so production never reaches the fallback.",
  },
  {
    path: "packages/db/src/repository/userRoleAssignmentRepo.ts",
    reason:
      "Uses baseRepo now() for role-assignment createdAt/updatedAt storage stamps only (non-business — role assignment is not an exam-lifecycle time authority decision). Mirrors organizationRepo/settingsRepo convention.",
  },
  {
    path: "packages/db/src/repository/attemptGradingEntryRepo.ts",
    reason:
      "Uses new Date() for createdAt/updatedAt storage stamps only (non-business); grading authority timestamps are passed in explicitly by callers.",
  },
  {
    path: "packages/db/src/repository/workerHeartbeatRepo.ts",
    reason:
      "Uses baseRepo now() for worker_heartbeats createdAt/updatedAt storage stamps only (non-business); worker poll timestamps are passed in explicitly by the caller.",
  },
  {
    path: "packages/db/src/repository/notificationRepo.ts",
    reason:
      "Uses baseRepo now() for notifications createdAt/readAt storage stamps only (non-business); notification creation time is a storage stamp, not an exam-lifecycle time authority decision.",
  },
  {
    path: "packages/db/src/repository/recoveryRepo.ts",
    reason:
      "getIncidentAggregate stamps snapshotAt via transaction_timestamp() INSIDE the read-only REPEATABLE READ transaction (J5-I1A2 §6.3). This is the DB's own snapshot-identity stamp for the one-consistent-read contract — NOT an exam-lifecycle time decision: no lifecycle/deadline/submit/score gate branches on it. The stamp is read-only and display/audit only, mirroring the non-business storage-stamp allowlist entries (baseRepo/attemptRepo). Inline adr-006-allow markers pin the exact lines.",
  },
];

/** Directories scanned for raw-time regressions in business paths. */
const SCAN_DIRS: ScanDir[] = [
  { dir: "apps/api/src/routes", exts: [".ts"] },
  { dir: "apps/api/src/plugins", exts: [".ts"] },
  { dir: "packages/exam-engine/src", exts: [".ts"] },
  { dir: "packages/domain/src", exts: [".ts"] },
  { dir: "packages/db/src/repository", exts: [".ts"] },
];

/** Exclude test files, type declarations, and the frontend (display only). */
function isExcluded(absPath: string): boolean {
  const normalized = absPath.replace(/\\/g, "/");
  return (
    normalized.includes(".test.") ||
    normalized.includes("__tests__") ||
    normalized.endsWith(".d.ts") ||
    normalized.includes("/apps/web/")
  );
}

function isAllowed(repoRelative: string): boolean {
  return ALLOWLIST.some((entry) =>
    repoRelative.replace(/\\/g, "/").endsWith(entry.path),
  );
}

/** Recursively collect source files under a directory matching the exts. */
function collectFiles(dirAbs: string, exts: string[]): string[] {
  const entries: string[] = [];
  const stack: string[] = [dirAbs];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let dirents;
    try {
      dirents = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const d of dirents) {
      const full = join(current, d.name);

      if (d.isDirectory()) {
        stack.push(full);
      } else if (d.isFile() && exts.includes(extname(d.name))) {
        entries.push(full);
      }
    }
  }

  return entries.sort();
}

function toRepoRelative(absPath: string): string {
  return absPath
    .replace(/\\/g, "/")
    .replace(REPO_ROOT.replace(/\\/g, "/") + "/", "");
}

interface Violation {
  file: string;
  line: number;
  snippet: string;
}

/** Scan one file's text for raw-time patterns, returning any violations. */
function scanFile(absPath: string): Violation[] {
  const text = readFileSync(absPath, "utf8");
  const lines = text.split(/\r?\n/);
  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const pattern of RAW_TIME_PATTERNS) {
      if (pattern.test(line)) {
        // Allow a trailing `// adr-006-allow` marker as an inline escape hatch
        // (still requires the file to be in ALLOWLIST with a reason).
        if (/adr-006-allow/i.test(line)) continue;
        violations.push({
          file: toRepoRelative(absPath),
          line: i + 1,
          snippet: line.trim(),
        });
      }
    }
  }
  return violations;
}

describe("ADR-006 time-authority structural guardrail", () => {
  it("no raw time source (new Date / Date.now / SQL now()) in business paths outside the allowlist", () => {
    const allViolations: Violation[] = [];
    for (const { dir, exts } of SCAN_DIRS) {
      const dirAbs = resolve(REPO_ROOT, dir);
      const files = collectFiles(dirAbs, exts);
      for (const file of files) {
        if (isExcluded(file)) continue;
        if (isAllowed(toRepoRelative(file))) continue;
        allViolations.push(...scanFile(file));
      }
    }

    if (allViolations.length > 0) {
      const formatted = allViolations
        .map((v) => `  ${v.file}:${v.line}  ${v.snippet}`)
        .join("\n");
      throw new Error(
        `ADR-006 violation: raw time source found in business paths. ` +
          `Use fastify.now() (API/plugin layer) or an explicit \`now: Date\` param ` +
          `(engine/domain). Add the file to ALLOWLIST with a reason ONLY if it is ` +
          `a legitimate authority/storage site.\n${formatted}`,
      );
    }
    expect(allViolations).toHaveLength(0);
  });

  it("allowlist entries still exist on disk (no stale allowlist)", () => {
    for (const entry of ALLOWLIST) {
      const abs = resolve(REPO_ROOT, entry.path);
      expect(existsSync(abs), `allowlisted file missing: ${entry.path}`).toBe(
        true,
      );
    }
  });
});
