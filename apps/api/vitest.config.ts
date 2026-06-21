import { defineConfig } from "vitest/config";

// FIXME(BUG-FLAKE-001): apps/api 跨文件并行 + 共享 PostgreSQL schema + coverage
// instrumentation 会造成 attempts.test.ts:1070 后台扫描用例在 pnpm verify 路径下
// 偶发 5s timeout（已升级条目，见 docs/dev/test-flakes.md）。
//
// 当前缓解：fileParallelism: false 让所有 apps/api 测试文件串行执行，
// 从源头消除跨文件 DB 资源争用。代价：apps/api test/coverage 时间约翻倍。
//
// B 方案（每测试文件独立 PG schema）已完成全量迁移，消除了跨文件 DB 状态泄漏。
// 此处保留 fileParallelism: false 作为安全网：apps/api 的 auth.test.ts 在
// 默认并行下仍会因并发 buildTestApp() + 6 轮 audit-polling 叠加导致偶发超时。
// packages/db 已恢复并行（见其 vitest.config.ts），turbo 层通过
// @exam/db#coverage dependsOn @exam/db#test 避免 DB-heavy task 叠压。
//
// PR86 诊断矩阵（vitest 4.1.x，8 core，10 GB）：
//   A 串行（本配置）              → 8/8 PASS
//   B 并行默认 workers（~7）       → 2 PASS / 1 FAIL（@run 3，5007ms timeout）
//   C 并行 + maxWorkers=50%（~4）  → 15/15 PASS
//   D 并行 + maxWorkers=25%（~2）  → 10/10 PASS
//   E turbo --force 冷缓存（串行） → 5/5 PASS
// 含义：限流到 ≤4 workers 可消除本机超时，但 maxWorkers 必须与
// --fileParallelism 同时提供才有效 —— 本配置的 fileParallelism:false
// 会把 maxWorkers 强制为 1（见 vitest resolveConfig），单独传
// --maxWorkers=50% 会被覆盖、退化为串行。因此不能用 CI flag 旁路本配置。
// 详见 docs/dev/test-flakes.md BUG-FLAKE-001。
export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    fileParallelism: false,
    coverage: {
      thresholds: {
        lines: 60,
        branches: 50,
        functions: 50,
      },
    },
  },
});
