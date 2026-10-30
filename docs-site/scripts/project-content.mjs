#!/usr/bin/env node
/**
 * Build-time allowlist projection for the #751 P2 documentation pilot.
 *
 * OWNERSHIP: this script owns the only transformation from repository Markdown
 * into VitePress source. It never writes a second copy of a product fact: the
 * projected pages are regenerated on every build from the canonical files in
 * `docs/`, and the site-only pages under `docs-site/pages/` are navigation
 * only.
 *
 * INVARIANT (isolation): the VitePress source root is the generated
 * `docs-site/content/` directory. No other Markdown in the repository can be
 * compiled into the site, so `docs/archive/**`, `docs/research/**`, ADRs and
 * internal standards are unreachable unless this allowlist names them.
 *
 * PROTOCOL (links): relative links in a canonical document resolve to either
 * (a) another allowlisted document, rewritten to its site route with a
 * VitePress-compatible fragment, or (b) a GitHub permalink pinned to the
 * product-evidence commit. Anything else fails the build. Site-only pages may
 * link to absolute routes, fragments, external URLs, or `repo:<path>` links.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  CONTENT_DIR,
  DOCS_SHA,
  DOCS_SHA_SHORT,
  PAGES_DIR,
  PRODUCT_SHA,
  PRODUCT_SHA_SHORT,
  PROJECTIONS,
  REPO_ROOT,
  REPO_SLUG,
  SOURCE_ROUTES,
  routeForPage,
  toRepoPath,
} from "./site-model.mjs";

const LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const EXTERNAL_RE = /^(?:https?:|mailto:)/i;
const HEADING_RE = /^#{2,6}\s+(.+?)\s*$/gm;

/** GitHub-style heading anchor, as used by the canonical Markdown. */
function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/**
 * VitePress 1.6.4 heading anchor. Mirrors the VitePress slugify: NFKD, strip
 * combining and control characters, collapse special-character runs to `-`,
 * trim dashes, prefix a leading digit with `_`, lowercase. check-site.mjs
 * validates every rewritten fragment against the built HTML, so a VitePress
 * slug change breaks the build instead of producing silent deep-link rot.
 */
function vitepressSlug(heading) {
  return heading
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();
}

const headingCache = new Map();

function headingMaps(repoPath) {
  const cached = headingCache.get(repoPath);
  if (cached) return cached;
  const absolute = join(REPO_ROOT, repoPath);
  if (!existsSync(absolute)) {
    throw new Error(`projection source does not exist: ${repoPath}`);
  }
  const text = readFileSync(absolute, "utf8");
  const byGithubSlug = new Map();
  for (const match of text.matchAll(HEADING_RE)) {
    const heading = match[1];
    const github = githubSlug(heading);
    const vitepress = vitepressSlug(heading);
    const previous = byGithubSlug.get(github);
    if (previous !== undefined && previous !== vitepress) {
      throw new Error(
        `ambiguous heading anchor "${github}" in ${repoPath}: "${previous}" vs "${vitepress}"`,
      );
    }
    byGithubSlug.set(github, vitepress);
  }
  headingCache.set(repoPath, byGithubSlug);
  return byGithubSlug;
}

