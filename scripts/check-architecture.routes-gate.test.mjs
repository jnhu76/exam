import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// R-GATE-01 route DB ban (#1072) — counterfactual regression witness for the
// `apps/api/src/routes` scan in scripts/check-architecture.mjs.
//
// The gate is textual by contract (forbid()); this witness pins its BEHAVIOR,
// not its regexes: every counterfactual below is a route-registered DB-access
// form the gate must flag, and every legitimate fixture is a real caller
// shape the gate must keep green. The matrix is rebuilt from the 3-pattern
// scan at master 8e9b1d3b (scripts/check-architecture.mjs forbid("apps/api/
// src/routes") + the forbid() testHelpers.ts/.test. filename exemption):
// 18 counterfactuals = 17 kill mutants + 1 exemption witness. At that
// baseline exactly 6 are flagged — pc1/pc2/pc3 by their control shapes and
// m6/m7/m10 only because their payload carries a literal `db.select(` —
// while 11 syntax forms (aliased/destructured/optional-chained/
// Prettier-reflowed builders, raw .execute(, relational query API, dynamic
// import and require positions, @exam/db root with self-built connection,
// bare transaction writes) and the testHelpers filename-exemption face pass
// silently. This test fails on exactly that gap: RED until the scan kills
// every mutant, GREEN once it does.
//
// The checker's scan roots are CWD-relative by design ("the counterfactual
// harness can inject a repo root by running from a disposable worktree",
// scripts/check-architecture.mjs #938 comment), so the harness extracts the
// committed tree (git archive HEAD), overlays this worktree's gate/policy
// modules (scripts/ + config/ — the two directories the fix lands in), plants
// the fixtures into apps/api/src/routes/ and runs the real gate there. The
// violation set must be EXACTLY the kill set: a real routes file appearing in
// the output is a false positive of the same severity as a missed mutant. The
// second run executes the same tree with nothing planted and must stay green
// ("Architecture checks passed.", exit 0) — the fix's own scan of the real
// routes tree, so the gate going green here cannot be bought by breaking
// another scan or crashing the checker.
//
// CPU-only, tmpdir-only: no database, no Docker, no network (testing.md §2
// lifecycle contract not exercised). Wired as `pnpm test:routes-gate`.

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const GATE_SCRIPT = "scripts/check-architecture.mjs";
const ROUTES_PREFIX = "apps/api/src/routes/";

const FASTIFY_HEADER = `import type { FastifyInstance } from "fastify";\n`;

/**
 * The kill set: route-registered escape forms the gate MUST flag. File names
 * carry the E0 mutant ids; `form` names the syntax that evades the 3-pattern
 * baseline so a RED run diagnoses itself. pc1/pc2/pc3 are controls the
 * baseline already kills; m6/m7/m10 are flagged at baseline ONLY through
 * their `db.select(` payload — their import halves are among the forms the
 * fix must catch independently (m6b/m7b/m10b are those pure import faces).
 */
