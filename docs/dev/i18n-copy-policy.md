# i18n Copy Policy

## Rule 1: No hardcoded user-visible Chinese in production source

Production source files (`apps/web/src/**`, excluding tests and locale catalog) must not contain user-visible Chinese strings. All user-facing copy must be:

1. Defined in `apps/web/src/i18n/locales/zh-CN.ts`
2. Rendered via `t("key")` or `useTranslation()` in components

This rule is enforced by `pnpm lint:copy` (CI gate).

## Rule 2: zh-CN catalog is the single source of truth

All Chinese UI text lives in `apps/web/src/i18n/locales/zh-CN.ts`. Components reference keys, not strings.

**Wrong:**
```tsx
<Button>保存</Button>
```

**Correct:**
```tsx
<Button>{t("common.save")}</Button>
```

## Rule 3: Test assertions use resolved Chinese

Tests may assert the final rendered Chinese text. This verifies the i18n pipeline works end-to-end.

**Allowed:**
```ts
expect(screen.getByText("保存成功")).toBeInTheDocument();
```

**Forbidden:**
```ts
expect(screen.getByText("common.saveSuccess")).toBeInTheDocument();
```

## Rule 4: CSV/template compatibility allowlist

CSV header matching and template content may contain Chinese. These are data format contracts, not user-facing copy.

Currently allowed:
- `apps/web/src/lib/candidateImport.ts` — CSV header aliases (用户名/密码/姓名)
- `apps/web/src/pages/admin/QuestionImportPage.tsx` — CSV template headers, parser tokens, example rows

These are documented in `scripts/check-hardcoded-copy.mjs` with justification.

## Rule 5: Temporary allowlist requires justification

Any temporary allowlist entry must document:
- File path
- Reason (why Chinese is acceptable here)
- Removal condition (when the exemption expires)

Currently allowed:
- `apps/web/src/pages/PlaceholderPage.tsx` — temporary placeholder, remove when implemented

## Adding new allowlist entries

1. Edit `CJK_ALLOWLIST` in `scripts/check-hardcoded-copy.mjs`
2. Add entry with `path`, `reason`, and `removal` fields
3. Explain in PR why this is not UI copy
4. If temporary, set a removal condition

## Enforcement

`pnpm lint:copy` runs as part of:
- `pnpm verify` (full pipeline)
- `pnpm verify:static` (pre-commit)
- CI checks on every push

Exit code 1 blocks the commit/merge.
