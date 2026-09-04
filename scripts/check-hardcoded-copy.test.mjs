/**
 * Regression tests for scripts/check-hardcoded-copy.mjs.
 *
 * Each case builds a minimal fixture repo in a temp directory, runs the
 * guard with that directory as cwd, and asserts the exit code and report.
 * This pins the guard's contract (what must fail, what must stay legal)
 * without touching real source files.
 *
 * Run: node --test scripts/check-hardcoded-copy.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-hardcoded-copy.mjs",
);

/**
 * Runs the guard against a fixture repo. `files` maps repo-relative paths
 * to contents; everything else about the fixture root is empty.
 */
function runGuard(files) {
  const root = mkdtempSync(join(tmpdir(), "copy-guard-fixture-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    const res = spawnSync(process.execPath, [GUARD], {
      cwd: root,
      encoding: "utf-8",
    });
    return {
      code: res.status,
      output: `${res.stdout ?? ""}${res.stderr ?? ""}`,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("T1: illegal CJK in a web page fails", () => {
  const r = runGuard({
    "apps/web/src/pages/Foo.tsx": `export function Foo() {\n  return <Button>违规中文</Button>;\n}\n`,
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /apps\/web\/src\/pages\/Foo\.tsx:2/);
});

test("T2: illegal CJK in an api route fails", () => {
  const r = runGuard({
    "apps/api/src/routes/foo.ts": `export const illegal = "违规中文";\n`,
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /apps\/api\/src\/routes\/foo\.ts:1/);
});

test("T3: packages production source is scanned (blind spot closed)", () => {
  const r = runGuard({
    "packages/contracts/src/__illegal.ts": `export const x = "违规中文";\n`,
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /packages\/contracts\/src\/__illegal\.ts:1/);
});

test("T4: contracts server compatibility catalog passes by exact authority", () => {
  const r = runGuard({
    "packages/contracts/src/messageRegistry.ts": `export const fallback = "内部错误，请稍后重试";\n`,
  });
  assert.equal(r.code, 0);
});

test("T4b: the catalog privilege does not extend to sibling package files", () => {
  const r = runGuard({
    "packages/contracts/src/messageRegistry.ts": `export const fallback = "内部错误";\n`,
    "packages/contracts/src/otherCatalog.ts": `export const copy = "不能继承catalog特权";\n`,
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /otherCatalog\.ts:1/);
});

test("T5: web locale catalog passes", () => {
  const r = runGuard({
    "apps/web/src/i18n/locales/zh-CN.ts": `export default { "common.save": "保存" };\n`,
  });
  assert.equal(r.code, 0);
});

test("T6: narrow wire-compat suppression allows one literal, not the file", () => {
  const suppressed = {
    "apps/api/src/routes/foo.ts":
      `export const view = {\n` +
      `  // i18n-copy-allow: wire-compat — legacy natural-language status reason; machine code is the contract\n` +
      `  scoreViewDisabledReason: "已取消的考试不提供成绩",\n` +
      `};\n`,
  };
  assert.equal(runGuard(suppressed).code, 0);

  const abuse = {
    "apps/api/src/routes/foo.ts":
      `export const view = {\n` +
      `  // i18n-copy-allow: wire-compat — legacy natural-language status reason; machine code is the contract\n` +
      `  scoreViewDisabledReason: "已取消的考试不提供成绩",\n` +
      `  other: "未声明的新文案",\n` +
      `};\n`,
  };
  const r = runGuard(abuse);
  assert.equal(r.code, 1);
  assert.match(r.output, /foo\.ts:4/);
});

test("T7: data-format suppression covers the CSV literal only", () => {
  const ok = runGuard({
    "apps/api/src/routes/foo.ts":
      `export const headers = [\n` +
      `  // i18n-copy-allow: data-format — CSV export header data contract\n` +
      `  "考生姓名",\n` +
      `];\n`,
  });
  assert.equal(ok.code, 0);

  const r = runGuard({
    "apps/api/src/routes/foo.ts":
      `export const headers = [\n` +
      `  // i18n-copy-allow: data-format — CSV export header data contract\n` +
      `  "考生姓名",\n` +
      `];\n` +
      `export const ui = "保存失败";\n`,
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /foo\.ts:5/);
});

test("T8: server-rendered suppression covers Email literals only", () => {
  const ok = runGuard({
    "apps/api/src/emails/foo.ts":
      `export const subject =\n` +
      `  // i18n-copy-allow: server-rendered — Email copy rendered server-side; independent localization boundary\n` +
      `  "考试结果已发布";\n`,
  });
  assert.equal(ok.code, 0);

  const r = runGuard({
    "apps/api/src/emails/foo.ts":
      `export const subject =\n` +
      `  // i18n-copy-allow: server-rendered — Email copy rendered server-side; independent localization boundary\n` +
      `  "考试结果已发布";\n` +
      `export const toast = "操作成功";\n`,
  });
  assert.equal(r.code, 1);
});

test("T9: developer-diagnostic suppression covers discarded thrown messages only", () => {
  const ok = runGuard({
    "apps/api/src/routes/foo.ts":
      `export function boom() {\n` +
      `  // i18n-copy-allow: developer-diagnostic — thrown message discarded; the error handler serializes the code only\n` +
      `  throw new ValidationError("课程代码不能为空");\n` +
      `}\n`,
  });
  assert.equal(ok.code, 0);

  const r = runGuard({
    "apps/api/src/routes/foo.ts":
      `export function boom() {\n` +
      `  // i18n-copy-allow: developer-diagnostic — thrown message discarded; the error handler serializes the code only\n` +
      `  throw new ValidationError("课程代码不能为空");\n` +
      `}\n` +
      `export const onWire = "这条会上wire";\n`,
  });
  assert.equal(r.code, 1);
});

test("T10: Chinese comments pass", () => {
  const r = runGuard({
    "apps/api/src/routes/foo.ts": `// 这里解释为什么使用这个状态机\n/* 多行中文\n   注释也可以 */\nexport const x = 1;\n`,
  });
  assert.equal(r.code, 0);
});

test("T11: `//` inside a string is not treated as a comment (stripComments hole closed)", () => {
  const r = runGuard({
    "apps/api/src/routes/foo.ts": `export const x = "foo//违规中文";\n`,
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /foo\.ts:1/);
});

test("T12: template literal CJK fails", () => {
  const r = runGuard({
    "apps/api/src/routes/foo.ts": "export const x = `违规中文`;\n",
  });
  assert.equal(r.code, 1);
});

test("T13: interpolated template literal CJK fails", () => {
  const r = runGuard({
    "apps/api/src/routes/foo.ts":
      "export const f = (n) => `hello ${n} 中文`;\n",
  });
  assert.equal(r.code, 1);
});

test("T14: JSX text CJK fails", () => {
  const r = runGuard({
    "apps/web/src/pages/Bar.tsx": `export function Bar() {\n  return <div>违规中文</div>;\n}\n`,
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /Bar\.tsx:2/);
});

test("T15: the testHelpers filename is not magic — production-tree file still scanned", () => {
  const r = runGuard({
    "apps/api/src/foo.testHelpers.ts": `export const fixture = "安全出口标识的颜色是____色";\n`,
  });
  assert.equal(r.code, 1);
});

test("T16: genuine test files are excluded", () => {
  const r = runGuard({
    "apps/api/src/routes/foo.test.ts": `test("中文", () => {\n  expect(x).toBe("考生姓名");\n});\n`,
    "apps/api/src/routes/__tests__/helpers.ts": `export const fixture = "题目内容";\n`,
  });
  assert.equal(r.code, 0);
});

test("T17: Tier1 forbidden deployment terms still fire", () => {
  const r = runGuard({
    "apps/api/src/routes/foo.ts": `export const label = "大学教务处";\n`,
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /Hardcoded deployment-specific copy/);
  assert.match(r.output, /大学/);
});

test("T18: unknown suppression category fails", () => {
  const r = runGuard({
    "apps/api/src/routes/foo.ts": `// i18n-copy-allow: because-i-said-so — some reason\nexport const x = "违规中文";\n`,
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /unknown category/);
});

test("T19: suppression without a reason fails", () => {
  const r = runGuard({
    "apps/api/src/routes/foo.ts": `// i18n-copy-allow: wire-compat\nexport const x = "违规中文";\n`,
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /has no reason/);
});

test("T20: malformed directive fails and does not suppress", () => {
  const r = runGuard({
    "apps/api/src/routes/foo.ts": `// i18n-copy-allow wire-compat no colon\nexport const x = "违规中文";\n`,
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /malformed directive/);
  assert.match(r.output, /违规中文|foo\.ts:2/);
});

test("T21: stale directive (no literal below) fails", () => {
  const r = runGuard({
    "apps/api/src/routes/foo.ts": `// i18n-copy-allow: wire-compat — leftover exemption\nexport const x = "only ascii";\n`,
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /stale-suppression|no CJK literal/);
});

test("T22: trailing directive on the literal's own line works; gap breaks it", () => {
  const ok = runGuard({
    "apps/api/src/routes/foo.ts": `export const x = "兼容文案"; // i18n-copy-allow: wire-compat — field message compat\n`,
  });
  assert.equal(ok.code, 0);

  const gap = runGuard({
    "apps/api/src/routes/foo.ts": `// i18n-copy-allow: wire-compat — field message compat\n\nexport const x = "兼容文案";\n`,
  });
  assert.equal(gap.code, 1);
});

test("T23: a testHelpers/ directory is test-only; its contents pass", () => {
  const r = runGuard({
    "packages/db/src/testHelpers/buildX.ts": `export const row = "考生姓名";\n`,
  });
  assert.equal(r.code, 0);
});

test("T24: multiline template literal is one semantic unit", () => {
  const ok = runGuard({
    "apps/api/src/emails/foo.ts":
      `export const body =\n` +
      `  // i18n-copy-allow: server-rendered — one Email body template, one unit\n` +
      `  \`\n第一行中文\n第二行 \${name} 中文\`;\n`,
  });
  assert.equal(ok.code, 0);
});
