/**
 * P7-C1 C1.3 — Schema/image compatibility preflight (closes C0 P2-1).
 *
 * Runs BEFORE `node dist/scripts/migrate.js` in docker-entrypoint.sh so an
 * incompatible DB/image combination refuses to start instead of being
 * silently mutated by drizzle's forward-only migrator.
 *
 * Background (C0 P2-1): `drizzle-orm@0.45.2` postgres-js migrator
 * (`pg-core/dialect.cjs`) reads ONLY `select ... order by created_at desc
 * limit 1`, compares by TIMESTAMP alone, and stores the sha256 hash but NEVER
 * verifies it. So it silently misbehaves on:
 *   - DB-ahead-of-image (stale image / downgrade) — it just applies nothing;
 *   - divergent history — it can mis-apply or skip.
 *
 * Classification (frontier + membership, NOT ordered-prefix):
 *
 * The current journal has IRREPARABLE backward-`when` steps (0022, 0024 — see
 * scripts/db/check-postgres-migration-journal.mjs `HISTORICAL_BACKWARD_WHEN`),
 * and historically some DBs lack rows for migrations whose `when` predates an
 * already-applied later migration (drizzle applies only migrations with
 * `when > lastAppliedCreated_at`, so a backward-`when` migration is skipped on
 * a DB that already recorded a later one; #256/#259). A naive ordered-prefix
 * model would mis-classify these known-good converged DBs as DIVERGENT.
 *
 * Algorithm (see plan P2-2):
 *   imageSet   = { (when,hash) for each image migration }
 *   maxImageWhen = max(image when)
 *
 *   FRESH_INSTALL  migration table absent (to_regclass NULL) OR 0 rows
 *                  → proceed (migrate freely)
 *
 *   for each DB row (created_at, hash):
 *     if (created_at, hash) ∈ imageSet: ok
 *     elif created_at > maxImageWhen: STALE_IMAGE_DB_AHEAD
 *     else: DIVERGENT
 *
 *   frontier = max(DB.created_at)
 *   holes below frontier = image migrations with when < frontier and no
 *     matching DB row.
 *     known historical omissions (locked allowlist): 0004, 0022, 0024
 *       (#256/#259; repaired by 0027 convergence) → tolerated
 *     any OTHER hole below frontier → DIVERGENT
 *
 *   frontier == maxImageWhen → NORMAL
 *   frontier <  maxImageWhen → FORWARD_UPGRADE
 *
 * PG-major layer (C0 §15.2, separate from migration history): `SHOW
 * server_version_num` vs the image's `postgres:18` major; refuse on mismatch.
 * (postgres itself refuses a PGDATA-major mismatch first; this gives a clearer
 * operator message.)
 *
 * Exit codes: 0 for FRESH_INSTALL / NORMAL / FORWARD_UPGRADE; non-zero for
 * STALE_IMAGE_DB_AHEAD / DIVERGENT / PG-major mismatch, with the offending
 * entries listed.
 *
 * Break-glass: `EXAM_UNSAFE_SKIP_SCHEMA_PREFLIGHT=1` bypasses the gate
 * (documented only in the operator-emergency runbook section; NOT in
 * .env.example; emits a loud WARN; DISALLOWED in the relocation drill).
 */
import { fileURLToPath } from "node:url";
import {
  createDatabase,
  readImageMigrationSet,
  type ImageMigration,
} from "@exam/db";
import { loadRootEnv } from "../config/loadRootEnv.js";
import { resolveDatabaseUrlFromEnv } from "../config/runtimeConfig.js";

// ── Classification types ───────────────────────────────────────────────

export type PreflightOutcome =
  | "FRESH_INSTALL"
  | "NORMAL"
  | "FORWARD_UPGRADE"
  | "STALE_IMAGE_DB_AHEAD"
  | "DIVERGENT";

export interface PreflightDbRow {
  /** drizzle __drizzle_migrations.created_at (the journal `when`, epoch millis). */
  createdAt: string;
  /** drizzle __drizzle_migrations.hash (sha256 hex). */
  hash: string;
}

export interface PreflightClassification {
  outcome: PreflightOutcome;
  /** Human-readable detail (offending entries / counts). */
  detail: string;
  /** The image migration set used for classification (for reporting). */
  imageCount: number;
  /** The DB row count (0 for FRESH_INSTALL). */
  dbCount: number;
  /** The DB frontier (max createdAt), null for FRESH_INSTALL. */
  dbFrontier: number | null;
  /** The image frontier (max when). */
  imageFrontier: number;
}