const gitTypeCache = new Map();
const gitShowCache = new Map();

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** Exact content of a path at a commit, for provenance equality checks. */
function gitShow(sha, repoPath) {
  const cacheKey = `${sha}:${repoPath}`;
  const cached = gitShowCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const text = execFileSync("git", ["show", `${sha}:${repoPath}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  gitShowCache.set(cacheKey, text);
  return text;
}

/**
 * Resolve a repository path to a GitHub blob/tree permalink.
 *
 * INVARIANT: the claimed commit and the checked object are the same. A path
 * absent from the pinned commit is a build failure — there is no fallback to
 * the moving checkout, because that would print a "pinned" URL for a path the
 * commit does not contain. CI checks out enough history for both SHAs.
 */
function repoUrl(repoPath, fragment, sha = PRODUCT_SHA) {
  const cacheKey = `${sha}:${repoPath}`;
  let type = gitTypeCache.get(cacheKey);
  if (!type) {
    try {
      type = execFileSync("git", ["cat-file", "-t", `${sha}:${repoPath}`], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      throw new Error(
        `link target does not exist at pinned commit ${sha}: ${repoPath} (canonical sources use the docs commit; other repository links use the product-evidence commit)`,
      );
    }
    if (type !== "blob" && type !== "tree") {
      throw new Error(`unexpected git object type "${type}" for ${repoPath}`);
    }
    gitTypeCache.set(cacheKey, type);
  }
  const suffix = fragment ? `#${fragment}` : "";
  return `https://github.com/${REPO_SLUG}/${type}/${sha}/${repoPath}${suffix}`;
}

function splitTarget(target) {
  const index = target.indexOf("#");
  if (index === -1) return { path: target, fragment: "" };
  return { path: target.slice(0, index), fragment: target.slice(index + 1) };
}

function resolveCanonicalTarget(repoPath, fragment) {
  const route = SOURCE_ROUTES.get(repoPath);
  if (!route) return null;
  if (!fragment) return route;
  const anchors = headingMaps(repoPath);
  const mapped = anchors.get(fragment);
  if (!mapped) {
    throw new Error(
      `fragment "#${fragment}" does not match any heading in ${repoPath}; update the canonical link or the projection`,
    );
  }
  return `${route}#${mapped}`;
}

function mapSamePageFragment(fragment, origin) {
  const mapped = headingMaps(origin).get(fragment);
  if (!mapped) {
    throw new Error(
      `same-page fragment "#${fragment}" does not match any heading in ${origin}`,
    );
  }
  return `#${mapped}`;
}

function rewriteTarget(target, context) {
  if (EXTERNAL_RE.test(target)) return target;
  if (target.startsWith("#")) {
    return context.kind === "canonical"
      ? mapSamePageFragment(target.slice(1), context.origin)
      : target;
  }
  if (target.startsWith("repo:")) {
    const { path, fragment } = splitTarget(target.slice("repo:".length));
    if (!path) throw new Error(`empty repo: link in ${context.origin}`);
    return repoUrl(path.replace(/^\/+/, ""), fragment, PRODUCT_SHA);
  }
  if (target.startsWith("/")) {
    if (context.kind === "site") return target;
    throw new Error(
      `canonical source ${context.origin} may not link to an absolute site route: ${target}`,
    );
  }
  if (context.kind === "site") {
    throw new Error(
      `site page ${context.origin} must use an absolute route, #fragment, https://, or repo:<path>; found relative link ${target}`,
    );
  }

  const { path, fragment } = splitTarget(target);
  const sourceAbsolute = join(REPO_ROOT, context.origin);
  const resolvedAbsolute = resolve(dirname(sourceAbsolute), path);
  const repoPath = toRepoPath(resolvedAbsolute);
  if (repoPath.startsWith("..")) {
    throw new Error(
      `link escapes the repository in ${context.origin}: ${target}`,
    );
  }
  if (!existsSync(resolvedAbsolute)) {
    throw new Error(
      `link target does not exist in the checkout: ${target} (from ${context.origin})`,
    );
  }
  const siteRoute = resolveCanonicalTarget(repoPath, fragment);
  return siteRoute ?? repoUrl(repoPath, fragment, PRODUCT_SHA);
}

function rewriteLinks(text, context) {
  return text.replace(LINK_RE, (full, label, target) => {
    const rewritten = rewriteTarget(target, context);
    return `[${label}](${rewritten})`;
  });
}

function sliceSection(text, section, origin) {
  if (!section) return `${text.trimEnd()}\n`;
  const start = text.indexOf(section.start);
  if (start === -1) {
    throw new Error(`missing section start "${section.start}" in ${origin}`);
  }
  const end = text.indexOf(section.end, start + section.start.length);
  if (end === -1) {
    throw new Error(`missing section end "${section.end}" in ${origin}`);
  }
  if (end <= start) {
    throw new Error(`section end precedes start in ${origin}`);
  }
  return `${text.slice(start, end).trimEnd()}\n`;
}

function yamlString(value) {
  return JSON.stringify(value);
}

function frontmatterFor(projection) {
  const lines = [
    "---",
    `title: ${yamlString(projection.title)}`,
    `description: ${yamlString(projection.description)}`,
    "outline: [2, 3]",
    "breadcrumb:",
  ];
  for (const crumb of projection.breadcrumb) {
    lines.push(`  - text: ${yamlString(crumb.text)}`);
    if (crumb.link) lines.push(`    link: ${yamlString(crumb.link)}`);
  }
  lines.push(
    `projectionSource: ${yamlString(projection.source)}`,
    `projectionSection: ${yamlString(
      projection.section
        ? `${projection.section.start} .. ${projection.section.end}`
        : "whole document",
    )}`,
    `projectionProductSha: ${yamlString(PRODUCT_SHA)}`,
    `projectionDocsSha: ${yamlString(DOCS_SHA)}`,
    "---",
    "",
  );
  return lines.join("\n");
}

function statusLegend(locale) {
  if (locale === "zh") {
    return [
      "> **状态标签（仅描述文档与证据状态，不是运行时 feature flag）：**",
      "",
      "| 标签 | 含义 |",
      "| --- | --- |",
      "| SUPPORTED | 当前、有证据支持的行为（在所列前提下）。 |",
      "| PARTIAL | 已实现，但存在明确缺口或较窄的证据边界。 |",
      "| DEFERRED | 已设计或已由契约冻结，但尚未启用。 |",
      "| NOT_SUPPORTED | 未实现；不得依赖。 |",
      "| NOT_VERIFIED | 证据不足，不能声称支持或失败。 |",
      "",
    ].join("\n");
  }
  return [
    "> **Status labels (documentation/evidence status only — not runtime feature flags):**",
    "",
    "| Label | Meaning |",
    "| --- | --- |",
    "| SUPPORTED | Current, evidenced behavior under the stated preconditions. |",
    "| PARTIAL | Implemented with an explicit gap or a narrower evidence boundary. |",
    "| DEFERRED | Designed or contract-frozen, but not activated. |",
    "| NOT_SUPPORTED | Not implemented; do not depend on it. |",
    "| NOT_VERIFIED | Evidence is insufficient to claim support or failure. |",
    "",
  ].join("\n");
}

function projectionNote(projection) {
  const sourceUrl = repoUrl(projection.source, "", DOCS_SHA);
  const section = projection.section
    ? `${projection.section.start.replace(/^##\s*/, "")} → ${projection.section.end.replace(/^##\s*/, "")}`
    : projection.locale === "zh"
      ? "整页"
      : "whole page";
  const parts = [];
  if (projection.locale === "zh") {
    parts.push(
      "> **投影页面 —— 构建时生成。**",
      `> 来源：[${projection.source}](${sourceUrl})（${section}），规范文档位于 docs 提交 \`${DOCS_SHA_SHORT}\`；产品事实绑定证据提交 \`${PRODUCT_SHA_SHORT}\`（\`v0.0.10\` 之后的开发版本）。`,
      "> 请修改规范文件，不要编辑本页；两者不一致时以规范页面为准。",
      "",
    );
    if (projection.section) {
      parts.push(
        `> 本页只投影规范页面的一部分。完整页面见 [Standard 能力说明](${projection.related})。`,
        "",
      );
    }
    if (projection.statusLegend) {
      parts.push(statusLegend("zh"));
    }
  } else {
    parts.push(
      "> **Projected page — generated at build time.**",
      `> Source: [${projection.source}](${sourceUrl}) (${section}), canonical document at docs commit \`${DOCS_SHA_SHORT}\`; product facts bound to evidence commit \`${PRODUCT_SHA_SHORT}\` (development state after \`v0.0.10\`).`,
      "> Edit the canonical file, not this page; if they disagree, the canonical page governs.",
      "",
    );
    if (projection.section) {
      parts.push(
        `> This page projects one part of the canonical page. Read the full page at [Standard capabilities](${projection.related}).`,
        "",
      );
    }
    if (projection.statusLegend) {
      parts.push(statusLegend("en"));
    }
  }
  return parts.join("\n");
}

async function walkMarkdown(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await walkMarkdown(target)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(target);
    }
  }
  return result;
}

