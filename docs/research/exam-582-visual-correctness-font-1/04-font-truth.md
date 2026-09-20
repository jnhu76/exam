# 04 — Font Truth Audit

Question answered: **does the runtime really render HarmonyOS Sans SC, or does it silently fall back?**

## Declared truth

`apps/web/src/index.css` freezes the primary UI family (issue 577 M1):

```css
--font-ui: "HarmonyOS Sans SC", "Noto Sans CJK SC", "Noto Sans SC",
  "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
```

Self-hosted via `index.html`: `/fonts/harmonyos-sans-sc/{Regular,Medium,Bold}.css` — 82 unicode-range woff2 subsets per weight (cn-font-split), `font-display: swap`, `src: local(...) first, then url(...)`.

## Evidence

### 1. Computed style (every capture; `artifacts/computed-style.json`)

- One single resolved stack in 30/30 captures — `html` and `body` both compute to `"HarmonyOS Sans SC", "Noto Sans CJK SC", ...` with no override anywhere.
- Per-element computed `font-family` on every probed target (page headings, table `th`/`td`, inputs, buttons, status badges, tag badges, sidebar links, dialog title/body/input/button, candidate runtime text) inherits the same stack — **no local override found on any probed element**.
- Weights in use: 400 (body/cells/inputs) and 500 (headings, table headers, badges, buttons). **No 700 anywhere** in the audited matrix.

### 2. Font system state (`document.fonts`, every capture; `artifacts/font-audit.json`)

- 246–248 `FontFace`s registered (3 harmony weights + dormant noto-serif), 11–14 `loaded` per page — the unicode-range subsets actually needed by that page's codepoints.
- `document.fonts.check('400 16px "HarmonyOS Sans SC"', "考试考生答案测评系统")` → **true on 30/30 captures**; latin 400 → true; cjk 500 → true. cjk **700 → false on all pages** — consistent with zero 700 text existing (Bold subsets correctly never fetched; lazy-load working, not a defect).

### 3. Render differential (primary render signal)

CJK ideographs are 1em-advance in every CJK font, so advance-width cannot discriminate CJK identity (recorded honestly: CJK widths came out identical 320px across families). For **Latin** ("Exam Result 123", 32px): HarmonyOS 243.0px vs Noto/fallback 220.4px — **distinct in 30/30 captures**. If the HarmonyOS family were not resolving, its measurement would equal the never-installed fallback baseline. It never does → the family resolves to real font data everywhere.

### 4. Network proof — fresh, cache-free context (`artifacts/font-network-probe.json`)

On `/login` in a brand-new browser context:

- All 3 HarmonyOS CSS files served **200** (`Regular.css`, `Medium.css`, `Bold.css`) + 2 dormant noto-serif CSS 200.
- **8 woff2 requests, all 200** (e.g. `Regular_68d530.woff2`, `Medium_18d529.woff2`, ...).
- `document.fonts` loaded faces: **`HarmonyOS Sans SC @400` ×5 subsets, `@500` ×3 subsets** — both Regular AND Medium actively load on a first-visit page.

### 5. Weight-500 caution resolved

`document.fonts.check('500 …')` can in principle be satisfied by a 400 face under CSS font matching. The Medium question is settled by the network probe: `Medium_*.woff2` files are actually fetched on a fresh visit where 500 text renders (登录 button). So 500-weight UI text (table headers, buttons, badges) renders HarmonyOS Medium.

## Per-surface classification

| Surface / component | Declared family | Computed family | Loaded evidence | Classification |
| --- | --- | --- | --- | --- |
| Admin shell, dashboard, tables (S1–S5, S8) | HarmonyOS Sans SC | identical stack, no override | cjk-400 check true; subsets loaded; Latin differential distinct | **HARMONY_CONFIRMED** |
| Dialog / form controls (S7, S5) | HarmonyOS Sans SC | identical stack | same | **HARMONY_CONFIRMED** |
| Candidate runtime (S6 list + take) | HarmonyOS Sans SC | identical stack | same | **HARMONY_CONFIRMED** |
| Bold (700) CJK anywhere | HarmonyOS Sans SC Bold | n/a — no 700 text exists | Bold subsets unloaded | **UNKNOWN→N/A** (no 700 usage in audited surfaces; dormant is correct lazy behavior) |
| Noto Serif SC | declared in index.html | not referenced by any probed element | 0 faces loaded | dormant by design (issue 577 m6 wiring truth) |

## Fallback-in-use? Likely cause?

**None found.** No global or local fallback was detected: the stack is uniform, subsets for every used codepoint load, the Latin render differential never matches the fallback baseline, and the resources are served 200. The only honest UNKNOWN is the glyph-level identity of individual CJK ideographs (advance-width is not discriminative for CJK); the loaded-subset + first-in-stack font-matching argument and the visual review of rendered screenshots both support HarmonyOS, but a glyph-metrics proof would require font-level tooling outside this audit's scope.
