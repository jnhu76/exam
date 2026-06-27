# Wegent Token Abstraction — Report

> Verification report for the 4-layer token abstraction defined in
> `docs/ui/wegent-token-abstraction.md`.
> Generated: 2026-06-27 (branch `ui/wegent-token-closeout`).

## 1. Summary

Migrated `apps/web` from a single-layer literal-`rgb()` token model to the
4-layer Wegent raw-triplet model. This fixes a latent dark-mode regression
(primary and all derived utilities failed to flip in `.dark`) while preserving
Tailwind v4 `/N` opacity modifiers. Single source of truth per color is now
enforced; the previous duplicate `--admin-*` color facts are collapsed into
aliases.

## 2. Files modified

| File | Change |
| --- | --- |
| `apps/web/src/index.css` | Restructured into Layer 1 (raw `--raw-*` triplets in `:root`/`.dark`) + Layer 2 (`@theme inline` `rgb(var(--raw-*))` bridge). Font stack (Noto Sans CJK SC) and base styles preserved. |
| `apps/web/src/styles/admin-theme.css` | Layer 4: every `--admin-*` color converted from a literal fact to an alias of a Layer 2 token. Structural values (radius/metrics/shadow ink) retained. |
| `docs/ui/wegent-token-abstraction.md` | Authority design doc (layers, rules, migration status). |
| `docs/ui/wegent-token-abstraction-report.md` | This report. |
| `scripts/audit-wegent-token-abstraction.mjs` | Guard script — blocks literal-rgb in `@theme`, duplicate `--admin-*` facts, hardcoded hex/palette colors, `divide-x/y` gridlines. |

No business pages (`apps/web/src/pages/*`), API code (`apps/api/*`), or
packages (`packages/*`) were modified — per task scope.

## 3. The latent dark-mode bug (root cause)

The previous `index.css` declared:

```css
@theme inline { --color-primary: rgb(93 94 201); }
.dark { --color-primary: rgb(118 119 218); }
```

Verified against this repo's Vite build (Tailwind CSS v4.3.0), a literal color
in `@theme inline` is statically resolved at build time, baking the literal
into each utility and defeating the `.dark` redefinition:

```css
/* BEFORE (generated) */
.text-primary { color: #5d5ec9; }          /* baked — dark never applies */
.dark { --color-primary: #7677da; }        /* no utility reads this var */
```

Primary, success, warning, destructive, info, and border utilities were all
affected — i.e. essentially every themed utility did not flip in dark mode.

## 4. The fix — verified generated CSS

After the abstraction, the same build emits dynamic utilities:

```css
/* AFTER (generated) */
.text-primary { color: rgb(var(--raw-primary)); }
.bg-primary\/10 {
  background-color: color-mix(in oklab, rgb(var(--raw-primary)) 10%, transparent);
}
.border-border { border-color: rgb(var(--raw-border)); }
.bg-card { background-color: rgb(var(--raw-bg-surface)); }

--raw-primary: 93 94 201;     /* :root */
--raw-primary: 118 119 218;   /* .dark — utilities now follow */
--raw-bg-surface: 249 249 249;  /* :root */
--raw-bg-surface: 26 28 28;    /* .dark */
```

Both signals are confirmed:
- **Dynamic dark mode**: `--raw-*` triplets survive in both `:root` and `.dark`,
  so `.text-primary` / `.bg-primary` / etc. flip correctly.
- **Opacity modifiers**: `/10` emits `color-mix(in oklab, rgb(var(--raw-…)) 10%, transparent)` — working.

## 5. Research methodology (AGENTS.md compliance)

The Tailwind v4 `@theme inline` alpha + dark-mode interaction is not safe to
guess from memory. Per AGENTS.md "Mandatory Research Workflow" and "No Guessing
Rules":

- **MCP/Context7 status**: UNAVAILABLE in this session. Stated explicitly per
  "If MCP Is Unavailable" — the agent must say so and fall back to local
  evidence.
- **Official docs**: consulted tailwindcss.com/docs/theme (via WebSearch) for
  `@theme inline` semantics and the opacity-modifier `color-mix()` mechanism.
