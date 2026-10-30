/**
 * Shared model for the #751 P2 documentation pilot.
 *
 * This is the single allowlist of canonical repository documents that may be
 * rendered as reader-facing pages. Anything not listed here can only appear on
 * the site as a pinned GitHub permalink. The projection and the post-build
 * checks import this module so the allowlist cannot drift between them.
 */
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCS_SHA,
  DOCS_SHA_SHORT,
  PRODUCT_SHA,
  PRODUCT_SHA_SHORT,
} from "../shared/version.mjs";

export { DOCS_SHA, DOCS_SHA_SHORT, PRODUCT_SHA, PRODUCT_SHA_SHORT };

export const SITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(SITE_DIR, "..");
export const PAGES_DIR = join(SITE_DIR, "pages");
export const CONTENT_DIR = join(SITE_DIR, "content");
export const DIST_DIR = join(SITE_DIR, ".vitepress", "dist");

export const REPO_SLUG = "jnhu76/exam";

/**
 * Canonical source -> reader-facing route. Only these four files may be
 * projected. The zh-CN file is a distinct source, not a translated copy made
 * by this site.
 */
export const SOURCE_ROUTES = new Map([
  ["docs/product/standard-supported-capabilities.md", "/standard/capabilities"],
  [
    "docs/product/standard-supported-capabilities.zh-CN.md",
    "/zh/standard/capabilities",
  ],
  ["docs/guides/first-exam.md", "/guide/first-exam"],
  ["docs/guides/first-exam.zh-CN.md", "/zh/guide/first-exam"],
]);

/**
 * Projected pages. `section` is an inclusive heading-to-heading slice of the
 * canonical file; a missing heading is a build failure, not a silent skip.
 */