/**
 * Historical DB-row omissions that are tolerated (P7-C1 C1.3 plan P2-2).
 *
 * These migrations may be ABSENT from a DB's drizzle.__drizzle_migrations even
 * though the DB is fully converged, because:
 *   - 0022 and 0024 have `when` values that PREDATE 0021/0023 (irreparable
 *     backward steps, #256/#259). Drizzle applies only migrations with
 *     `when > lastAppliedCreated_at`, so on a DB that already recorded 0021/0023,
 *     0022/0024 are permanently skipped. 0027 (a forward-`when` convergence
 *     migration) then reconciles the schema, so the DB is correct.
 *   - 0004 is included for parity with the known-historical-omission set
 *     referenced in the C0/C1 review.
 *
 * Identified by tag (display metadata) — the entries are matched against the
 * image journal's tags. Any OTHER hole below the DB frontier is DIVERGENT.
 */
const HISTORICAL_OMISSION_TAGS = new Set([
  "0004_wide_phantom_reporter",
  "0022_engine_policy_seam",
  "0024_breezy_tigra",
]);

/**
 * Classify the relationship between the image migration set and the applied DB
 * rows. PURE FUNCTION — no DB access — so it is unit-testable with synthetic
 * states.
 *
 * @param image - The image-side migration set (entries + maxWhen).
 * @param dbRows - The applied DB rows (created_at, hash). Empty for FRESH_INSTALL.
 * @param isFreshInstall - True when the migration table is absent OR has 0 rows.
 */