const KILL_MUTANTS = [
  {
    file: "wp07CexPc1DirectDbSelect.ts",
    form: "control: literal db.select( (flagged by the 3-pattern baseline too)",
    body: `${FASTIFY_HEADER}
export function wp07CexPc1(app: FastifyInstance): void {
  const db = app.db;
  app.get("/wp07-cex/pc1", async () => {
    const rows = await db.select().from(users);
    return { rows };
  });
}
`,
  },
  {
    file: "wp07CexPc2FromDrizzleOrm.ts",
    form: 'control: static from "drizzle-orm" import',
    body: `import { eq } from "drizzle-orm";
${FASTIFY_HEADER}
export function wp07CexPc2(app: FastifyInstance): void {
  app.get("/wp07-cex/pc2", async () => {
    return eq(users.id, "u1");
  });
}
`,
  },
  {
    file: "wp07CexPc3FromDbSchema.ts",
    form: 'control: static from "@exam/db/schema" import',
    body: `import { users } from "@exam/db/schema";
${FASTIFY_HEADER}
export function wp07CexPc3(app: FastifyInstance): void {
  app.get("/wp07-cex/pc3", async () => {
    return { table: users.name };
  });
}
`,
  },
  {
    file: "wp07CexM1AliasedReceiver.ts",
    form: "aliased receiver: const conn = fastify.db; conn.select(",
    body: `${FASTIFY_HEADER}
export function wp07CexM1(app: FastifyInstance): void {
  const conn = app.db;
  app.get("/wp07-cex/m1", async () => {
    const rows = await conn.select().from(users);
    return { rows };
  });
}
`,
  },
  {
    file: "wp07CexM2DestructuredSelect.ts",
    form: "destructured builder: const { select } = fastify.db",
    body: `${FASTIFY_HEADER}
export function wp07CexM2(app: FastifyInstance): void {
  const { select } = app.db;
  app.get("/wp07-cex/m2", async () => {
    const rows = await select().from(users);
    return { rows };
  });
}
`,
  },
  {
    file: "wp07CexM3Execute.ts",
    form: "raw SQL: fastify.db.execute(...)",
    body: `${FASTIFY_HEADER}
export function wp07CexM3(app: FastifyInstance): void {
  const sql = (strings: TemplateStringsArray) => strings.join("");
  app.get("/wp07-cex/m3", async () => {
    const result = await app.db.execute(sql\`select 1\`);
    return { result };
  });
}
`,
  },
  {
    file: "wp07CexM4RelationalQuery.ts",
    form: "drizzle relational query API: fastify.db.query.users.findFirst()",
    body: `${FASTIFY_HEADER}
export function wp07CexM4(app: FastifyInstance): void {
  app.get("/wp07-cex/m4", async () => {
    const user = await app.db.query.users.findFirst();
    return { user };
  });
}
`,
  },
  {
    file: "wp07CexM5DynamicImportDrizzle.ts",
    form: 'dynamic import: await import("drizzle-orm")',
    body: `${FASTIFY_HEADER}
export function wp07CexM5(app: FastifyInstance): void {
  app.get("/wp07-cex/m5", async () => {
    const { sql } = await import("drizzle-orm");
    return { q: sql\`select 1\` };
  });
}
`,
  },
  {
    file: "wp07CexM6SchemaImportWithPayload.ts",
    form: "static @exam/db/schema import (import half missed by baseline; file flagged only via payload)",
    body: `import { users } from "@exam/db/schema";
${FASTIFY_HEADER}
export function wp07CexM6(app: FastifyInstance): void {
  const db = app.db;
  app.get("/wp07-cex/m6", async () => {
    const rows = await db.select().from(users);
    return { rows };
  });
}
`,
  },
  {
    file: "wp07CexM6bSchemaDynamicImport.ts",
    form: 'dynamic import: await import("@exam/db/schema")',
    body: `${FASTIFY_HEADER}
export function wp07CexM6b(app: FastifyInstance): void {
  app.get("/wp07-cex/m6b", async () => {
    const { users } = await import("@exam/db/schema");
    return { table: users.name };
  });
}
`,
  },
  {
    file: "wp07CexM7DbRootImportWithPayload.ts",
    form: "@exam/db ROOT import + self-built connection (root specifier had no ban at all)",
    body: `import { createDatabase } from "@exam/db";
${FASTIFY_HEADER}
export function wp07CexM7(app: FastifyInstance): void {
  const db = createDatabase("postgres://localhost/wp07-cex-m7");
  app.get("/wp07-cex/m7", async () => {
    const rows = await db.select().from(users);
    return { rows };
  });
}
`,
  },
  {
    file: "wp07CexM7bDbRootImport.ts",
    form: "@exam/db ROOT import only — routes building their own connection",
    body: `import { createDatabase } from "@exam/db";
${FASTIFY_HEADER}
export function wp07CexM7b(app: FastifyInstance): void {
  app.get("/wp07-cex/m7b", async () => {
    return { hasFactory: typeof createDatabase === "function" };
  });
}
`,
  },
  {
    file: "wp07CexM8OptionalChain.ts",
    form: "optional chaining: fastify.db?.select(",
    body: `${FASTIFY_HEADER}
export function wp07CexM8(app: FastifyInstance): void {
  app.get("/wp07-cex/m8", async () => {
    const rows = await app.db?.select().from(users);
    return { rows };
  });
}
`,
  },
  {
    file: "wp07CexM9PrettierReflow.ts",
    form: "Prettier reflow: db\\n.select( — receiver and builder split across lines",
    body: `${FASTIFY_HEADER}
export function wp07CexM9(app: FastifyInstance): void {
  app.get("/wp07-cex/m9", async () => {
    const rows = await db
      .select({ id: users.id })
      .from(users);
    return { rows };
  });
}
`,
  },
  {
    file: "wp07CexM10RequireSchemaWithPayload.ts",
    form: "require() @exam/db/schema (require position missed by baseline; file flagged only via payload)",
    body: `${FASTIFY_HEADER}
export function wp07CexM10(app: FastifyInstance): void {
  const { users } = require("@exam/db/schema");
  const db = app.db;
  app.get("/wp07-cex/m10", async () => {
    const rows = await db.select().from(users);
    return { rows };
  });
}
`,
  },
  {
    file: "wp07CexM10bRequireSchema.ts",
    form: "require() @exam/db/schema only",
    body: `${FASTIFY_HEADER}
export function wp07CexM10b(app: FastifyInstance): void {
  app.get("/wp07-cex/m10b", async () => {
    const { users } = require("@exam/db/schema");
    return { table: users.name };
  });
}
`,
  },
  {
    file: "wp07CexM11Transaction.ts",
    form: "bare .transaction( with raw tx writes: tx.insert(...).values(...)",
    body: `${FASTIFY_HEADER}
export function wp07CexM11(app: FastifyInstance): void {
  app.post("/wp07-cex/m11", async () => {
    await app.db.transaction(async (tx) => {
      await tx.insert(users).values({ name: "x" });
    });
    return { ok: true };
  });
}
`,
  },
];