export const PROJECTIONS = [
  {
    source: "docs/product/standard-supported-capabilities.md",
    target: "standard/capabilities.md",
    route: "/standard/capabilities",
    locale: "en",
    title: "Standard Exam — Supported Capabilities & Guarantees",
    heading: null,
    section: null,
    description:
      "Version-bound projection of what the Standard product supports today, including explicit limits, save semantics, fault domains, and non-guarantees.",
    breadcrumb: [
      { text: "Home", link: "/" },
      { text: "Product reference" },
      { text: "Standard capabilities" },
    ],
    statusLegend: true,
    related: "/standard/capabilities",
  },
  {
    source: "docs/product/standard-supported-capabilities.zh-CN.md",
    target: "zh/standard/capabilities.md",
    route: "/zh/standard/capabilities",
    locale: "zh",
    title: "Standard Exam — 受支持能力与保证",
    heading: null,
    section: null,
    description:
      "版本绑定的 Standard 产品受支持能力投影，包含明确限制、保存语义、故障域与不保证项。",
    breadcrumb: [
      { text: "首页", link: "/zh/" },
      { text: "产品参考" },
      { text: "Standard 能力说明" },
    ],
    statusLegend: true,
    related: "/zh/standard/capabilities",
  },
  {
    source: "docs/guides/first-exam.md",
    target: "guide/first-exam.md",
    route: "/guide/first-exam",
    locale: "en",
    title: "First Exam Walkthrough (Admin)",
    heading: null,
    section: null,
    description:
      "Admin walkthrough for the first exam on a Standard deployment: install, first admin, exam creation, publish, enrollment, submission, grading, and results.",
    breadcrumb: [
      { text: "Home", link: "/" },
      { text: "Get started" },
      { text: "First exam walkthrough" },
    ],
    statusLegend: false,
    related: "/standard/capabilities",
  },
  {
    source: "docs/guides/first-exam.zh-CN.md",
    target: "zh/guide/first-exam.md",
    route: "/zh/guide/first-exam",
    locale: "zh",
    title: "首场考试操作指南（管理员）",
    heading: null,
    section: null,
    description:
      "Standard 部署上的首场考试管理员操作指南：安装、首个管理员、创建考试、发布、报名、交卷、评分与成绩公布。",
    breadcrumb: [
      { text: "首页", link: "/zh/" },
      { text: "开始使用" },
      { text: "首场考试指南" },
    ],
    statusLegend: false,
    related: "/zh/standard/capabilities",
  },
  {
    source: "docs/product/standard-supported-capabilities.md",
    target: "configure/exam-configuration.md",
    route: "/configure/exam-configuration",
    locale: "en",
    title: "Exam configuration",
    heading: "# Exam configuration",
    section: {
      start: "## 3. Exam lifecycle",
      end: "## 5. Answer save semantics",
    },
    description:
      "Exam lifecycle and admin configuration scope, projected from the canonical Standard capabilities page.",
    breadcrumb: [
      { text: "Home", link: "/" },
      { text: "Product reference" },
      { text: "Exam configuration" },
    ],
    statusLegend: false,
    related: "/standard/capabilities",
  },
  {
    source: "docs/product/standard-supported-capabilities.zh-CN.md",
    target: "zh/configure/exam-configuration.md",
    route: "/zh/configure/exam-configuration",
    locale: "zh",
    title: "考试配置",
    heading: "# 考试配置",
    section: { start: "## 3. 考试生命周期", end: "## 5. 答案保存语义" },
    description:
      "考试生命周期与 Admin 配置范围，投影自规范 Standard 能力说明页面。",
    breadcrumb: [
      { text: "首页", link: "/zh/" },
      { text: "产品参考" },
      { text: "考试配置" },
    ],
    statusLegend: false,
    related: "/zh/standard/capabilities",
  },
  {
    source: "docs/product/standard-supported-capabilities.md",
    target: "reliability.md",
    route: "/reliability",
    locale: "en",
    title: "Reliability & operations",
    heading: "# Reliability & operations",
    section: {
      start: "## 5. Answer save semantics",
      end: "## 8. Support & Evidence Matrix",
    },
    description:
      "Save semantics, recovery and fault domains, and explicit non-guarantees, projected from the canonical Standard capabilities page.",
    breadcrumb: [
      { text: "Home", link: "/" },
      { text: "Operations" },
      { text: "Reliability & operations" },
    ],
    statusLegend: false,
    related: "/standard/capabilities",
  },
  {
    source: "docs/product/standard-supported-capabilities.zh-CN.md",
    target: "zh/reliability.md",
    route: "/zh/reliability",
    locale: "zh",
    title: "可靠性与运维",
    heading: "# 可靠性与运维",
    section: { start: "## 5. 答案保存语义", end: "## 8. 支持与证据矩阵" },
    description:
      "保存语义、恢复与故障域以及明确不保证项，投影自规范 Standard 能力说明页面。",
    breadcrumb: [
      { text: "首页", link: "/zh/" },
      { text: "运维" },
      { text: "可靠性与运维" },
    ],
    statusLegend: false,
    related: "/zh/standard/capabilities",
  },
];

/** Route for a page path relative to the site content root. */
export function routeForPage(relativePath) {
  const withoutExtension = relativePath
    .split(sep)
    .join("/")
    .replace(/\.md$/, "");
  if (withoutExtension === "index") return "/";
  if (withoutExtension.endsWith("/index")) {
    return `/${withoutExtension.slice(0, -"/index".length)}/`;
  }
  return `/${withoutExtension}`;
}

/** Locale of a published route. */
export function localeForRoute(route) {
  return route === "/zh/" || route.startsWith("/zh/") ? "zh" : "en";
}

/** On-disk HTML path (relative to dist) for a clean URL route. */
export function htmlPathForRoute(route) {
  if (route.endsWith("/")) return `${route.slice(1)}index.html`;
  return `${route.slice(1)}.html`;
}

/** Repository-root-relative POSIX path. */
export function toRepoPath(absolutePath) {
  return relative(REPO_ROOT, absolutePath).split(sep).join("/");
}