- **Local repo evidence (decisive)**: ran a controlled in-repo Vite build with
  four experimental declaration strategies (A/B/C/D) and inspected the
  generated CSS byte-for-byte. The results table is in
  `docs/ui/wegent-token-abstraction.md` §3. Strategy B (`rgb(var(--raw-x))`
  over bare triplets) was adopted because it is the only strategy that gives
  both dynamic dark mode AND working `/N` alpha.
- **Wegent reference**: `/_refs/wegent/frontend` (`globals.css` Layer 1 +
  `tailwind.config.js` `withOpacity` Layer 2) was read as the model to port;
  its v3 `withOpacity('--color-x')` → `rgb(var(--color-x) / <alpha-value>)`
  bridge is the direct ancestor of this v4 `@theme inline` bridge.

## 6. Build evidence

```
$ pnpm --filter web build
✓ 3515 modules transformed.
dist/assets/index-*.css   71.96 kB │ gzip: ~12 kB   (was 63.98 kB — dynamic var() emits slightly more CSS)
dist/assets/vendor-react-dom-*.js  348.34 kB
… 8/8 chunks emitted, build OK
```

CSS size grew from 63.98 kB to 71.96 kB (+12%). This is the expected and
acceptable cost of replacing baked literals with dynamic `var()` references so
that dark mode works. gzip is ~12 kB.

## 7. Layer counts

- Layer 1 raw facts: **27** `--raw-*` triplets in `:root`, mirrored in `.dark`.
- Layer 2 bridge: all `--color-*` namespaces (surfaces, brand/status, borders,
  accent, sidebar, admin aliases) reference `rgb(var(--raw-…))`.
- Layer 4 admin aliases: **19** `--admin-*` entries, all alias forward to
  Layer 2 (zero literal color facts remain).

## 8. Audit results

`scripts/audit-wegent-token-abstraction.mjs` scanned 503 source files plus the
two token files. Result:

- **Token-system structural checks: PASS.** No literal `rgb()` in `@theme
  inline` (excluding shadow ink), no `--admin-*` literal color facts, raw
  triplets present in both themes.
- **9 blocking violations: pre-existing hex debt** in
  `apps/web/src/pages/admin/DashboardPage.tsx` (4) and
  `apps/web/src/pages/admin/ScoreListPage.tsx` (5) — `iconColor="text-[#5b8ff9]"`
  etc. These are Koi-palette leftover values on business pages that are
  **outside this PR's allowed file scope** (allowed: `index.css`,
  `admin-theme.css`, `styles/*`, ui primitives, AdminButtons, AdminStatusTag,
  StatusBadge, docs). They are tracked here as known debt for a follow-up
  page-migration PR. The audit intentionally does not soft-pass them — they
  must be migrated to tokens to reach a green audit.

The audit writes `docs/ui/wegent-token-abstraction-audit.{md,json}`.

## 9. Known debt / limitations

1. **DashboardPage / ScoreListPage `iconColor` hex values** (9 findings) — out
   of scope for this token-abstraction PR. Migration target: replace with
   semantic utilities (`text-primary`, `text-success`, `text-warning`,
   `text-destructive`, `text-info`).
2. **CSS size +12%** — acceptable tradeoff for working dark mode. Revisit only
   if bundle budget becomes a concern.
3. **Sidebar hover alpha** uses a `var(--raw-sidebar-hover-alpha, 1)` fallback
   for the light theme where hover is a solid muted surface (no alpha needed).
4. No runtime/cloud dependencies introduced — the abstraction is pure CSS.
   LAN/on-premise and offline constraints are unaffected.

## 10. What a follow-up page-migration PR should do

- Replace the 9 `text-[#…]` iconColor literals with semantic tokens.
- Re-run `node scripts/audit-wegent-token-abstraction.mjs` and confirm exit 0.
- Add the audit to CI as a blocking check alongside `audit-koi-ui-usage.mjs`.

---

## Follow-up: token audit green

> Completed in the follow-up task on the same branch. The 9 hardcoded-hex
> violations tracked in §8/§9.1 are resolved; the token audit now exits 0.
> No API, route, permission, data-testid, test semantics, or page structure
> were changed — only icon coloring.

### Hex values cleaned (9 → 0)

All were `MetricCard` icon colors using Koi-palette hex + rgba literals:

