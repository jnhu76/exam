import { defineConfig } from "vitest/config";

// FIXME(BUG-FLAKE-001): apps/api 跨文件并行 + 共享 PostgreSQL schema + coverage
// instrumentation 会造成 attempts.test.ts:1070 后台扫描用例在 pnpm verify 路径下
// 偶发 5s timeout（已升级条目，见 docs/dev/test-flakes.md）。
//
// 默认缓解（未变）：fileParallelism: false 让所有 apps/api 测试文件串行执行，
// 从源头消除跨文件 DB 资源争用。代价：apps/api test/coverage 时间约翻倍。
//
// B 方案（每测试文件独立 PG schema）已完成全量迁移，消除了跨文件 DB 状态泄漏。
// 此处保留 fileParallelism: false 作为默认安全网：apps/api 的 auth.test.ts 在
// 默认并行下仍会因并发 buildTestApp() + 6 轮 audit-polling 叠加导致偶发超时。
// packages/db 已恢复并行（见其 vitest.config.ts），turbo 层通过
// @exam/db#coverage dependsOn @exam/db#test 避免 DB-heavy task 叠压。
//
// PR86 诊断矩阵（vitest 4.1.x，8 core，10 GB）：
//   A 串行（默认）                  → 8/8 PASS
//   B 并行默认 workers（~7）         → 2 PASS / 1 FAIL（@run 3，5007ms timeout）
//   C 并行 + maxWorkers=50%（~4）    → 15/15 PASS
//   D 并行 + maxWorkers=25%（~2）    → 10/10 PASS
//   E turbo --force 冷缓存（串行）   → 5/5 PASS
// 含义：限流到 ≤4 workers 可消除本机超时，但 maxWorkers 必须与
// --fileParallelism 同时提供才有效 —— fileParallelism:false 会把 maxWorkers
// 强制为 1（见 vitest resolveConfig / UserWhence 类型 doc comment：
// "Setting this to `false` will override `maxWorkers` option to `1`"），
// 单独传 --maxWorkers=50% 会被覆盖、退化为串行。
// 详见 docs/dev/test-flakes.md BUG-FLAKE-001。
//
// ─── ADR-007 Phase 5A/5B opt-in local parallelism（env-gated）──────────────
// 默认行为不变：fileParallelism:false（串行）。仅当同时满足两个条件时才打开并行：
//   1. TEST_DB_ISOLATION=worker-database  —— per-worker PG database 隔离就位
//      （file-schema 下并行会触发 BUG-FLAKE-001 历史动机，禁止）。
//   2. API_TEST_MAX_WORKERS 是正整数（≥1）—— 显式 opt-in 的 worker 上限。
// 满足时：fileParallelism=true, maxWorkers=<N>。
// 任何其它情况（unset / file-schema / 非法 API_TEST_MAX_WORKERS / 二者缺一）
// 都保持默认串行，CI flag 无法绕过。
//
// 关键：并行模式下**绝不能**设置 TEST_WORKER_ID。resolveWorkerId() 优先读
// TEST_WORKER_ID，若固定为 1，所有 vitest worker 都会解析成 worker 1 → 共用
// exam_test_w1 → per-worker database 隔离失效。并行依赖 vitest 自动注入的
// VITEST_WORKER_ID。serial 模式（本配置默认）可以手工设 TEST_WORKER_ID=1。
//
// 非法 API_TEST_MAX_WORKERS（非数字 / ≤0 / 非整数）直接 throw，fail-fast，
// 不静默退化为串行（避免开发者以为在跑并行实际却串行）。
function resolveParallelism(): {
  fileParallelism: boolean;
  maxWorkers?: number;
} {
  const dbIsolation = process.env.TEST_DB_ISOLATION;
  const rawMax = process.env.API_TEST_MAX_WORKERS;

  // No opt-in → legacy serial default.
  if (rawMax === undefined || rawMax === "") {
    return { fileParallelism: false };
  }
  // API_TEST_MAX_WORKERS is set. Require worker-database mode; reject otherwise
  // rather than silently running parallel against shared schema.
  if (dbIsolation !== "worker-database") {
    throw new Error(
      `[vitest.config] API_TEST_MAX_WORKERS=${rawMax} requires TEST_DB_ISOLATION=worker-database ` +
        `(got TEST_DB_ISOLATION=${JSON.stringify(dbIsolation)}). ` +
        `Parallel file-schema mode would reintroduce BUG-FLAKE-001. ` +
        `Unset API_TEST_MAX_WORKERS for serial, or set TEST_DB_ISOLATION=worker-database.`,
    );
  }
  const parsed = Number(rawMax);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `[vitest.config] API_TEST_MAX_WORKERS must be a positive integer (got ${JSON.stringify(rawMax)}).`,
    );
  }
  return { fileParallelism: true, maxWorkers: parsed };
}

const parallelism = resolveParallelism();

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    fileParallelism: parallelism.fileParallelism,
    ...(parallelism.maxWorkers !== undefined
      ? { maxWorkers: parallelism.maxWorkers }
      : {}),
    coverage: {
      thresholds: {
        lines: 60,
        branches: 50,
        functions: 50,
      },
    },
  },
});
