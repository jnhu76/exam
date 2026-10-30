# Exam documentation portal — repo-only pilot (#751 P2)

Status: **bounded pilot, not published.** This directory builds a VitePress site from
an allowlisted subset of the repository Markdown. No GitHub Pages, Wiki, hosting,
domain, or telemetry is configured. The site is not part of the Exam product runtime.

## Authority model

```text
EXSEM / Accepted ADR / Contracts / SPEC / source + test evidence
                              |
                     reviewed product documents
                     (docs/product/, docs/guides/)
                              |
                    build-time allowlist projection
                    (docs-site/scripts/project-content.mjs)
                              |
                     reader-facing website (VitePress)
```

The website is **presentation**. It is not a semantic, permission, capability,
save-protocol, or reliability authority. Product support, capability, save,
recovery, and permission statements appear only in pages rendered from canonical
repository documents at pinned commits; site-authored pages add navigation and
context and do not state product facts of their own.

## Commands

```bash
pnpm docs:dev      # project canonical Markdown, then start the VitePress dev server
pnpm docs:build    # project, build, then run the link/route/search-scope checks
pnpm docs:preview  # serve the last build (run docs:build first)
```

These commands do not start PostgreSQL, Docker, or the Exam application. The only
new dependency is VitePress, pinned exactly in the root `devDependencies`.

- Generated source root: `docs-site/content/` (gitignored; recreated on every run).
- Build output: `docs-site/.vitepress/dist/` (gitignored).
- VitePress cache: `docs-site/.vitepress/cache/` (gitignored).

`pnpm docs:dev` re-projects at startup. If you edit a canonical file while the dev
server is running, re-run `node docs-site/scripts/project-content.mjs` and restart
(or restart `pnpm docs:dev`). There is intentionally no file watcher: a content
sync platform is out of scope for this pilot.

## Source allowlist

Only these canonical files are projected. Everything else can appear only as a
GitHub permalink pinned to the product-evidence commit.

| Canonical source | Published route | Locale | Transform needed | Link handling | Owner |
| --- | --- | --- | --- | --- | --- |
| `docs/product/standard-supported-capabilities.md` | `/standard/capabilities` | en | Whole document + generated frontmatter and projection note | Allowlisted links → site routes; fragments mapped to VitePress anchors; all other repo links → pinned GitHub permalink | `docs/product/` owner |
| `docs/product/standard-supported-capabilities.zh-CN.md` | `/zh/standard/capabilities` | zh | Whole document + generated frontmatter and projection note | Same as EN | `docs/product/` owner |
| `docs/product/standard-supported-capabilities.md` §3–§4 | `/configure/exam-configuration` | en | Section slice | Same as EN | `docs/product/` owner |
| `docs/product/standard-supported-capabilities.zh-CN.md` §3–§4 | `/zh/configure/exam-configuration` | zh | Section slice | Same as EN | `docs/product/` owner |
| `docs/product/standard-supported-capabilities.md` §5–§7 | `/reliability` | en | Section slice | Same as EN | `docs/product/` owner |
| `docs/product/standard-supported-capabilities.zh-CN.md` §5–§7 | `/zh/reliability` | zh | Section slice | Same as EN | `docs/product/` owner |
| `docs/guides/first-exam.md` | `/guide/first-exam` | en | Whole document + generated frontmatter and projection note | Same as EN | `docs/guides/` owner |
| `docs/guides/first-exam.zh-CN.md` | `/zh/guide/first-exam` | zh | Whole document + generated frontmatter and projection note | Same as EN | `docs/guides/` owner |

Site-authored navigation pages (no product-fact ownership):

| Page | Route | Locale |
| --- | --- | --- |
| `docs-site/pages/index.md` | `/` | en |
| `docs-site/pages/overview.md` | `/overview` | en |
| `docs-site/pages/developer.md` | `/developer` | en |
| `docs-site/pages/faq.md` | `/faq` | en |
| `docs-site/pages/zh/index.md` | `/zh/` | zh |
| `docs-site/pages/zh/overview.md` | `/zh/overview` | zh |
| `docs-site/pages/zh/developer.md` | `/zh/developer` | zh |
| `docs-site/pages/zh/faq.md` | `/zh/faq` | zh |

The allowlist itself lives in `docs-site/scripts/site-model.mjs`; the post-build
checker imports the same module, so the projection and the verification cannot
disagree about what is published.

## Excluded from the site

The following are **not** compiled. They remain reachable only through pinned
GitHub links where a product page cites them.

