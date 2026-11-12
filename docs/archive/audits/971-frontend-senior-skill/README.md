# #971 Web 前端审计证据存档（senior-frontend skill @ d3e74dd4）

> **STATUS: DO NOT MERGE — 证据存档，仅供 agent 与人类查验。**
> 本目录是 [issue #971](https://github.com/jnhu76/exam/issues/971)（Web 前端实现审计报告）的运行时证据附件。宿主 PR 保持 **draft + `do-not-merge`**，永不合并；本目录内容不参与构建、不被任何生产/测试代码引用，也不是规范性 authority（见 [`docs/archive/README.md`](../../README.md)）。

## 审计元信息

| 项 | 值 |
| --- | --- |
| 审计对象 | `master` @ `d3e74dd4860dd5bcbae1c50fe7c58af175a22594`（独立 detached worktree，零文件修改） |
| 方法论 | [davila7/claude-code-templates `senior-frontend` skill v2.0.0](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/skills/development/senior-frontend)（MIT，文件清单经真实 Chrome CDP 核对） |
| 静态审计 | 4 个只读 subagent（a11y / React 状态 / 治理 / 状态矩阵），P1 逐文件主审复核 |
| 浏览器验证 | Playwright 1.61 + skill 自带 `check_ui.mjs`/`page-audit.mjs` + axe-core 4.10.2 + Tab 焦点走查；dev 栈 = dev PostgreSQL/Redis（只读使用）+ API dev + web dev（worktree 源码） |
| 门禁基线 | typecheck exit 0；`eslint --max-warnings=0` exit 0；`vitest run` 194 files / 2838 tests 全过 |
| 结论速览 | 5×P1 / 16×P2 / 37×P3；axe WCAG 2.2 AA 9 页 0 违规；375px 0 横向溢出；全部停靠点可见焦点 |

## 文件地图

```
971-frontend-senior-skill/
├── README.md                        # 本文件
├── audit-report.md                  # 完整审计报告（与 issue #971 正文一致）
├── screenshots/                     # 20 张全页截图（1280/375 双宽度；login 为 skill 原版 check_ui.mjs 产出）
│   ├── admin-dashboard-{1280,375}.png
│   ├── users-{1280,375}.png
│   ├── candidates-{1280,375}.png
│   ├── exams-{1280,375}.png             # 含 ?search=zzzznope 参数探针（ExamPage 无该参数，非 bug）
│   ├── exams-nomatch-{1280,375}.png
│   ├── permissions-{1280,375}.png       # F-03：用户权限检查器空（/api/admin/users 404 被静默吞掉）
│   ├── grading-queue-{1280,375}.png     # F-02：行激活仅鼠标（Tab 走查无行停靠点）
│   ├── audit-logs-{1280,375}.png
│   ├── candidate-exam-list-{1280,375}.png  # Admin 访问 /exam/list 被 capability 路由重定向回 dashboard（按设计）
│   └── login-page-{1280,375}.png
└── evidence/
    ├── authed-report.json          # 9 页 × 2 宽度驱动审计：auditDom issues / axe 违规 / 焦点走查 / 控制台错误 / ≥400 响应
    ├── rerun-375.json              # 429 限流污染后的节流重跑（含 permissions 404 的 URL 定位）
    └── login-check-ui-report.json  # skill 原版 check_ui.mjs @ /login 的 JSON 报告
```

## 复现命令

```bash
# API（主仓；3000 被宿主占用故用 3100）+ Web（worktree 源码）
DEV_API_PORT=3100 pnpm --filter @exam/api dev &
cd <worktree>/apps/web && ./node_modules/.bin/vite &

# skill 原版检查器（公共页）
cd apps/e2e && node <skill>/scripts/check_ui.mjs http://localhost:5173/login \
  --out /tmp/ui-check/login --widths 375,1280

# 登录后页面驱动审计（UI 登录 → storageState → auditDom/axe/focusWalk × 9 页 × 2 宽度）
node /tmp/audit-browser.mjs
```

## 处置与边界

- **不合并**：本 PR 的唯一用途是让 agent/评审者能通过 GitHub PR 界面直接查阅截图与 JSON 证据；merge 无收益且会向 `docs/` 引入 3.8MB 二进制。
- **已排除**：`state.json`（Playwright storageState，含登录会话 cookie，属凭证，禁止入库）；`/tmp/axe.min.js`（第三方库，可由 CDN 复取）。
- 截图中的账号/邮箱均为本地 dev/seed 体系的合成数据。
- 证据修复属各发现自身的 Issue/PR（按 #971 §J 路由），不通过本 PR 承载。
