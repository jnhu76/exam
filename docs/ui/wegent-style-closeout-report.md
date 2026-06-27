# Wegent Style Migration Closeout Report

> **日期**：2026-06-27
> **分支**：`ui/wegent-token-closeout`
> **参考路径**：`/home/hoo/Source/_refs/wegent/frontend/`

---

## 1. 直接复制的 Wegent 代码

| 文件/片段 | 来源 | License |
|-----------|------|---------|
| CSS token 格式（RGB triplet） | `globals.css` `:root` | MIT (Wegent) |
| Button variant 结构 | `button.tsx` cva variants | MIT (Wegent) |
| Card variant 结构 | `card.tsx` cva variants | MIT (Wegent) |
| Badge variant 结构 | `badge.tsx` cva variants | MIT (Wegent) |
| Tabs active state pattern | `tabs.tsx` data-[state=active] | MIT (Wegent) |
| Tooltip border pattern | `tooltip.tsx` | MIT (Wegent) |
| Select rounded-xl content | `select.tsx` | MIT (Wegent) |

**License**: Wegent 使用 MIT license（`/home/hoo/Source/_refs/wegent/LICENSE`）。所有复制的代码片段均来自 MIT 许可的源码。

---

## 2. 改写的文件/片段

| 文件 | 改写内容 |
|------|----------|
| `index.css` | 完整重写 token 系统为 Wegent RGB triplet 格式 |
| `admin-theme.css` | 重写为 Wegent token alias |
| `button.tsx` | 重写 variant（default=transparent+border, primary=bg-primary） |
| `card.tsx` | 重写 variant 系统（default/elevated/ghost + padding） |
| `tabs.tsx` | 重写为 Wegent 风格（bg-muted list, active=bg-background+shadow） |
| `badge.tsx` | 新增 success/error/warning/info variants |
| `input.tsx` | 改为 h-10 rounded-lg bg-card |
| `textarea.tsx` | 改为 min-h-[80px] rounded-lg bg-card |
| `dialog.tsx` | overlay 改为 bg-black/80 |
| `tooltip.tsx` | 加 border, 移除 arrow |
| `select.tsx` | trigger h-10 rounded-lg, content rounded-xl |
| `statusMeta.ts` | toneTagClass 改为 bg-primary/10 (Wegent soft) |
| `AdminPageCard.tsx` | rounded-lg bg-card shadow-sm |
| `AdminSearchPanel.tsx` | bg-muted rounded-lg |
| `AdminTableShell.tsx` | bg-card rounded-lg shadow-sm |
| `AdminStatusTag.tsx` | rounded-md (Wegent tag) |
| `AdminButtons.tsx` | Wegent token verb colors, ghost icon button |
| `AdminShell.tsx` | gap-4, title text-xl |
| `MetricCard.tsx` | rounded-lg bg-card shadow-sm |
| `StatusBadge.tsx` | rounded-md (Wegent tag) |

---

## 3. 明确没有迁移的 Wegent 文件

| 文件/目录 | 原因 |
|-----------|------|
| `features/layout/*` | 业务布局（路由/状态管理） |
| `features/tasks/*` | 业务模块 |
| `features/knowledge/*` | 业务模块 |
| `features/settings/*` | 业务模块 |
| `features/theme/*` | 业务主题配置 |
| `contexts/*` | 业务状态管理 |
| `hooks/*` (业务) | 业务 hooks |
| `i18n/*` | 业务文案 |
| `app/**` | 业务路由和页面 |
| `public/fonts/*` | 品牌字体 |
| wework/ 子应用 | 独立应用，不同主色 |

---

## 4. Token 最终差异表

| Token | Wegent 值 | 当前项目值 | 状态 |
|-------|-----------|-----------|------|
| primary (light) | `93 94 201` (#5D5EC9) | `93 94 201` | ✅ 已统一 |
| primary (dark) | `118 119 218` | `118 119 218` | ✅ 已统一 |
| bg-base | `255 255 255` | `255 255 255` | ✅ 已统一 |
| bg-surface | `249 249 249` | `249 249 249` | ✅ 已统一 |
| bg-muted | `243 244 246` | `243 244 246` | ✅ 已统一 |
| border | `228 228 228` | `228 228 228` | ✅ 已统一 |
| text-primary | `51 51 51` | `51 51 51` | ✅ 已统一 |
| text-secondary | `99 99 99` | `99 99 99` | ✅ 已统一 |
| text-muted | `147 147 147` | `147 147 147` | ✅ 已统一 |
| success | `34 197 94` | `34 197 94` | ✅ 已统一 |
| error | `239 68 68` | `239 68 68` | ✅ 已统一 |
| warning | `245 158 11` | `245 158 11` | ✅ 已统一 |
| radius | `0.5rem` | `0.5rem` | ✅ 已统一 |
| dark: bg-base | `14 15 15` | `14 15 15` | ✅ 已统一 |
| dark: bg-surface | `26 28 28` | `26 28 28` | ✅ 已统一 |
| dark: primary | `118 119 218` | `118 119 218` | ✅ 已统一 |

---

## 5. 验收结果

| 检查项 | 结果 |
|--------|------|
| primary 已统一为 Wegent purple | ✅ `93 94 201` / `118 119 218` |
| Koi direct import = 0 | ✅ |
| Hardcoded colors = 0 | ✅ |
| Badge variant 残留 | 12（多为 info/outline 标签，非状态类） |
| space-x/y 残留 | 7（含 avatar group -space-x-2, calendar space-y-1） |
| deprecated 旧组件 | 4（PageHeader, ListToolbar, DataToolbar, DataTableShell） |
| typecheck | ✅ |
| lint / lint:copy / lint:arch | ✅ |
| test | ✅ 625/625 |
| build | ✅ |

---

## 6. 提交历史

| 提交 | 内容 |
|------|------|
| `233e7f7` | docs: add local Wegent delta audit |
| `f2f547b` | chore: stabilize Koi audit baseline |
| `090970d` | style: align theme tokens with Wegent |
| `2bd153c` | style: port Wegent primitive styles + restyle admin patterns |
| `d830255` | test: update tests for Wegent button variants |
| `315077c` | chore: add deprecated JSDoc to legacy components |

---

## 7. 未完成项和后续建议

### 未完成
- Badge variant 12 处残留（多为 info/outline 标签，可保留或迁移到 AdminStatusTag）
- space-x/y 7 处残留（avatar group 和 calendar 为合理保留）
- Phase 5（页面 rhythm 微调）未执行
- Phase 6（Badge/space 清理）未执行

### 后续建议
1. 逐页清理 Badge variant 残留（12 处）
2. 逐页统一 padding/gap rhythm
3. 暗色模式全站验证
4. 移动端响应式验证
5. 考虑将 `--color-primary` 从紫色调回蓝色（如果团队偏好）