- `docs/archive/**`, `docs/research/**` — historical and research material.
- `docs/adr/**`, `docs/contracts/**`, `docs/architecture/**`, `docs/standards/**`,
  `docs/status/**`, `docs/deployment/**`, `docs/operations/**`, `docs/design/**`,
  `docs/development/**`, `docs/releases/**`, `docs/roadmap/**`, `docs/ui/**`,
  `docs/mock-data/**`, `docs/SPEC.md`, `docs/README.md`.
- Root `README*`, `INSTALL*`, `DESIGN.md`, `CONTRIBUTING.md`, `CHANGELOG.md`,
  `AGENTS.md`, and `formal/**`.

Because the VitePress source root is the generated `docs-site/content/` directory,
these paths are unreachable by construction, not by a deny-list that could be
bypassed. `check-site.mjs` additionally asserts that the built route set exactly
equals the manifest.

## Link rules

Canonical documents:

- A relative link to another allowlisted document becomes a site route.
- A heading fragment is mapped from the GitHub-style anchor used in the canonical
  Markdown to the VitePress anchor (for example `#5-answer-save-semantics` →
  `#_5-answer-save-semantics`). Same-page fragments are mapped the same way. An
  unmatched fragment fails the build.
- Any other relative repository link becomes a GitHub permalink. The link must
  exist at the commit it names: a missing path fails the build, and there is no
  fallback to the moving checkout.
- Absolute site paths and unknown link forms in canonical documents fail the build.

Site-authored pages:

- Allowed: absolute site routes (`/…`), same-page fragments (`#…`), `https://`,
  `mailto:`, and `repo:<path>` (expanded to a pinned permalink).
- Relative Markdown links are rejected so navigation cannot silently point at an
  unpublished file.

After the build, `check-site.mjs` re-checks every internal `<a href>` against the
built HTML, including heading fragments. It also verifies:

- the allowlist itself (`PROJECTIONS`, `SOURCE_ROUTES`, `PAGES_DIR`) is fully
  represented in the manifest and the manifest in the built route set;
- generated content still matches its manifest hash, and each projection still
  matches its canonical source hash;
- every page except the two home pages has exactly one `<h1>` and a specific
  `<title>`;
- each page's `<html lang>` matches its locale (`en` or `zh-CN`);
- English and Chinese route sets correspond, and every route is reachable from
  its locale home;
- the development-snapshot banner and the product-SHA meta tag are present;
- every repository permalink uses one of the two allowed commits and its path
  exists at that commit;
- the 404 page carries `lang`, `noindex`, and the product-SHA meta (its banner
  absence is a documented exemption, not a checked requirement);
- no `repo:` links or include markers remain;
- every search-index document belongs to the expected route set;
- the Chinese search index contains CJK terms (bigram tokenization is active).

## Typography

The site keeps one font strategy for both locales, chosen for the lowest
sustainable maintenance cost (`docs-site/.vitepress/theme/typography.css`):

- **Latin: the Inter variable font bundled with VitePress** (self-hosted
  unicode-range WOFF2 subsets, `font-display: swap`). A cold first view
  fetches ~68 KB on the wire (roman latin subset); the italic subset
  (~75 KB on disk) is only fetched by pages that contain italic Latin runs.
  No additional Latin font is packaged. The font is licensed SIL Open Font
  License 1.1 upstream and is distributed inside the VitePress package, so
  upgrades arrive with VitePress upgrades.
- **CJK: platform system fonts.** The family chain lists the platform CJK
  names (`PingFang SC`, `Hiragino Sans GB`, `Microsoft YaHei`,
  `Noto Sans CJK SC`, `Source Han Sans SC/CN`) **before** the generic
  `sans-serif`; otherwise a Linux fontconfig default (e.g. WenQuanYi) wins.
  Self-hosting Noto Sans SC / Source Han Sans was evaluated and rejected: the
  full WOFF2 kit is ~17 MB, sliced serving needs a ~100-file distribution
  pipeline, and no font build system or CDN is allowed for this repo-only LAN
  site.
- **Code: system monospace** (`ui-monospace` → Cascadia Mono/Consolas/Menlo…)
  with a CJK mono name before the generic, so Chinese comments inside code
  blocks get a monospaced CJK face where available.

On `zh` pages the default theme's local-only `Punctuation SC` font handles CJK
punctuation (full-width quotes, dashes, ellipsis); the theme's `:root` font
override must therefore keep the `:root:where(:lang(zh))` pattern instead of a
plain `:root` override, which would silently revert punctuation to Latin
metrics.

Reading rhythm tokens: text line-height 1.8 (prose, lists, quotes), heading
line-height 1.3, reading measure 760 px for the with-aside doc column, and
tabular digits in tables.

## Version binding and the two pinned commits