async function main() {
  await rm(CONTENT_DIR, { recursive: true, force: true });
  await mkdir(CONTENT_DIR, { recursive: true });

  const manifest = {
    productSha: PRODUCT_SHA,
    docsSha: DOCS_SHA,
    pages: [],
  };
  const routeOwners = new Map();

  function registerRoute(route, owner) {
    const existing = routeOwners.get(route);
    if (existing) {
      throw new Error(
        `route ${route} is produced by both ${existing} and ${owner}`,
      );
    }
    routeOwners.set(route, owner);
  }

  for (const page of await walkMarkdown(PAGES_DIR)) {
    const relativePath = relative(PAGES_DIR, page).split(sep).join("/");
    const route = routeForPage(relativePath);
    registerRoute(route, `site page ${relativePath}`);
    const destination = join(CONTENT_DIR, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    const source = await readFile(page, "utf8");
    const rewritten = rewriteLinks(source, {
      kind: "site",
      origin: toRepoPath(page),
    });
    await writeFile(destination, rewritten);
    manifest.pages.push({
      file: relativePath,
      route,
      kind: "site",
      sourceSha256: sha256(source),
      contentSha256: sha256(rewritten),
    });
  }

  for (const projection of PROJECTIONS) {
    registerRoute(projection.route, `projection ${projection.source}`);
    const sourceText = await readFile(
      join(REPO_ROOT, projection.source),
      "utf8",
    );
    if (gitShow(DOCS_SHA, projection.source) !== sourceText) {
      throw new Error(
        `projection source ${projection.source} differs from docs commit ${DOCS_SHA}; commit the canonical change and update DOCS_SHA before rebuilding`,
      );
    }
    const sliced = sliceSection(
      sourceText,
      projection.section,
      projection.source,
    );
    const rewritten = rewriteLinks(sliced, {
      kind: "canonical",
      origin: projection.source,
    });
    const composed = [
      frontmatterFor(projection),
      projectionNote(projection),
      "---",
      "",
      projection.heading ? `${projection.heading}\n\n` : "",
      rewritten,
    ].join("\n");
    const destination = join(CONTENT_DIR, projection.target);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, composed);
    manifest.pages.push({
      file: projection.target,
      route: projection.route,
      kind: "projection",
      source: projection.source,
      locale: projection.locale,
      sourceSha256: sha256(sourceText),
      contentSha256: sha256(composed),
    });
  }

  await writeFile(
    join(CONTENT_DIR, ".manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const projections = manifest.pages.filter(
    (page) => page.kind === "projection",
  ).length;
  process.stdout.write(
    `Projected ${manifest.pages.length} pages (${projections} canonical projections) into ${relative(
      REPO_ROOT,
      CONTENT_DIR,
    )}/\n`,
  );
}

await main();