export function classifyMigrationCompatibility(
  image: { entries: ImageMigration[]; maxWhen: number },
  dbRows: PreflightDbRow[],
  isFreshInstall: boolean,
): PreflightClassification {
  const imageCount = image.entries.length;
  const imageFrontier = image.maxWhen;

  if (imageCount === 0) {
    // Corrupt image — no journal entries. Refuse (do not let migrate run
    // against an image with no migrations, which would be a broken image).
    return {
      outcome: "DIVERGENT",
      detail:
        "Image migration journal is empty (corrupt image). Refusing to start.",
      imageCount: 0,
      dbCount: dbRows.length,
      dbFrontier: null,
      imageFrontier,
    };
  }

  if (isFreshInstall) {
    return {
      outcome: "FRESH_INSTALL",
      detail:
        `Migration table absent or empty. Image carries ${imageCount} migration(s) ` +
        `to apply on first install.`,
      imageCount,
      dbCount: 0,
      dbFrontier: null,
      imageFrontier,
    };
  }

  // Index the image set by (when, hash) for membership tests.
  const imageByWhenHash = new Set(
    image.entries.map((e) => `${e.when}|${e.hash}`),
  );
  // Index image entries by `when` for hole detection + tag display.
  const imageByWhen = new Map(image.entries.map((e) => [e.when, e]));

  // Check each DB row for membership / stale-image / divergence.
  for (const row of dbRows) {
    const createdAt = Number(row.createdAt);
    if (!imageByWhenHash.has(`${createdAt}|${row.hash}`)) {
      if (createdAt > imageFrontier) {
        // The DB has a migration newer than anything in the image → stale image.
        const newerDbRows = dbRows
          .filter((r) => Number(r.createdAt) > imageFrontier)
          .map((r) => Number(r.createdAt));
        return {
          outcome: "STALE_IMAGE_DB_AHEAD",
          detail:
            `DB has ${newerDbRows.length} migration row(s) with created_at newer than ` +
            `the image's max migration when (${imageFrontier}). The running image is ` +
            `STALE / a downgrade relative to the database. Refusing to start. ` +
            `Newer-than-image DB created_at values: ${newerDbRows.join(", ")}.`,
          imageCount,
          dbCount: dbRows.length,
          dbFrontier: Math.max(...dbRows.map((r) => Number(r.createdAt))),
          imageFrontier,
        };
      }
      // created_at <= imageFrontier but (when,hash) not in image set → divergence
      // (either a hash mismatch on a shared when, or a DB row with no image
      // counterpart at an older when).
      return {
        outcome: "DIVERGENT",
        detail:
          `DB migration row (created_at=${createdAt}, hash=${row.hash.slice(0, 12)}…) ` +
          `does not match any image migration (when, hash). The DB and image ` +
          `migration histories have diverged. Refusing to start. Operator ` +
          `intervention required.`,
        imageCount,
        dbCount: dbRows.length,
        dbFrontier: Math.max(...dbRows.map((r) => Number(r.createdAt))),
        imageFrontier,
      };
    }
  }

  // All DB rows are members of the image set. Now check for holes below the
  // frontier: image migrations with when < dbFrontier that have no matching
  // DB row.
  const dbFrontier = Math.max(...dbRows.map((r) => Number(r.createdAt)));
  const dbWhens = new Set(dbRows.map((r) => Number(r.createdAt)));
  const holes: ImageMigration[] = [];
  for (const entry of image.entries) {
    if (entry.when < dbFrontier && !dbWhens.has(entry.when)) {
      holes.push(entry);
    }
  }
  // Tolerate known historical omissions; any OTHER hole is divergence.
  const unexpectedHoles = holes.filter(
    (h) => !HISTORICAL_OMISSION_TAGS.has(h.tag),
  );
  if (unexpectedHoles.length > 0) {
    return {
      outcome: "DIVERGENT",
      detail:
        `Image migrations below the DB frontier (${dbFrontier}) with no matching ` +
        `DB row (not in the historical-omission allowlist): ` +
        `${unexpectedHoles.map((h) => h.tag).join(", ")}. The DB is missing ` +
        `migrations the image expects to have been applied. Refusing to start.`,
      imageCount,
      dbCount: dbRows.length,
      dbFrontier,
      imageFrontier,
    };
  }

  // All rows are members; no unexpected holes. Compare frontiers.
  if (dbFrontier === imageFrontier) {
    const omitted = holes.map((h) => h.tag);
    const note =
      omitted.length > 0
        ? ` (tolerated historical omissions: ${omitted.join(", ")})`
        : "";
    return {
      outcome: "NORMAL",
      detail:
        `DB migration history matches the image (${dbRows.length} row(s) applied, ` +
        `frontier ${dbFrontier} == image frontier ${imageFrontier})${note}.`,
      imageCount,
      dbCount: dbRows.length,
      dbFrontier,
      imageFrontier,
    };
  }
  if (dbFrontier < imageFrontier) {
    const pending = image.entries.filter((e) => e.when > dbFrontier);
    return {
      outcome: "FORWARD_UPGRADE",
      detail:
        `DB migration history is a valid prefix of the image (${dbRows.length} row(s) ` +
        `applied, frontier ${dbFrontier} < image frontier ${imageFrontier}). ` +
        `${pending.length} pending migration(s) will apply: ` +
        `${pending.map((p) => p.tag).join(", ")}.`,
      imageCount,
      dbCount: dbRows.length,
      dbFrontier,
      imageFrontier,
    };
  }
  // dbFrontier > imageFrontier — should have been caught by STALE_IMAGE_DB_AHEAD
  // above, but guard defensively.
  return {
    outcome: "STALE_IMAGE_DB_AHEAD",
    detail:
      `DB frontier (${dbFrontier}) is ahead of the image frontier ` +
      `(${imageFrontier}). The running image is STALE / a downgrade. Refusing.`,
    imageCount,
    dbCount: dbRows.length,
    dbFrontier,
    imageFrontier,
  };
}

// ── Runtime entrypoint ─────────────────────────────────────────────────

/**
 * The PostgreSQL major the bundled image pins (postgres:18.4-bookworm).
 * The PG-major check refuses a PGDATA created under a different major.
 */
const EXPECTED_PG_MAJOR = 18;

/**
 * Run the preflight: connect, read PG version + applied migrations, classify,
 * print a report, and return an exit code. Throws on DB errors; the caller
 * (the script body / entrypoint) decides how to surface those.
 */
