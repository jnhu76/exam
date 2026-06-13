import { defineConfig } from "vitest/config";

// FIXME(BUG-FLAKE-001): apps/api 跨文件并行 + 共享 PostgreSQL schema + coverage
// instrumentation 会造成 attempts.test.ts:1070 后台扫描用例在 pnpm verify 路径下
// 偶发 5s timeout（已升级条目，见 docs/dev/test-flakes.md）。
//
// 当前缓解：fileParallelism: false 让所有 apps/api 测试文件串行执行，
// 从源头消除跨文件 DB 资源争用。代价：apps/api test/coverage 时间约翻倍。
//
// 后续根因修复（B 方案）：每测试文件 / 每 worker 独立 PostgreSQL schema
// （SET search_path），从源头解除共享状态约束，再恢复并行。
//
// 不要在恢复并行前移除此配置。
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
