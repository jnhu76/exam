import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  RUNTIME_DEPENDENCY_BOUNDARIES,
  forbiddenImportPattern,
  forbiddenRuntimeDependencies,
} from "../config/architecture-policy.mjs";

const violations = [];

async function files(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (["dist", "coverage", "node_modules"].includes(entry.name)) continue;
    const target = join(path, entry.name);
    if (entry.isDirectory()) result.push(...(await files(target)));
    else if (/\.(ts|tsx)$/.test(entry.name)) result.push(target);
  }
  return result;
}

async function forbid(path, patterns) {
  for (const file of await files(path)) {
    if (file.endsWith("testHelpers.ts") || file.includes(".test.")) continue;
    const text = await readFile(file, "utf8");
    for (const [pattern, message] of patterns) {
      if (pattern.test(text)) {
        violations.push(`${relative(".", file)}: ${message}`);
      }
    }
  }
}

await forbid("packages/domain/src", [
  [
    /from ["'](?:fastify|react|drizzle-orm|@exam\/)/,
    "domain must remain a leaf package",
  ],
]);
// authz is the RBAC leaf package (ADR-010-scoped-rbac-architecture.md): no
// fastify/React/Drizzle, and it may only reach @exam/domain, so the permission
// vocabulary stays portable. The forbidden @exam/* set is the canonical table
// in config/architecture-policy.mjs (the manifest deny-list and this source
// scan derive from the same authority); the pattern anchors import positions,
// so root and subpath spellings are both caught.
await forbid("packages/authz/src", [
  [
    /from ["'](?:fastify|react|drizzle-orm)/,
    "authz must stay a leaf package (no fastify/React/Drizzle)",
  ],
  [
    forbiddenImportPattern("@exam/authz"),
    "authz may only depend on @exam/domain (AUTHZ_RUNTIME_BOUNDARY)",
  ],
]);
await forbid("packages/contracts/src", [
  [/from ["']fastify/, "contracts cannot depend on fastify"],
]);
// @exam/auth owns the JWT/password mechanism only (#733 R3): application mode
// and secret policy are resolved by the canonical settings/runtimeConfig
// authority and passed in as explicit arguments, so the package must not read
// the environment itself.
await forbid("packages/auth/src", [
  [
    /process\.env/,
    "auth package must not read process.env — configuration enters as explicit arguments",
  ],
]);
// Runtime mode is resolved by packages/db/src/databaseUrl.ts::parseAppMode and
// nowhere else (#733 R4): a consumer that compares the raw process environment
// re-implements the precedence policy (APP_MODE authoritative, NODE_ENV the
// fallback, an invalid APP_MODE throws) and silently disagrees whenever the
// other input selected the mode — the drift F-05 and F-08 shipped. Consumers
// classify the RESOLVED mode; the resolver reads its `env` parameter, so no
// module needs the direct process form. Scope is the modules that own
// runtime-mode consumers (the API application and the db package).
//
// This pins the direct property form only. A destructured, aliased or
// dynamically keyed read (`const { APP_MODE } = process.env`, `const e =
// process.env; e.APP_MODE`, `process.env[key]`) is out of reach of a textual
// guard and stays a review responsibility.
const runtimeModeRawRead =
  /process\.env\??(?:\.(?:APP_MODE|NODE_ENV)\b|\[["'](?:APP_MODE|NODE_ENV)["']\])/;
for (const moduleDir of ["apps/api/src", "packages/db/src"]) {
  await forbid(moduleDir, [
    [
      runtimeModeRawRead,
      "runtime mode comes from @exam/db parseAppMode — classify the resolved mode instead of reading the raw process env",
    ],
  ]);
}
// Physical dotenv admission belongs to application entrypoints (#733): the
// canonical seam is apps/api's loadRootEnv, mode-gated via parseAppMode.
// packages/db/src is shared mechanism — seed.ts, the E2E seed orchestrator,
// test-isolation helpers — imported by tests, API helpers, and research
// harnesses, so module evaluation must never read a developer .env into
// process.env (the F-06 defect: a module-level dotenv.config() made every
// importer admit the file a second time, even after the managed entrypoint
// had refused it). The one legitimate dotenv consumer in the package is the
// drizzle-kit CLI config, which lives outside src/.
await forbid("packages/db/src", [
  [
    /from ["']dotenv["']|require\(["']dotenv["']\)|dotenv\s*\.\s*config/,
    "shared db mechanism must not admit dotenv sources — entrypoints own source admission",
  ],
]);
await forbid("packages/exam-engine/src", [
  [/from ["']fastify/, "exam-engine cannot depend on fastify"],
  // No explicit cast to the transaction-affine EA capability: the brand symbols
  // are module-private, the only legitimate mint is the canonical seam
  // (lockEnrollmentAndAttempt), and a cast is a forgery bypass.
  [
    /\bas\s+LockedEnrollmentAttemptIdentity\b/,
    "do not cast to LockedEnrollmentAttemptIdentity — mint via lockEnrollmentAndAttempt",
  ],
  // No explicit cast to the narrow opaque Attempt mutation context. Its
  // provenance brand is module-private (deadlineReconciliation.ts); the only
  // legitimate mint is the canonical preparation seam
  // (prepareReconciledAttemptMutation). A cast is a forgery bypass that would
  // defeat the repo-affinity proof. The .testHelpers.ts file is exempt (test
  // harness).
  [
    /\bas\s+ReconciledAttemptMutationContext\b/,
    "do not cast to ReconciledAttemptMutationContext — mint via prepareReconciledAttemptMutation",
  ],
]);
await forbid("apps/api/src", [
  [
    /\bas\s+LockedEnrollmentAttemptIdentity\b/,
    "do not cast to LockedEnrollmentAttemptIdentity — mint via lockEnrollmentAndAttempt",
  ],
  [
    /\bas\s+ReconciledAttemptMutationContext\b/,
    "do not cast to ReconciledAttemptMutationContext — mint via prepareReconciledAttemptMutation",
  ],
]);
await forbid("apps/web/src", [
  [
    forbiddenImportPattern("@exam/web"),
    "web must not depend on server-side packages (WEB_RUNTIME_BOUNDARY)",
  ],
]);
await forbid("apps/api/src/routes", [
  [
    /\bdb\.(?:select|insert|update|delete)\s*\(/,
    "routes must use repositories",
  ],
  [/from ["']drizzle-orm/, "routes must not import drizzle-orm directly"],
  [
    /from ["']@exam\/db\/schema(\/|["'])/,
    "routes must not import DB schema directly",
  ],
]);

// ---------------------------------------------------------------------------
// #794 — workspace module resolution governance. The unified contract lives
// in docs/architecture/workspace-module-resolution.md; the authority is
// config/workspace-resolution.mjs — imported here (not re-implemented) so
// manifests, vitest projects and active imports cannot drift back to
// per-package aliases, inline workarounds or physical /src/ specifiers (the
// #689/#794 stale-dist failure modes).

// Layer 1 (package contract validation): loading the table validates every
// manifest — three-condition entries, single-star pattern keys, disjoint
// pattern families, src/default target existence, declared negative
// entries. A load error IS the violation; report it and stop.
const authority = await import("../config/workspace-resolution.mjs");
const TEST_SOURCE_CONDITION = authority.TEST_SOURCE_CONDITION;
try {
  authority.loadWorkspaceResolutionTable();
} catch (err) {
  violations.push(
    `workspace manifests: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// Layer 1b (#824): the declared-but-forbidden dependency vector. A forbidden
// edge enters through a manifest edit, and once declared it executed green at
// every layer (P1 cases C1c′/C2b), so the check runs on the real workspace
// manifests — before any import spelling matters. The deny-lists live in
// config/architecture-policy.mjs; only `dependencies` is the product graph
// (test-scope devDependencies stay outside per the #824 D2 disposition).
// Fail-closed: an importer manifest that is missing, unreadable or renamed
// away is a violation, never a silent skip — the boundary must be checkable.
for (const boundary of RUNTIME_DEPENDENCY_BOUNDARIES) {
  const shortName = boundary.importer.slice("@exam/".length);
  const manifestPath = ["packages", "apps"]
    .map((root) => join(root, shortName, "package.json"))
    .find(existsSync);
  if (!manifestPath) {
    violations.push(
      `${boundary.importer}: no manifest at packages/${shortName}/ or apps/${shortName}/ — the ${boundary.rule} boundary must stay checkable`,
    );
    continue;
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (err) {
    violations.push(
      `${manifestPath}: cannot read or parse manifest — ${
        err instanceof Error ? err.message : String(err)
      } (${boundary.rule} must stay checkable)`,
    );
    continue;
  }
  if (manifest.name !== boundary.importer) {
    violations.push(
      `${manifestPath}: declares name ${JSON.stringify(
        manifest.name ?? null,
      )} but the ${boundary.rule} policy names importer "${boundary.importer}" — the boundary must not silently target a renamed package`,
    );
    continue;
  }
  for (const finding of forbiddenRuntimeDependencies(manifest)) {
    violations.push(
      `${manifestPath}: ${finding.rule} — importer ${finding.importer} declares forbidden runtime dependency "${finding.dependency}" in "${finding.field}"; ${finding.rationale}`,
    );
  }
}

async function allCodeFiles(path, extensions) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (["dist", "coverage", "node_modules", ".turbo"].includes(entry.name))
      continue;
    const target = join(path, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await allCodeFiles(target, extensions)));
    } else if (extensions.some((e) => entry.name.endsWith(e))) {
      result.push(target);
    }
  }
  return result;
}

// 3. Active code must not import physical package-internal src paths. This
// is specifier-shaped (not a bare grep): it matches imports, dynamic
// imports, vi.mock strings and doc references alike — a physical /src/
// specifier in active code is always a resolution-contract violation.
// Cross-package RELATIVE imports are banned for the same reason: they bypass
// the declared exports contract and load whatever file the path happens to
// name (docs/architecture/workspace-module-resolution.md).
const PHYSICAL_SRC_SPECIFIER = /@exam\/[a-z-]+\/src\//;
const CROSS_PACKAGE_RELATIVE =
  /(?:from|import|require\()\s*["'][^"']*\.\.[/\\]packages[/\\]/;
for (const file of await allCodeFiles("apps", [".ts", ".tsx", ".mjs", ".js"])) {
  if (file.endsWith(".d.ts")) continue;
  const text = await readFile(file, "utf8");
  if (PHYSICAL_SRC_SPECIFIER.test(text)) {
    violations.push(
      `${file}: physical "@exam/*/src/" specifier — import the package's public root/subpath entries instead (#794)`,
    );
  }
  if (CROSS_PACKAGE_RELATIVE.test(text)) {
    violations.push(
      `${file}: cross-package relative import — workspace code reaches other packages only through their public exports (#794)`,
    );
  }
}
for (const dir of ["packages", "config", "scripts"]) {
  for (const file of await allCodeFiles(dir, [".ts", ".tsx", ".mjs", ".js"])) {
    if (file.endsWith(".d.ts")) continue;
    const text = await readFile(file, "utf8");
    if (PHYSICAL_SRC_SPECIFIER.test(text)) {
      violations.push(`${file}: physical "@exam/*/src/" specifier (#794)`);
    }
    if (CROSS_PACKAGE_RELATIVE.test(text)) {
      violations.push(`${file}: cross-package relative import (#794)`);
    }
  }
}

// 4. Every vitest config in the workspace — package/app main configs AND
// app child harness configs (the api process tests' fixture runners) — must
// consume the shared resolution plugin: any config that skips it would
// resolve governed @exam/* imports to dist behind the test's back
// (review round 2: the api slot-reuse/bootstrap-lifetime child configs were
// exactly that gap). Package configs additionally must exist at all for
// tested packages.
for (const entry of await readdir("packages", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgDir = join("packages", entry.name);
  const manifest = JSON.parse(
    await readFile(join(pkgDir, "package.json"), "utf8"),
  );
  if (!manifest.scripts?.test) continue;
  const configPath = join(pkgDir, "vitest.config.ts");
  if (!existsSync(configPath)) {
    violations.push(
      `${configPath}: missing — every tested workspace package needs a vitest project (#794)`,
    );
    continue;
  }
  const configText = await readFile(configPath, "utf8");
  if (!configText.includes("workspaceSourceResolutionPlugin")) {
    violations.push(
      `${configPath}: does not consume workspaceSourceResolutionPlugin — direct vitest runs would resolve workspace packages to dist`,
    );
  }
}
// INVARIANT: the walker's extension list must cover everything the regex
// below admits — a narrower list silently exempts .mjs/.js vitest configs
// from the plugin requirement while the gate appears to scan them.
for (const configPath of await allCodeFiles("apps", [".ts", ".mjs", ".js"])) {
  if (!/(?:^|\/)vitest\.[\w.]*config\.(?:ts|mjs|js)$/.test(configPath)) {
    continue;
  }
  const configText = await readFile(configPath, "utf8");
  if (!configText.includes("workspaceSourceResolutionPlugin")) {
    violations.push(
      `${configPath}: does not consume workspaceSourceResolutionPlugin — every vitest config is a governed resolution context (#794)`,
    );
  }
}

// 5. Every vitest project that consumes the plugin must also carry its
// permanent resolution oracle — the positive fixture-marker assertions AND
// every fail-closed classification from the authority (deleting the
// oracles, or dropping one rejection class, would otherwise pass every
// static gate and leave the mechanism unproven). The api globalSetup must
// carry the main-process canary (review round 1, #794; negatives round 2).
const ORACLE_ASSERTION =
  'expect(SOURCE_FIXTURE_MARKER).toBe("source-fixture:src:root")';
// Dot-segment grammar probe each oracle must pin (review round 3, #794):
// a capture with ".." used to join()-normalize onto files the exports
// field never declared (live-bypassed: "@exam/db/repository/../sqlIdent"
// executed src/sqlIdent.ts while native Node rejected the specifier).
const FIXTURE_GRAMMAR_PROBE =
  'dynamicImport("@exam/source-fixture/deep/../index")';
const API_GRAMMAR_PROBE = 'dynamicImport("@exam/db/repository/../sqlIdent")';
for (const entry of await readdir("packages", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgDir = join("packages", entry.name);
  const manifest = JSON.parse(
    await readFile(join(pkgDir, "package.json"), "utf8"),
  );
  if (
    !manifest.scripts?.test ||
    !manifest.devDependencies?.["@exam/source-fixture"]
  )
    continue;
  const oraclePath = join(pkgDir, "src/workspaceSourceResolution.test.ts");
  await requireCompleteOracle(oraclePath, FIXTURE_GRAMMAR_PROBE);
}
for (const app of ["apps/api", "apps/web"]) {
  await requireCompleteOracle(
    join(app, "src/workspaceSourceResolution.test.ts"),
    app === "apps/api" ? API_GRAMMAR_PROBE : FIXTURE_GRAMMAR_PROBE,
  );
}
const apiGlobalSetup = await readFile("apps/api/vitest.globalSetup.ts", "utf8");
if (
  !apiGlobalSetup.includes(
    'SOURCE_FIXTURE_MARKER !== "source-fixture:src:root"',
  )
) {
  violations.push(
    "apps/api/vitest.globalSetup.ts: main-process source-resolution canary missing (#794)",
  );
}

async function requireCompleteOracle(oraclePath, grammarProbe) {
  if (!existsSync(oraclePath)) {
    violations.push(
      `${oraclePath}: missing — every plugin-consuming project must pin both resolution rails with the fixture oracle (#794)`,
    );
    return;
  }
  const oracleText = await readFile(oraclePath, "utf8");
  if (!oracleText.includes(ORACLE_ASSERTION)) {
    violations.push(
      `${oraclePath}: does not assert the fixture src marker — execution provenance assertion missing (#794)`,
    );
  }
  // Assertion-shaped, like the classification needles below (review round
  // 3): the probe specifier is quoted in the oracles' explanatory comments,
  // so a bare includes() would pass with the executable probe deleted. The
  // shape pins the call: dynamicImport("SPEC")[,)] followed by
  // .rejects.toThrow (whitespace/newline tolerant — Prettier reflows).
  const grammarNeedle = new RegExp(
    `${grammarProbe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,?\\s*\\)\\s*\\.rejects\\.toThrow`,
  );
  if (!grammarNeedle.test(oracleText)) {
    violations.push(
      `${oraclePath}: missing the dot-segment grammar probe (${grammarProbe}) executable rejection — captures that escape the declared pattern family must be pinned (#794)`,
    );
  }
  // Assertion-shaped needles, not bare words (review round 2): the
  // classification names also appear in the oracle docblock, so a textual
  // scan for the word alone would pass with the rejection tests deleted.
  // Whitespace/trailing-comma tolerant — Prettier reflows the toThrow call,
  // and a needle pinned to one spelling breaks on every reformat (observed
  // live when format split `.rejects.toThrow(\n  /CLASS/,\n)`).
  for (const classification of authority.RESOLUTION_FAILURE_CLASSIFICATIONS) {
    const rejectionShape = new RegExp(
      `\\.rejects\\.toThrow\\(\\s*/${classification}/\\s*[),]`,
    );
    if (!rejectionShape.test(oracleText)) {
      violations.push(
        `${oraclePath}: does not pin the fail-closed classification ${classification} with an executable rejection (#794)`,
      );
    }
  }
}

// 6. Every typecheck entrypoint must activate the same reserved condition
// the plugin does — otherwise type evidence silently reverts to dist .d.ts
// and a stale build can fake a typecheck PASS while tests execute fresh
// sources (review round 2, #794). Applies to the api, the web app and every
// workspace package that declares a typecheck script.
for (const dir of ["apps/api", "apps/web", ...(await listPackageDirs())]) {
  const manifest = JSON.parse(
    await readFile(join(dir, "package.json"), "utf8"),
  );
  if (!manifest.scripts?.typecheck) continue;
  const typecheckConfig = join(dir, "tsconfig.typecheck.json");
  if (!existsSync(typecheckConfig)) {
    violations.push(
      `${typecheckConfig}: missing — a typecheck script must pin ${TEST_SOURCE_CONDITION} via customConditions (#794)`,
    );
    continue;
  }
  const typecheckText = await readFile(typecheckConfig, "utf8");
  if (!typecheckText.includes(`"${TEST_SOURCE_CONDITION}"`)) {
    violations.push(
      `${typecheckConfig}: customConditions must contain the TEST_SOURCE_CONDITION from config/workspace-resolution.mjs (#794)`,
    );
  }
}

async function listPackageDirs() {
  const dirs = [];
  for (const entry of await readdir("packages", { withFileTypes: true })) {
    if (entry.isDirectory()) dirs.push(join("packages", entry.name));
  }
  return dirs;
}

if (violations.length > 0) {
  process.stderr.write(`Architecture violations:\n${violations.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Architecture checks passed.\n");
