#!/usr/bin/env node
/**
 * Post-build verification for the #751 P2 documentation pilot.
 *
 * This is the fail-loud gate behind `pnpm docs:build`. It checks the actual
 * built HTML and search indexes, not the intent of the projection script:
 *
 * - the project allowlist (PROJECTIONS / SOURCE_ROUTES / PAGES_DIR) is fully
 *   represented in the manifest and the built route set;
 * - generated content still matches the manifest hashes, and each projected
 *   page still matches its canonical source hash;
 * - source links are pinned to the docs commit and all other repository links
 *   to the product-evidence commit, and every pinned path exists there;
 * - every internal <a href> resolves to a built page, including its fragment;
 * - every page has one H1, a specific title, the right <html lang>, the
 *   development-snapshot banner, and the product-SHA meta tag;
 * - English and Chinese route sets correspond;
 * - every route is reachable from the home page;
 * - the 404 page carries lang, noindex, the product-SHA meta, and valid links;
 * - every search-index document belongs to the expected locale route set and
 *   the Chinese index contains CJK bigram terms.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CONTENT_DIR,
  DIST_DIR,
  DOCS_SHA,
  PAGES_DIR,
  PRODUCT_SHA,
  PRODUCT_SHA_SHORT,
  PROJECTIONS,
  REPO_ROOT,
  SOURCE_ROUTES,
  htmlPathForRoute,
  localeForRoute,
} from "./site-model.mjs";

const failures = [];
const checks = [];

// A PASS summary line is recorded only when no failure occurred since the
// section's mark, so a failed section can never print a PASS line for itself.
function passIfClean(mark, message) {
  if (failures.length === mark) {
    checks.push(`PASS ${message}`);
  }
}

function fail(message) {
  failures.push(message);
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeRoute(route) {
  if (route === "/") return "/";
  return route.replace(/\/$/, "");
}

function counterpartRoute(route) {
  if (route === "/") return "/zh/";
  if (route === "/zh/") return "/";
  if (route.startsWith("/zh/")) return route.slice(3);
  return `/zh${route}`;
}

async function walkFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await walkFiles(target)));
    } else if (entry.isFile()) {
      result.push(target);
    }
  }
  return result;
}

function routeFromHtml(relativePath) {
  const normalized = relativePath.split(sep).join("/");
  if (normalized === "404.html") return null;
  if (normalized === "index.html") return "/";
  if (normalized.endsWith("/index.html")) {
    return `/${normalized.slice(0, -"index.html".length)}`;
  }
  return `/${normalized.slice(0, -".html".length)}`;
}

function extractAttribute(html, attribute) {
  const values = [];
  for (const match of html.matchAll(
    new RegExp(`${attribute}="([^"]*)"`, "g"),
  )) {
    values.push(match[1]);
  }
  return values;
}

/** Only real anchors are navigation; <link>/<script> assets are not pages. */
function extractAnchorHrefs(html) {
  const values = [];
  for (const match of html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)) {
    values.push(match[1]);
  }
  return values;
}