The pilot distinguishes two facts that must never be conflated:

| Constant | Commit | Meaning |
| --- | --- | --- |
| `PRODUCT_SHA` | `511e6e60` (2026-10-27) | The product-evidence commit the P1 product claims were verified against — a development state **after** the `v0.0.10` release tag (`5d005a58`). The site does not claim to describe the published `v0.0.10` contract. |
| `DOCS_SHA` | `41aa147c` | The commit that actually contains the canonical documents (the P1 documentation commit — a single-parent commit, not a merge). `docs/product/**` and `docs/guides/**` do not exist at `PRODUCT_SHA`. |

Both live in `docs-site/shared/version.mjs`, which the build scripts, config, and
banner import. The projection refuses to build when a canonical file in the
working tree differs from `DOCS_SHA`: commit the document change and update
`DOCS_SHA` before rebuilding. Source links use `DOCS_SHA`; every other
repository link uses `PRODUCT_SHA`, and the checker enforces this assignment per
link, not just the set of allowed commits. The static CI checkout uses
`fetch-depth: 20`
so `git cat-file` can verify both commits; the checker fails loudly if either is
missing or a linked path is absent.

When the product claims are re-bound to a newer commit, update `PRODUCT_SHA` and
re-check every claim in `docs/product/` and `docs/guides/`. When the canonical
documents change, commit them and update `DOCS_SHA`. The banner and footer read
the shared constant, so there is no second SHA to edit.

## Publication boundary

This is a repo-only pilot:

- No `gh-pages` branch, Pages workflow, Wiki, external hosting, DNS, or domain.
- No analytics, telemetry, accounts, comments, or feedback services.
- The generated site sends no requests to third-party services. VitePress local
  search is bundled, not a hosted index.
- The built HTML carries `noindex, nofollow`; this is defense in depth, not
  publication authorization.
- The repository is public. Repo-only does **not** mean private: the allowlist is
  the only content boundary.

Publication requires a separate owner decision and a new authorization. This
pilot provides no deployment target.

## Adding content

1. **Canonical product text:** edit `docs/product/` or `docs/guides/`, commit the
   change, then update `DOCS_SHA` in `docs-site/shared/version.mjs`. The
   projection refuses to build while the working tree differs from `DOCS_SHA`.
   Do not edit `docs-site/content/`; it is regenerated.
2. **Navigation/context page:** add a Markdown file under `docs-site/pages/`, with
   frontmatter (`title`, `description`, `breadcrumb`, optional `outline`). Use only
   the link forms listed above. It must stay navigation/context only.
3. **A new canonical projection:** add it to `PROJECTIONS` in
   `docs-site/scripts/site-model.mjs`, add the source to `SOURCE_ROUTES`, add the
   route to both sidebars and the relevant nav, and add it to the source-to-route
   table above. This is deliberately explicit: publishing a document is a reviewed
   decision, not a glob.
4. **A new section slice:** reference its exact heading strings. Missing or
   reordered headings fail the build (fail loud), rather than silently publishing
   a different section.

## Maintenance cost

- One root devDependency (VitePress 1.6.4) and a lockfile change.
- Two small Node scripts: the projection/allowlist and the post-build checker.
- A theme extension of three small Vue components plus two stylesheets
  (component chrome, and the typography system documented above).
- No duplicated product facts to maintain: product text is regenerated from the
  canonical files; site pages are navigation only.
- Recurring work: rebuild after canonical edits and inspect the generated files
  under `docs-site/content/`.

## Known limitations

- No real-user usability trial has been run. `USER_VALIDATION=NOT_RUN`.
- Browser/responsive checks are manual and must be re-run for visual changes.
- The pilot covers a bounded page set, not the whole documentation tree.
- `docs-site/content/` is generated and gitignored; reviewers must run
  `pnpm docs:build` to inspect the exact compiled output.
- `pnpm docs:dev` does not watch canonical `docs/` files (see above).
- Wide evidence tables scroll horizontally inside their own container under
  the native scrollbar. A decorative scroll affordance (edge fade or pinned
  first column) was evaluated and deliberately dropped: the default theme
  paints every row opaque, occluding any fade painted on the table, and
  `background-attachment` layer tricks proved unreliable in shipping Chrome.
- VitePress's minimal 404 page does not render the `layout-top` banner; it carries
  the product-SHA meta tag and `noindex` instead. The banner is required on all
  16 published content routes.
- The canonical `docs/guides/first-exam.zh-CN.md` contains one CommonMark
  delimiter run (`**…。**本指南`) that renders literally. The pilot projects the
  source verbatim rather than editing P1 content; fixing it is a follow-up
  canonical-document edit.