/**
 * Exemption witness, NOT part of the kill set: a `*.testHelpers.ts` file is
 * not a registered route module and stays exempt from forbid() filename
 * scans — the accepted E0 disposition (M13). Its body carries a
 * would-be-flagged shape to prove the filename exemption, not a content
 * hole, is what keeps it green.
 */
const EXEMPT_WITNESS = {
  file: "wp07CexM13Seed.testHelpers.ts",
  body: `${FASTIFY_HEADER}
export function wp07CexM13Seed(app: FastifyInstance): void {
  const db = app.db;
  const rows = db.select().from(users);
  app.get("/wp07-cex/m13", async () => ({ rows }));
}
`,
};

/**
 * Legitimate caller shapes the gate must keep green — the as-built real
 * route idioms on this master: executeInTransaction(fastify.db, ...)
 * (apps/api/src/routes/course.ts:232), repo factory chains
 * createCourseRepo(fastify.db) (apps/api/src/routes/course.ts:104), and the
 * allowed @exam/db import faces (repository/* subpaths, types, databaseUrl,
 * testScope, testIsolation, testWorkerDatabase).
 */
const LEGIT_FIXTURES = [
  {
    file: "wp07LegitExecuteInTransaction.ts",
    body: `${FASTIFY_HEADER}
export function wp07LegitTx(app: FastifyInstance): void {
  app.post("/wp07-legit/tx", async () => {
    await executeInTransaction(app.db, async (tx) => {
      await createCourseRepo(tx).update(ctx, courseId, input);
    });
    return { ok: true };
  });
}
`,
  },
  {
    file: "wp07LegitRepoFactoryChain.ts",
    body: `${FASTIFY_HEADER}
export function wp07LegitRepoChain(app: FastifyInstance): void {
  app.patch("/wp07-legit/repo-chain", async () => {
    const updated = await createCourseRepo(app.db).update(courseId, input);
    return { updated };
  });
}
`,
  },
  {
    file: "wp07LegitWhitelistedDbImports.ts",
    body: `import { createCourseRepo } from "@exam/db/repository/courseRepo";
import { parseAppMode } from "@exam/db/databaseUrl";
import { withDatabaseName } from "@exam/db/testWorkerDatabase";
import { resolveTestScope } from "@exam/db/testScope";
import { createTestSchema } from "@exam/db/testIsolation";
import type { CourseRow } from "@exam/db/types";
${FASTIFY_HEADER}
export function wp07LegitWhitelistedImports(app: FastifyInstance): void {
  app.get("/wp07-legit/whitelisted-imports", async () => {
    return {
      repo: typeof createCourseRepo,
      worker: typeof withDatabaseName,
      scope: typeof resolveTestScope,
      schema: typeof createTestSchema,
    };
  });
}
`,
  },
];