function decodeFragment(fragment) {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

const gitTypeCache = new Map();

/** Object type of a repository path at a commit; fails loudly if absent. */
function pinnedObjectType(sha, repoPath) {
  const key = `${sha}:${repoPath}`;
  if (gitTypeCache.has(key)) return gitTypeCache.get(key);
  let type;
  try {
    type = execFileSync("git", ["cat-file", "-t", `${sha}:${repoPath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    fail(`pinned path is absent at ${sha}: ${repoPath}`);
    type = null;
  }
  gitTypeCache.set(key, type);
  return type;
}

async function readIfExists(path) {
  return existsSync(path) ? readFile(path, "utf8") : null;
}

async function main() {
  const manifestPath = join(CONTENT_DIR, ".manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `missing ${manifestPath}; run docs-site/scripts/project-content.mjs before the build`,
    );
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (!existsSync(DIST_DIR)) {
    throw new Error(
      `missing build output ${DIST_DIR}; run vitepress build docs-site`,
    );
  }

  // 1. Manifest identity and allowlist completeness.
  const allowlistMark = failures.length;
  if (manifest.productSha !== PRODUCT_SHA) {
    fail(`manifest productSha ${manifest.productSha} != ${PRODUCT_SHA}`);
  }
  if (manifest.docsSha !== DOCS_SHA) {
    fail(`manifest docsSha ${manifest.docsSha} != ${DOCS_SHA}`);
  }

  const projectionPages = manifest.pages.filter(
    (page) => page.kind === "projection",
  );
  if (projectionPages.length !== PROJECTIONS.length) {
    fail(
      `manifest has ${projectionPages.length} projections, allowlist has ${PROJECTIONS.length}`,
    );
  }
  for (const projection of PROJECTIONS) {
    const found = projectionPages.find(
      (page) =>
        page.source === projection.source &&
        page.file === projection.target &&
        page.route === projection.route &&
        page.locale === projection.locale,
    );
    if (!found) {
      fail(
        `allowlisted projection is missing from the manifest: ${projection.source} -> ${projection.route}`,
      );
    }
    // SOURCE_ROUTES is the canonical link target (the whole-document route).
    // Section slices project the same source at additional routes.
    if (
      projection.section === null &&
      SOURCE_ROUTES.get(projection.source) !== projection.route
    ) {
      fail(
        `whole-document route mismatch for ${projection.source}: ${SOURCE_ROUTES.get(projection.source)} vs ${projection.route}`,
      );
    }
  }
  for (const [source, route] of SOURCE_ROUTES) {
    const fullDocument = PROJECTIONS.some(
      (projection) =>
        projection.source === source &&
        projection.section === null &&
        projection.route === route,
    );
    if (!fullDocument) {
      fail(
        `SOURCE_ROUTES entry has no whole-document projection: ${source} -> ${route}`,
      );
    }
  }
  if (SOURCE_ROUTES.size !== new Set(PROJECTIONS.map((p) => p.source)).size) {
    fail(
      "SOURCE_ROUTES contains a source that is not projected (canonical links would silently become permalinks)",
    );
  }

  const sitePageFiles = (await walkFiles(PAGES_DIR))
    .map((file) => relative(PAGES_DIR, file).split(sep).join("/"))
    .filter((file) => file.endsWith(".md"))
    .sort();
  const manifestSitePages = manifest.pages
    .filter((page) => page.kind === "site")
    .map((page) => page.file)
    .sort();
  if (JSON.stringify(sitePageFiles) !== JSON.stringify(manifestSitePages)) {
    fail(
      `site page set mismatch: pages/=${JSON.stringify(sitePageFiles)} manifest=${JSON.stringify(manifestSitePages)}`,
    );
  }
  if (manifest.pages.length !== PROJECTIONS.length + sitePageFiles.length) {
    fail(
      `manifest page count ${manifest.pages.length} != projections ${PROJECTIONS.length} + site pages ${sitePageFiles.length}`,
    );
  }
  passIfClean(
    allowlistMark,
    `allowlist completeness verified (${PROJECTIONS.length} projections, ${sitePageFiles.length} site pages)`,
  );

  // 2. Generated-content and source hashes.
  const hashMark = failures.length;
  for (const page of manifest.pages) {
    const generated = await readFile(join(CONTENT_DIR, page.file), "utf8");
    if (sha256(generated) !== page.contentSha256) {
      fail(`generated content changed after projection: ${page.file}`);
    }
    const sourcePath =
      page.kind === "site"
        ? join(PAGES_DIR, page.file)
        : join(REPO_ROOT, page.source);
    const source = await readFile(sourcePath, "utf8");
    if (sha256(source) !== page.sourceSha256) {
      fail(
        `canonical source changed after projection: ${page.source ?? page.file}`,
      );
    }
    if (page.kind === "projection") {
      if (
        !generated.includes(
          `projectionProductSha: ${JSON.stringify(PRODUCT_SHA)}`,
        )
      ) {
        fail(`projection product SHA frontmatter mismatch: ${page.file}`);
      }
      if (
        !generated.includes(`projectionDocsSha: ${JSON.stringify(DOCS_SHA)}`)
      ) {
        fail(`projection docs SHA frontmatter mismatch: ${page.file}`);
      }
      if (
        !generated.includes(
          `https://github.com/jnhu76/exam/blob/${DOCS_SHA}/${page.source}`,
        )
      ) {
        fail(
          `projection source link is not pinned to docs commit ${DOCS_SHA}: ${page.file}`,
        );
      }
    }
  }
  passIfClean(
    hashMark,
    `content and source hashes verified for ${manifest.pages.length} pages`,
  );

  // 3. Built route set must equal the manifest route set.
  const routeSetMark = failures.length;
  const expectedRoutes = new Map();
  for (const page of manifest.pages) {
    expectedRoutes.set(normalizeRoute(page.route), page.route);
  }
  const actualRoutes = new Map();
  for (const file of await walkFiles(DIST_DIR)) {
    if (!file.endsWith(".html")) continue;
    const route = routeFromHtml(relative(DIST_DIR, file));
    if (route === null) continue;
    actualRoutes.set(normalizeRoute(route), route);
  }
  for (const [normalized, route] of expectedRoutes) {
    if (!actualRoutes.has(normalized)) {
      fail(`expected route is missing from the build: ${route}`);
    }
  }
  for (const [normalized, route] of actualRoutes) {
    if (!expectedRoutes.has(normalized)) {
      fail(`unexpected route in the build (not allowlisted): ${route}`);
    }
  }
  passIfClean(
    routeSetMark,
    `built route set equals the manifest (${expectedRoutes.size} routes)`,
  );

  // 4. English/Chinese parity.
  const parityMark = failures.length;
  for (const [, route] of expectedRoutes) {
    const other = counterpartRoute(route);
    if (!expectedRoutes.has(normalizeRoute(other))) {
      fail(`missing locale counterpart for ${route}: ${other}`);
    }
  }
  passIfClean(parityMark, "English and Chinese route sets correspond");

  // 5. Per-page HTML checks and the internal link graph.
  const linkMark = failures.length;
  const pageCache = new Map();
  async function loadPage(route) {
    const cached = pageCache.get(route);
    if (cached) return cached;
    const file = join(DIST_DIR, htmlPathForRoute(route));
    if (!existsSync(file)) return null;
    const html = await readFile(file, "utf8");
    const ids = new Set(extractAttribute(html, "id"));
    const language = /<html[^>]*\blang="([^"]+)"/.exec(html)?.[1];
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
    const h1Count = (html.match(/<h1\b/g) ?? []).length;
    const record = { html, ids, language, title, h1Count };
    pageCache.set(route, record);
    return record;
  }

  const edges = new Map();
  let linkCount = 0;
  for (const [normalized, route] of expectedRoutes) {
    const page = await loadPage(route);
    if (!page) {
      fail(`cannot load built page for route: ${route}`);
      continue;
    }
    const locale = localeForRoute(route);
    const expectedLang = locale === "zh" ? "zh-CN" : "en";
    if (page.language !== expectedLang) {
      fail(
        `wrong <html lang> on ${route}: expected ${expectedLang}, got ${page.language ?? "(none)"}`,
      );
    }
    const siteTitle = locale === "zh" ? "Exam 文档" : "Exam Documentation";
    if (page.h1Count !== 1) {
      fail(`expected exactly one <h1> on ${route}, found ${page.h1Count}`);
    }
    if (route === "/" || route === "/zh/") {
      if (page.title !== siteTitle) {
        fail(
          `home title should be "${siteTitle}" on ${route}, got "${page.title}"`,
        );
      }
    } else if (page.title === siteTitle || !page.title) {
      fail(
        `page title is not specific on ${route}: "${page.title ?? "(none)"}"`,
      );
    }
    for (const meta of page.html.matchAll(
      /<meta name="exam-docs-product-sha" content="([^"]+)"/g,
    )) {
      if (meta[1] !== PRODUCT_SHA) {
        fail(`product-SHA meta mismatch on ${route}: ${meta[1]}`);
      }
    }
    if (!page.html.includes('name="exam-docs-product-sha"')) {
      fail(`missing product-SHA meta tag on ${route}`);
    }
    if (!page.html.includes('class="exam-snapshot"')) {
      fail(`development-snapshot banner missing on ${route}`);
    }
    if (!page.html.includes(PRODUCT_SHA_SHORT)) {
      fail(
        `banner/footer does not show product SHA ${PRODUCT_SHA_SHORT} on ${route}`,
      );
    }
    if (page.html.includes("repo:")) {
      fail(`unexpanded repo: link left in ${route}`);
    }
    if (page.html.includes("<!--@include") || page.html.includes("@include:")) {
      fail(`Markdown include marker leaked into ${route}`);
    }

    const pageEdges = new Set();
    for (const href of extractAnchorHrefs(page.html)) {
      if (!href || href.startsWith("#")) {
        if (href && href.startsWith("#")) {
          const fragment = decodeFragment(href.slice(1));
          if (fragment && !page.ids.has(fragment)) {
            fail(`same-page fragment not found: ${route}${href}`);
          }
        }
        continue;
      }
      if (/^(?:https?:|mailto:|tel:)/i.test(href)) continue;
      const [pathPart, fragmentPart] = href.split("#");
      if (!pathPart.startsWith("/")) {
        if (
          /\.(?:css|js|mjs|json|xml|txt|woff2?|ttf|otf|png|jpe?g|gif|svg|ico|webp|map)$/i.test(
            pathPart,
          )
        ) {
          continue;
        }
        fail(`relative link found in ${route}: ${href}`);
        continue;
      }
      const targetFile = pathPart.split("?")[0];
      const normalizedTarget = normalizeRoute(targetFile);
      const target = expectedRoutes.get(normalizedTarget);
      linkCount += 1;
      if (!target) {
        fail(`internal link target is not a built route: ${route} -> ${href}`);
        continue;
      }
      pageEdges.add(normalizedTarget);
      if (fragmentPart) {
        const targetPage = await loadPage(target);
        if (!targetPage) {
          fail(`cannot load fragment target page: ${route} -> ${href}`);
          continue;
        }
        const fragment = decodeFragment(fragmentPart);
        if (!targetPage.ids.has(fragment)) {
          fail(`fragment not found: ${route} -> ${href}`);
        }
      }
    }
    edges.set(normalized, pageEdges);
  }
  passIfClean(
    linkMark,
    `internal links and fragments resolve (${linkCount} links checked)`,
  );

  // 6. Every route must be reachable from its own locale home. The BFS runs
  // once per locale so a cross-locale edge cannot mask a same-locale page that
  // has no in-locale path. The language switcher is client-rendered and is not
  // a static cross-locale anchor in the built HTML.
  const reachMark = failures.length;
  for (const [home, locale] of [
    ["/", "en"],
    ["/zh/", "zh"],
  ]) {
    const start = normalizeRoute(home);
    const visited = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of edges.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    for (const [normalized, route] of expectedRoutes) {
      if (localeForRoute(route) !== locale) continue;
      if (!visited.has(normalized)) {
        fail(`route is unreachable from the ${locale} home: ${route}`);
      }
    }
  }
  passIfClean(
    reachMark,
    `all ${expectedRoutes.size} routes are reachable from their locale home`,
  );

  // 7. Repository permalinks: canonical source paths must pin the docs commit,
  // every other path must pin the product commit, and each path must exist at
  // the commit it pins.
  const permalinkMark = failures.length;
  const sourcePaths = new Set(
    PROJECTIONS.map((projection) => projection.source),
  );
  const permalinkRe =
    /https:\/\/github\.com\/jnhu76\/exam\/(?:blob|tree)\/([0-9a-f]{40})\/([^"#?\s)]+)/g;
  let permalinkCount = 0;
  for (const [route, page] of pageCache) {
    for (const match of page.html.matchAll(permalinkRe)) {
      const [, sha, rawPath] = match;
      permalinkCount += 1;
      const repoPath = rawPath.replace(/\/+$/, "");
      const expectedSha = sourcePaths.has(repoPath) ? DOCS_SHA : PRODUCT_SHA;
      if (sha !== expectedSha) {
        fail(
          `permalink on ${route} pins ${sha.slice(0, 8)} but ${repoPath} must pin ${expectedSha.slice(0, 8)}`,
        );
      }
      pinnedObjectType(sha, repoPath);
    }
  }
  passIfClean(
    permalinkMark,
    `repository permalinks pinned to allowed commits (${permalinkCount} links)`,
  );

  // 8. 404 page: lang, noindex, product-SHA meta, and any internal links.
  //
  // INTENTIONAL: VitePress's minimal 404 surface does not render the
  // layout-top slot, so the banner is absent there. It still carries the
  // product-SHA meta and noindex; the banner requirement applies to the 16
  // published content routes.
  const notFoundMark = failures.length;
  const notFound = await readIfExists(join(DIST_DIR, "404.html"));
  if (!notFound) {
    fail("missing dist/404.html");
  } else {
    if (!/<html[^>]*\blang="en"/.test(notFound)) {
      fail("404 page has the wrong lang attribute");
    }
    if (!/name="robots"\s+content="noindex, nofollow"/.test(notFound)) {
      fail("404 page is missing noindex, nofollow");
    }
    if (!notFound.includes('name="exam-docs-product-sha"')) {
      fail("404 page is missing the product-SHA meta tag");
    }
    for (const href of extractAnchorHrefs(notFound)) {
      if (!href || href.startsWith("#")) continue;
      if (/^(?:https?:|mailto:|tel:)/i.test(href)) continue;
      if (!href.startsWith("/")) continue;
      const [pathPart] = href.split("#");
      if (!expectedRoutes.has(normalizeRoute(pathPart.split("?")[0]))) {
        fail(`404 page links to a non-published route: ${href}`);
      }
    }
    passIfClean(
      notFoundMark,
      "404 page lang, noindex, product-SHA meta, and links verified",
    );
  }

  // 9. Search index locale scope and CJK tokenization.
  const chunkDir = join(DIST_DIR, "assets", "chunks");
  if (!existsSync(chunkDir)) {
    fail("missing dist/assets/chunks; local search index not generated");
  } else {
    const chunks = (await readdir(chunkDir)).filter((name) =>
      name.startsWith("@localSearchIndex"),
    );
    for (const localeKey of ["root", "zh"]) {
      const searchMark = failures.length;
      const chunk = chunks.find((name) =>
        name.startsWith(`@localSearchIndex${localeKey}.`),
      );
      if (!chunk) {
        fail(`missing local search index chunk for locale ${localeKey}`);
        continue;
      }
      const module = await import(pathToFileURL(join(chunkDir, chunk)).href);
      const index = JSON.parse(module.default);
      const ids = Object.values(index.documentIds ?? {});
      if (index.documentCount !== ids.length) {
        fail(
          `search index ${localeKey}: documentCount ${index.documentCount} != ids ${ids.length}`,
        );
      }
      const expectedLocale = localeKey === "root" ? "en" : "zh";
      const seen = new Set();
      for (const id of ids) {
        const base = normalizeRoute(id.split("#")[0]);
        const route = expectedRoutes.get(base);
        if (!route) {
          fail(
            `search index ${localeKey} contains a non-allowlisted page: ${id}`,
          );
          continue;
        }
        if (localeForRoute(route) !== expectedLocale) {
          fail(
            `search index ${localeKey} contains a page from another locale: ${id}`,
          );
        }
        seen.add(base);
      }
      for (const [normalized, route] of expectedRoutes) {
        if (localeForRoute(route) !== expectedLocale) continue;
        if (!seen.has(normalized)) {
          fail(
            `search index ${localeKey} is missing a published page: ${route}`,
          );
        }
      }
      if (localeKey === "zh") {
        const serialized = JSON.stringify(index);
        for (const term of ["答案", "保存", "恢复"]) {
          if (!serialized.includes(JSON.stringify(term))) {
            fail(
              `zh search index has no CJK term "${term}" (tokenizer did not run)`,
            );
          }
        }
      }
      passIfClean(
        searchMark,
        `search index ${localeKey}: ${ids.length} documents, locale scope and terms verified`,
      );
    }
  }

  for (const line of checks) process.stdout.write(`${line}\n`);
  if (failures.length > 0) {
    process.stderr.write(
      `\n${failures.length} documentation check(s) failed:\n`,
    );
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("All documentation checks passed.\n");
}

await main();
