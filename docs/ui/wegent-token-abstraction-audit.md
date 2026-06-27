# Wegent Token Abstraction Audit

- Scanned: 503 source files (+ token files)
- Blocking violations: 9
- Informational: 1

## Layers guarded
- L1 raw facts — `--raw-*` bare triplets in `:root`/`.dark`
- L2 bridge — `@theme inline` `--color-*` reference `rgb(var(--raw-*))`
- L3 shadcn — aliases resolve through the bridge (informational)
- L4 admin — `--admin-*` alias Layer-2 tokens, no duplicate facts

## Blocking violations: 9

- `apps/web/src/pages/admin/DashboardPage.tsx:82` — [hardcoded-hex-class] hardcoded hex in className — use a token utility
  > `iconColor="text-[#5b8ff9]"`
- `apps/web/src/pages/admin/DashboardPage.tsx:89` — [hardcoded-hex-class] hardcoded hex in className — use a token utility
  > `iconColor="text-[#faad14]"`
- `apps/web/src/pages/admin/DashboardPage.tsx:96` — [hardcoded-hex-class] hardcoded hex in className — use a token utility
  > `iconColor="text-[#9270ca]"`
- `apps/web/src/pages/admin/DashboardPage.tsx:103` — [hardcoded-hex-class] hardcoded hex in className — use a token utility
  > `iconColor="text-[#5ad8a6]"`
- `apps/web/src/pages/admin/ScoreListPage.tsx:191` — [hardcoded-hex-class] hardcoded hex in className — use a token utility
  > `iconColor="text-[#5b8ff9]"`
- `apps/web/src/pages/admin/ScoreListPage.tsx:198` — [hardcoded-hex-class] hardcoded hex in className — use a token utility
  > `iconColor="text-[#5ad8a6]"`
- `apps/web/src/pages/admin/ScoreListPage.tsx:205` — [hardcoded-hex-class] hardcoded hex in className — use a token utility
  > `iconColor="text-[#f46a6a]"`
- `apps/web/src/pages/admin/ScoreListPage.tsx:213` — [hardcoded-hex-class] hardcoded hex in className — use a token utility
  > `iconColor="text-[#f6bd16]"`
- `apps/web/src/pages/admin/ScoreListPage.tsx:220` — [hardcoded-hex-class] hardcoded hex in className — use a token utility
  > `iconColor="text-[#9270ca]"`

## Informational: 1

- `apps/web/src/index.css` — [raw-primary-present] Layer 1 raw primary present: light=93 94 201, dark=118 119 218
  > `--raw-primary (both themes)`
