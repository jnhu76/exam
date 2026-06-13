import { defineConfig } from "vitest/config";

// FIXME(BUG-FLAKE-001): packages/db 测试共享 exam_test PostgreSQL 实例。
// 与 apps/api 的修复同源：跨文件并行 + 共享 schema 在 turbo 多 package 并发
// 调度下会触发 demo-seed.test.ts 等重 I/O 用例 5s timeout
// （参见 docs/dev/test-flakes.md BUG-FLAKE-001）。
//
// 当前缓解：fileParallelism: false 让 packages/db 测试文件串行执行。
// 后续 B 方案（每 worker 独立 schema）落地后可恢复并行。
export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    fileParallelism: false,
  },
});
