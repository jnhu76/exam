# Wegent Token Abstraction Audit

- Scanned: 503 source files (+ token files)
- Blocking violations: 0
- Informational: 1

## Layers guarded
- L1 raw facts — `--raw-*` bare triplets in `:root`/`.dark`
- L2 bridge — `@theme inline` `--color-*` reference `rgb(var(--raw-*))`
- L3 shadcn — aliases resolve through the bridge (informational)
- L4 admin — `--admin-*` alias Layer-2 tokens, no duplicate facts

## Blocking violations: 0 ✅

## Informational: 1

- `apps/web/src/index.css` — [raw-primary-present] Layer 1 raw primary present: light=93 94 201, dark=118 119 218
  > `--raw-primary (both themes)`
