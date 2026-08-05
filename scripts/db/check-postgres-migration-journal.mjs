// PostgreSQL migration journal invariant checker.
//
// The drizzle-orm@0.45.x postgres migrator applies a migration only when
// `Number(lastDbMigration.created_at) < migration.folderMillis`, where
// `folderMillis` is the journal entry's `when` and `created_at` is recorded as
// that same value (pg-core/dialect.cjs). Because the comparison is against the
// single max recorded `created_at`, a journal whose `when` values are not
// strictly increasing in `idx` order makes out-of-order entries permanently
// skippable on any DB that already recorded a later entry. See issue #259 /
// #256.
//
// This checker statically verifies the journal invariants that prevent that
// failure class, plus the file-system invariants Drizzle itself relies on
// (every registered tag has a .sql file; no orphan numbered .sql file). It is
// deterministic, dependency-free, and pure-Node. Wired into `pnpm verify:static`
// alongside the other check-* guards.
//
// Invariants verified:
//   - _journal.json parses; version/dialect correct
//   - entries non-empty
//   - idx starts at 0 and is contiguous (no gaps)
//   - idx unique; tag unique; when is a safe integer; when unique
//   - when strictly increases along entry order, EXCEPT for the locked
//     HISTORICAL_BACKWARD_WHEN set below (the irreparable 0022/0024 cases)
//   - the historical exception set is an exact snapshot: the actual journal
//     backward steps must match it exactly, so any NEW backward step fails the
//     check and any tampering with a known exception also fails the check
//   - every tag has a matching <tag>.sql file
//   - no orphan numbered migration .sql file

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Testability: MIGRATIONS_DIR_OVERRIDE lets the mutation tests point the
// checker at a throwaway journal without monkey-patching the module. The real
// (production) invocation never sets it.
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR_OVERRIDE
  ? resolve(process.env.MIGRATIONS_DIR_OVERRIDE)
  : resolve(__dirname, "..", "..", "packages", "db", "migrations", "postgres");
const JOURNAL_PATH = join(MIGRATIONS_DIR, "meta", "_journal.json");

const EXPECTED_VERSION = "7";
const EXPECTED_DIALECT = "postgresql";

// A numbered Drizzle migration .sql file starts with 4 digits + underscore.
const NUMBERED_SQL_RE = /^\d{4}_.+\.sql$/;

// Locked snapshot of historical backward-`when` steps that cannot be repaired
// without rewriting history (forbidden). Each entry records the (idx, tag,
// observed when, the previous entry's when) for one backward step.
//
// This is an EXACT allowlist: the set of backward steps found in the journal
// must equal this set. Adding a NEW backward step fails the check (forcing a
// forward `when` for any new migration). Removing or rewriting a known step
// ALSO fails the check (you must shrink this list when converging one away).
//
// The only entries here are the 0022/0024 cases from #256/#259, both of which
// predate 0023 in `when`. They are repaired by a forward convergence migration
// (0027), not by editing their historical `when`.
const HISTORICAL_BACKWARD_WHEN = [
  {
    idx: 22,
    tag: "0022_engine_policy_seam",
    when: 1785253697471,
    prevWhen: 1787200000000,
  },
  {
    idx: 24,
    tag: "0024_breezy_tigra",
    when: 1785621462155,
    prevWhen: 1787600000000,
  },
];