export async function runPreflight(): Promise<{
  exitCode: number;
  classification: PreflightClassification | { outcome: "BYPASSED" };
}> {
  // Break-glass (documented only in the operator-emergency runbook section).
  if (process.env.EXAM_UNSAFE_SKIP_SCHEMA_PREFLIGHT === "1") {
    process.stdout.write(
      "WARN: EXAM_UNSAFE_SKIP_SCHEMA_PREFLIGHT=1 — schema/image compatibility " +
        "gate BYPASSED. This is an unsafe operator escape hatch; do NOT use it " +
        "in a relocation drill.\n",
    );
    return { exitCode: 0, classification: { outcome: "BYPASSED" } };
  }

  const image = readImageMigrationSet();
  process.stdout.write(
    `Preflight: image carries ${image.entries.length} migration(s) ` +
      `(frontier when=${image.maxWhen}).\n`,
  );

  const databaseUrl = resolveDatabaseUrlFromEnv(process.env);
  const conn = await createDatabase(databaseUrl);
  try {
    // PG-major layer (C0 §15.2): refuse a PGDATA created under a different
    // PostgreSQL major. postgres itself refuses first; this gives a clearer
    // message.
    const pgVersionRows = await conn.sql<{ server_version_num: string }[]>`
      SHOW server_version_num
    `;
    const pgVersionNum = Number(pgVersionRows[0]?.server_version_num ?? 0);
    const pgMajor = Math.floor(pgVersionNum / 10000);
    if (pgMajor !== EXPECTED_PG_MAJOR) {
      process.stderr.write(
        `FAIL: PostgreSQL major mismatch. The bundled image pins ` +
          `postgres:${EXPECTED_PG_MAJOR}, but the database server reports ` +
          `major ${pgMajor} (version_num=${pgVersionNum}). Raw PGDATA is tied ` +
          `to a PostgreSQL major version; refusing to start against an ` +
          `incompatible major.\n`,
      );
      return { exitCode: 2, classification: { outcome: "BYPASSED" } };
    }

    // Detect the migration table. drizzle stores it in schema "drizzle".
    const regclassRows = await conn.sql<{ exists: string | null }[]>`
      SELECT to_regclass('drizzle.__drizzle_migrations') AS exists
    `;
    const tableExists = regclassRows[0]?.exists != null;

    let dbRows: PreflightDbRow[] = [];
    let isFreshInstall = false;
    if (!tableExists) {
      isFreshInstall = true;
    } else {
      const rows = await conn.sql<{ created_at: string; hash: string }[]>`
        SELECT created_at::text AS created_at, hash
        FROM drizzle.__drizzle_migrations
        ORDER BY created_at ASC
      `;
      dbRows = rows.map((r) => ({ createdAt: r.created_at, hash: r.hash }));
      if (dbRows.length === 0) {
        isFreshInstall = true;
      }
    }

    const classification = classifyMigrationCompatibility(
      image,
      dbRows,
      isFreshInstall,
    );
    report(classification);
    const ok =
      classification.outcome === "FRESH_INSTALL" ||
      classification.outcome === "NORMAL" ||
      classification.outcome === "FORWARD_UPGRADE";
    return { exitCode: ok ? 0 : 1, classification };
  } finally {
    await conn.sql.end();
  }
}

function report(c: PreflightClassification): void {
  const ok =
    c.outcome === "FRESH_INSTALL" ||
    c.outcome === "NORMAL" ||
    c.outcome === "FORWARD_UPGRADE";
  const stream = ok ? process.stdout : process.stderr;
  const prefix = ok ? "Preflight" : "FAIL: preflight";
  stream.write(
    `${prefix}: outcome=${c.outcome} ` +
      `(image=${c.imageCount}, db=${c.dbCount}, ` +
      `frontier db=${c.dbFrontier ?? "n/a"} image=${c.imageFrontier}).\n`,
  );
  stream.write(`${c.detail}\n`);
  // Compact machine-readable line for log scraping.
  process.stdout.write(
    JSON.stringify({
      preflight: c.outcome,
      imageCount: c.imageCount,
      dbCount: c.dbCount,
      dbFrontier: c.dbFrontier,
      imageFrontier: c.imageFrontier,
    }) + "\n",
  );
}

// ── Script body (runs only when executed as the entry point, not on import) ─

// Guard: only run the entrypoint body when this module is the process main
// module (i.e. `node dist/scripts/preflight.js`), NOT when imported by a test.
const isMainModule =
  process.argv[1] &&
  fileURLToPath(`file://${process.argv[1]}`) === fileURLToPath(import.meta.url);

if (isMainModule) {
  loadRootEnv();

  try {
    const { exitCode } = await runPreflight();
    process.exit(exitCode);
  } catch (err) {
    process.stderr.write(
      `FAIL: preflight encountered an error: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    process.exit(1);
  }
}
