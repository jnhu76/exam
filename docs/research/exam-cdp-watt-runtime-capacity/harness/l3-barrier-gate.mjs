#!/usr/bin/env node
/**
 * #900/#1021 L3 B-arm — single-node entrypoint that reruns the COMPLETE
 * barrier suite (protocol §10 L3-ADMISSION; mechanism tests, ≥5 reps/case).
 *
 * Contract (ask): "在 cwd=/home/hoo/Source/exam 下用 node 独立重跑全部
 * barrier 测试的完整 argv" — this script is that argv's sole argument, so
 * the whole gate is ONE `node` invocation with absolute paths and no shell
 * chaining:
 *
 *   node /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/l3-barrier-gate.mjs
 *
 * Phases (both must pass; the first failure aborts with its exit code):
 *   1. In-process deterministic barrier tests via the worktree's vitest
 *      (gate machinery 9 cases + login route barrier 8 cases, real PG).
 *      Env loading: the vitest config itself seeds process.env from the
 *      SUPPORTED test env files (config/vitest.shared.ts — repo root .env
 *      / .env.test.local, exact-path reads) and forces APP_MODE/NODE_ENV;
 *      the DB target resolves to the repo test-branch database
 *      (packages/db/src/databaseUrl.ts name guard) — no external env is
 *      required beyond the caller's own.
 *   2. Real-Nginx barrier runner (two-client disconnect / queue-full /
 *      wait-expiry, ×5 reps each) on the isolated L3 topology
 *      (API dist-l3:3310, nginx exam-cap-net-l3:8081, research DB
 *      exam_550_l3_barrier). Requires: dev compose PG/Redis up
 *      (pnpm -C .wt-capacity db:up), Docker usable, ports 3310/8081 free;
 *      the runner creates and tears down ALL of its own resources.
 *
 * The A-arm measurement path (apps/api/dist, port 3300/8080, exam_550_e2e,
 * container exam-cap-nginx) is never touched; the runner witnesses A's
 * health before and after.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NODE = process.execPath;
const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKTREE = "/home/hoo/Source/exam/.wt-capacity";
const API_DIR = `${WORKTREE}/apps/api`;

const VITEST = `${API_DIR}/node_modules/vitest/vitest.mjs`;
const TSX = `${API_DIR}/node_modules/tsx/dist/cli.mjs`;
const NGINX_RUNNER = `${HERE}l3-barrier-nginx.ts`;

const BARRIER_TEST_FILES = [
  "src/lib/loginAdmission.gate.test.ts",
  "src/routes/auth.loginAdmission.test.ts",
];

function run(phase, args) {
  process.stdout.write(
    `\n[l3-barrier-gate] phase: ${phase}\n${NODE} ${args.join(" ")}\n\n`,
  );
  const result = spawnSync(NODE, args, { stdio: "inherit" });
  if (result.error) {
    process.stderr.write(
      `[l3-barrier-gate] ${phase} failed to spawn: ${String(result.error)}\n`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(
      `[l3-barrier-gate] ${phase} FAILED (exit ${result.status})\n`,
    );
    process.exit(result.status ?? 1);
  }
  process.stdout.write(`[l3-barrier-gate] phase ok: ${phase}\n`);
}

run("vitest in-process barrier (gate + route)", [
  VITEST,
  "run",
  "--root",
  API_DIR,
  "--config",
  `${API_DIR}/vitest.config.ts`,
  ...BARRIER_TEST_FILES,
]);

run("real-nginx barrier runner (A/B/C ×5 reps)", [TSX, NGINX_RUNNER]);

process.stdout.write(
  "[l3-barrier-gate] ALL BARRIER TESTS GREEN (17 vitest + 15 nginx reps)\n",
);
process.exit(0);