| Page | Label | Was (Koi) | Now (Wegent tone) |
| --- | --- | --- | --- |
| DashboardPage | 题目总数 | `text-[#5b8ff9]` + `bg-[rgba(91,143,249,0.12)]` | `tone="primary"` |
| DashboardPage | 考试进行中 | `text-[#faad14]` + `bg-[rgba(250,173,20,0.14)]` | `tone="warning"` |
| DashboardPage | 考生总数 | `text-[#9270ca]` + `bg-[rgba(146,112,202,0.12)]` | `tone="muted"` |
| DashboardPage | 今日考试 | `text-[#5ad8a6]` + `bg-[rgba(90,216,166,0.14)]` | `tone="success"` |
| ScoreListPage | 平均分 | `text-[#5b8ff9]` + `bg-[rgba(91,143,249,0.12)]` | `tone="primary"` |
| ScoreListPage | 最高分 | `text-[#5ad8a6]` + `bg-[rgba(90,216,166,0.14)]` | `tone="success"` |
| ScoreListPage | 最低分 | `text-[#f46a6a]` + `bg-[rgba(244,106,106,0.12)]` | `tone="error"` |
| ScoreListPage | 及格率 | `text-[#f6bd16]` + `bg-[rgba(246,189,22,0.14)]` | `tone="warning"` |
| ScoreListPage | 已评分 | `text-[#9270ca]` + `bg-[rgba(146,112,202,0.12)]` | `tone="muted"` |

Note: the audit only flagged the 9 `text-[#…]` values (its pattern matches
hardcoded hex, not `rgba()`). The paired `bg-[rgba(...)]` literals were the
same Koi debt visually and are removed by the tone migration as well.

### Semantic tone API added

`apps/web/src/components/admin/MetricCard.tsx` gained a `tone` prop:

```ts
type MetricTone = "primary" | "success" | "warning" | "error" | "muted";
```

Each tone resolves exclusively to Wegent semantic utilities (single source:
`--raw-*` triplets), never a hardcoded color:

```ts
{
  primary: { bg: "bg-primary/10", fg: "text-primary" },
  success: { bg: "bg-success/10", fg: "text-success" },
  warning: { bg: "bg-warning/10", fg: "text-warning" },
  error:   { bg: "bg-error/10",   fg: "text-error" },
  muted:   { bg: "bg-muted",      fg: "text-muted-foreground" },
}
```

To support the `error` tone, a `--color-error` bridge was added to `index.css`
as a pure alias of the existing `--raw-error` fact (single source; `destructive`
already aliased the same fact — `error` is the Wegent-semantic name for
component tone APIs). Verified build output:

```css
.text-error { color: rgb(var(--raw-error)); }
.bg-error\/10 { background-color: color-mix(in oklab, rgb(var(--raw-error)) 10%, transparent); }
```

### Compatibility props retained

The legacy `iconBg` / `iconColor` props are **not removed** — they are marked
`@deprecated` and kept for backward compatibility. Resolution order is
`tone` > (`iconBg`+`iconColor`) > `primary`. The existing token-based caller
`SystemDiagnosticsPage` (which passes `bg-primary/10` / `text-primary` etc.
directly) continues to render unchanged. No call site was broken.

### Audit status

- `node scripts/audit-wegent-token-abstraction.mjs` → **exit 0** (was exit 1).
  Blocking violations: 9 → 0. Hardcoded colors: 0. The only remaining output is
  the informational `raw-primary-present` line confirming Layer 1.
- `node scripts/audit-koi-ui-usage.mjs` → **exit 0** (Koi direct imports: 0).

### Verification (follow-up)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | ✅ 15/15 tasks |
| `pnpm lint` / `lint:copy` / `lint:arch` | ✅ all pass |
| `pnpm format:check` | ✅ clean |
| `pnpm --filter web build` | ✅ OK |
| `pnpm test` | ✅ 625/625 |
| token-abstraction audit | ✅ exit 0 (0 violations) |
| koi-ui audit | ✅ exit 0 |

### Remaining note

The follow-up scope was intentionally limited to making the token audit green
via a semantic tone API. True Wegent page refactoring (WegentList primitives,
list/detail templates across CoursePage/ExamPage/QuestionPage/UsersPage/
CandidatesPage) is the next, separate body of work.

