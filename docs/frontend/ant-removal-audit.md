# Ant Design Total-Removal Audit — UI-TOKEN-TABLE-FOUNDATION-1 阶段一

> Status: **COMPLETE. All Ant Design artifacts removed; all 10 metrics = 0.**
> Commit: `chore(web): remove all Ant Design artifacts and stale guidance`

Ant Design exited this project's stack. It must not be reintroduced. This
document is the evidence that no Ant residue remains, generated from real
repository state.

## Metrics

| Metric | Required | Actual | Evidence |
| --- | --- | --- | --- |
| `ANT_DIRECT_DEPENDENCY_COUNT` | 0 | **0** | no `antd`/`@ant-design/*`/`rc-*` in any `package.json` (12 files) |
| `ANT_TRANSITIVE_DEPENDENCY_COUNT` | 0 | **0** | zero matches in `pnpm-lock.yaml`; not present in `node_modules/.pnpm` |
| `ANT_SOURCE_IMPORT_COUNT` | 0 | **0** | no `from "antd"` / `@ant-design` / `ConfigProvider` / `TableProps` etc. in source |
| `ANT_RUNTIME_PROVIDER_COUNT` | 0 | **0** | no Ant provider mounted; provider tree is ErrorBoundary→BrowserRouter→Brand→Auth→DateTime |
| `ANT_CSS_SELECTOR_COUNT` | 0 | **0** | no `.ant-*` / `--ant-*` / `ant-table` etc. in any CSS |
| `ANT_TEST_SELECTOR_COUNT` | 0 | **0** | no `.ant-*` selectors / Ant mocks in tests |
| `ANT_COMPATIBILITY_WRAPPER_COUNT` | 0 | **0** | no wrapper/adapter/shim for Ant compat |
| `ANT_BUILD_ARTIFACT_MATCH_COUNT` | 0 | **0** | `dist/` exists (real build, contains radix/lucide); zero ant refs |
| `ANT_CURRENT_DOC_MATCH_COUNT` | 0 | **0** | no doc describes Ant as current/recommended; only forbidden/purged framing |
| `ANT_MISLEADING_ARCHIVE_COUNT` | 0 | **0** | archive mentions all position Ant as forbidden/purged |

## What WAS removed in this pass (the rejected A/B/C table-direction lab)

The A/B/C table-direction experiment (`UI-TABLE-DIRECTION-LAB-1`) was a
**dev-only laboratory built on shadcn/ui — NOT Ant Design**. Its three
variants (A: horizontal-rule baseline; B: full management grid; C: hybrid
semantic-group grid) were all **rejected** as production directions: they did
not solve the gray header block, ERP-grid feel, cell-border overload, column
drift, or header/body alignment-axis inconsistency. All lab artifacts are now
deleted so no future reader mistakes them for an approved direction:

- `apps/web/src/dev/table-direction-lab/` — 11 files (page, 3 variants,
  builders, cell content, row actions, dataset, CSS, test) **+ parent `dev/`**
- `apps/e2e/scripts/capture-table-direction-lab.mjs` — Playwright capture
- `docs/frontend/UI-TABLE-DIRECTION-LAB-1.md` — lab audit/rubric
- `apps/web/src/App.tsx` — dev-gated lazy import + `TableDirectionLabRoute`
  + `/__dev/table-direction-lab` `<Route>` (and now-unused `lazy`/`Suspense`)

Verified after deletion: zero references to `table-direction-lab` /
`TableDirectionLab` / `__dev/table` remain in `apps/` `scripts/` `packages/`
`docs/` (excluding build output). `pnpm --filter @exam/web typecheck` passes.

## Documents mentioning Ant (all correctly "forbidden", none misleading)

Active governance docs (correct — Ant listed as forbidden):
- `docs/frontend/component-governance.md` — frozen-stack checklist: "Do not
  introduce Ant Design, MUI, Chakra, Headless UI…"

Archived docs (correct — Ant positioned as forbidden/already-purged):
- `docs/archive/phase2-archive/phase2-baseline-audit.md` — "Already fully
  purged. No remnants remain. Defer permanently."
- `docs/archive/ui/frontend-ui-system-replan.md` — "Do not add … Ant Design
  … or another UI framework."

No document describes Ant as the current or recommended stack. No archive
document could mislead a future agent into reintroducing Ant.

## Verification commands (reproducible)

```bash
# direct deps
grep -rn '"antd"\|"@ant-design' **/package.json   # 0
# source imports
grep -rln 'from "antd"\|@ant-design\|rc-table\|ConfigProvider' apps packages --include='*.ts' --include='*.tsx'  # 0
# css selectors
grep -rln '\.ant-\|--ant-' apps packages --include='*.css'  # 0
# lockfile
grep -c 'antd\|@ant-design\|rc-table' pnpm-lock.yaml  # 0
```

## Conclusion

Ant Design is fully removed from dependencies, source, CSS, tests, build
output, and active documentation. The rejected A/B/C table-direction lab is
also removed. **Gate requirement for all later stages is satisfied.**