async function main() {
  const violations = [];

  // --- Load + structural ------------------------------------------------------
  let journal;
  try {
    const raw = await readFile(JOURNAL_PATH, "utf8");
    journal = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `Migration journal checker: cannot read/parse ${JOURNAL_PATH}: ${err.message}\n`,
    );
    process.exit(1);
  }

  if (journal.version !== EXPECTED_VERSION) {
    violations.push(
      `journal version is "${journal.version}", expected "${EXPECTED_VERSION}"`,
    );
  }
  if (journal.dialect !== EXPECTED_DIALECT) {
    violations.push(
      `journal dialect is "${journal.dialect}", expected "${EXPECTED_DIALECT}"`,
    );
  }
  if (!Array.isArray(journal.entries)) {
    violations.push("journal.entries is not an array");
    reportAndExit(violations);
  }
  if (journal.entries.length === 0) {
    violations.push("journal.entries is empty");
  }

  const entries = journal.entries;

  // --- Per-entry + pairwise checks -------------------------------------------
  const seenIdx = new Map(); // idx -> tag
  const seenTag = new Map(); // tag -> idx
  const seenWhen = new Map(); // when -> tag
  const observedBackward = []; // { idx, tag, when, prevWhen }
  let prevWhen;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];

    if (typeof e.idx !== "number" || !Number.isInteger(e.idx)) {
      violations.push(
        `entry ${i} tag=${e.tag}: idx is not an integer (got ${String(e.idx)})`,
      );
    } else {
      if (e.idx !== i) {
        violations.push(
          `entry ${i} tag=${e.tag}: idx is ${e.idx}, expected ${i} (must start at 0 and be contiguous)`,
        );
      }
      if (seenIdx.has(e.idx)) {
        violations.push(
          `entry ${i} tag=${e.tag}: duplicate idx ${e.idx} (first seen at tag=${seenIdx.get(e.idx)})`,
        );
      } else {
        seenIdx.set(e.idx, e.tag);
      }
    }

    if (typeof e.tag !== "string" || e.tag.length === 0) {
      violations.push(`entry ${i}: tag is missing or not a string`);
    } else if (seenTag.has(e.tag)) {
      violations.push(
        `entry ${i} tag=${e.tag}: duplicate tag (first seen at idx=${seenTag.get(e.tag)})`,
      );
    } else {
      seenTag.set(e.tag, e.idx);
    }

    if (typeof e.when !== "number" || !Number.isInteger(e.when)) {
      violations.push(
        `entry ${i} tag=${e.tag}: when is not an integer (got ${String(e.when)})`,
      );
    } else {
      if (!Number.isSafeInteger(e.when)) {
        violations.push(
          `entry ${i} tag=${e.tag}: when=${e.when} is not a safe integer`,
        );
      }
      if (seenWhen.has(e.when)) {
        violations.push(
          `entry ${i} tag=${e.tag}: duplicate when=${e.when} (first seen at tag=${seenWhen.get(e.when)})`,
        );
      } else {
        seenWhen.set(e.when, e.tag);
      }
      if (prevWhen !== undefined && e.when <= prevWhen) {
        observedBackward.push({
          idx: e.idx,
          tag: e.tag,
          when: e.when,
          prevWhen,
        });
      }
      prevWhen = e.when;
    }
  }

  // --- Backward-when allowlist reconciliation --------------------------------
  // Every observed backward `when` step must be a known historical exception,
  // otherwise it is a NEW regression. This check ALWAYS runs: a backward step
  // is a real Drizzle-skip risk regardless of the allowlist snapshot.
  //
  // Separately, the allowlist must EXACTLY match the observed backward set: a
  // missing observed step means the snapshot is stale (someone fixed a backward
  // step without shrinking the allowlist). This drift check is gated by the
  // MIGRATIONS_JOURNAL_ALLOWLIST_EMPTY test-only escape hatch so mutation tests
  // can exercise the structural invariants in isolation.
  const allowlistDisabled =
    process.env.MIGRATIONS_JOURNAL_ALLOWLIST_EMPTY === "1";
  const histKey = (b) => `${b.idx}|${b.tag}|${b.when}|${b.prevWhen}`;
  const observedSet = new Set(observedBackward.map(histKey));
  const allowedSet = new Set(HISTORICAL_BACKWARD_WHEN.map(histKey));

  for (const b of observedBackward) {
    if (allowlistDisabled || !allowedSet.has(histKey(b))) {
      violations.push(
        `entry ${b.idx} tag=${b.tag}: NEW backward when=${b.when} (previous=${b.prevWhen}) — not in the historical allowlist; use a forward when strictly greater than all prior entries (Drizzle's max-created_at comparison permanently skips this entry on DBs that recorded a later migration)`,
      );
    }
  }
  if (!allowlistDisabled) {
    for (const a of HISTORICAL_BACKWARD_WHEN) {
      if (!observedSet.has(histKey(a))) {
        violations.push(
          `historical backward-when allowlist entry idx=${a.idx} tag=${a.tag} when=${a.when} prevWhen=${a.prevWhen} no longer matches the journal — update HISTORICAL_BACKWARD_WHEN in scripts/db/check-postgres-migration-journal.mjs when a convergence removes or changes a known step`,
        );
      }
    }
  }

  // --- File-system invariants -------------------------------------------------
  let dirFiles = [];
  try {
    dirFiles = await readdir(MIGRATIONS_DIR);
  } catch (err) {
    violations.push(
      `cannot read migration directory ${MIGRATIONS_DIR}: ${err.message}`,
    );
  }

  for (const e of entries) {
    const sqlFile = `${e.tag}.sql`;
    try {
      await readFile(join(MIGRATIONS_DIR, sqlFile), "utf8");
    } catch {
      violations.push(
        `entry idx=${e.idx} tag=${e.tag}: referenced .sql file "${sqlFile}" not found in ${MIGRATIONS_DIR}`,
      );
    }
  }

  const journalTags = new Set(entries.map((e) => e.tag));
  for (const f of dirFiles) {
    if (!NUMBERED_SQL_RE.test(f)) continue;
    const tag = f.replace(/\.sql$/, "");
    if (!journalTags.has(tag)) {
      violations.push(
        `orphan migration .sql file "${f}" in ${MIGRATIONS_DIR} is not registered in _journal.json`,
      );
    }
  }

  reportAndExit(violations, entries.length);
}

function reportAndExit(violations, entryCount) {
  if (violations.length > 0) {
    process.stderr.write(
      `PostgreSQL migration journal invariant check failed:\n${violations.map((v) => `  - ${v}`).join("\n")}\n`,
    );
    process.exit(1);
  }
  const count = entryCount ?? 0;
  process.stdout.write(
    `PostgreSQL migration journal invariant check passed (${count} entries).\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `Migration journal checker crashed: ${err.stack ?? err}\n`,
  );
  process.exit(1);
});