/**
 * Extract HEAD into `base/tree` and plant `fixtures` route files (default:
 * every counterfactual — kill mutants, exemption witness, legit shapes).
 */
async function buildFixtureTree(
  base,
  fixtures = [...KILL_MUTANTS, EXEMPT_WITNESS, ...LEGIT_FIXTURES],
) {
  const tree = join(base, "tree");
  await mkdir(tree);
  const tarball = join(base, "tree.tar");
  const archive = spawnSync("git", ["archive", "-o", tarball, "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(archive.status, 0, `git archive HEAD failed: ${archive.stderr}`);
  const untar = spawnSync("tar", ["-xf", tarball, "-C", tree], {
    encoding: "utf8",
  });
  assert.equal(untar.status, 0, `tar extraction failed: ${untar.stderr}`);
  // The fix lands in scripts/ (the gate) and config/ (policy tables). The
  // overlay exercises the gate as it exists in this worktree, committed or
  // not; on a clean tree it is byte-identical to the archive.
  await cp(join(REPO_ROOT, "scripts"), join(tree, "scripts"), {
    recursive: true,
  });
  await cp(join(REPO_ROOT, "config"), join(tree, "config"), {
    recursive: true,
  });
  for (const { file, body } of fixtures) {
    await writeFile(join(tree, ROUTES_PREFIX, file), body);
  }
  return tree;
}

test("route DB gate flags every counterfactual escape form and nothing else", async () => {
  const base = await mkdtemp(join(tmpdir(), "wp07-routes-gate-"));
  try {
    const tree = await buildFixtureTree(base);
    const run = spawnSync(process.execPath, [GATE_SCRIPT], {
      cwd: tree,
      encoding: "utf8",
    });
    assert.equal(
      run.status,
      1,
      `gate must exit 1 over planted counterfactuals, exited ${run.status}\nstderr:\n${run.stderr}\nstdout:\n${run.stdout}`,
    );

    const flagged = new Set();
    for (const line of run.stderr.split("\n")) {
      if (!line.startsWith(ROUTES_PREFIX)) continue;
      const file = line.slice(ROUTES_PREFIX.length).split(":")[0];
      if (file.endsWith(".ts")) flagged.add(file);
    }

    // Zero false positives BEFORE kill completeness (#1076 recheck F1): with
    // the missed assertion first, a RED run (scan incomplete) failed there
    // and never proved the flagged ⊆ kill-set half — the field had to be
    // filled by a manual gate run. This order keeps both halves of the
    // oracle reachable in RED: the subset check passes or fails on its own
    // evidence first, then the kill-set check reports the escape forms.
    const killFiles = new Set(KILL_MUTANTS.map(({ file }) => file));
    const falsePositives = [...flagged].filter((file) => !killFiles.has(file));
    assert.deepEqual(
      falsePositives,
      [],
      `route DB gate flags files outside the kill set — false positives (the exemption witness and legit caller shapes must stay green):\n  ${falsePositives.join("\n  ")}`,
    );

    const missed = KILL_MUTANTS.filter(({ file }) => !flagged.has(file)).map(
      ({ file, form }) => `${file} (${form})`,
    );
    assert.deepEqual(
      missed,
      [],
      `route DB gate MISSES these escape forms — they must be flagged:\n  ${missed.join("\n  ")}`,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("route DB gate keeps the pristine route tree green (zero false positives)", async () => {
  const base = await mkdtemp(join(tmpdir(), "wp07-routes-gate-pristine-"));
  try {
    const tree = await buildFixtureTree(base, []);
    const run = spawnSync(process.execPath, [GATE_SCRIPT], {
      cwd: tree,
      encoding: "utf8",
    });
    assert.equal(
      run.status,
      0,
      `gate must pass the pristine committed tree, exited ${run.status}\nstderr:\n${run.stderr}\nstdout:\n${run.stdout}`,
    );
    assert.match(
      run.stdout,
      /^Architecture checks passed\.$/m,
      `gate must report a clean pass over the pristine tree\nstdout:\n${run.stdout}`,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
