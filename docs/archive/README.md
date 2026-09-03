# 文档归档

> `docs/archive/` 只保存历史证据，不是当前实施入口，也不是规范性 authority。
> 当前开发请从 [`docs/README.md`](../README.md) 开始。

## 归档原则

这里保存已经完成、被取代或仅用于追溯的材料，例如：

- reality audit / preflight / independent review；
- implementation / corrective / closeout evidence；
- 已关闭或被 GitHub Issues 取代的 roadmap / backlog；
- 旧阶段实施记录、UI 迁移记录和历史设计探索。

归档并不等于删除。当前 ADR、contract、status 或代码仍然可以引用这些文件作为历史证据，但归档内容不能覆盖当前 production code、SPEC、Accepted ADR、current contracts、standards、status 或 roadmap。

## 当前 authority 去哪里找

| Fact type | Current authority |
| --- | --- |
| 文档总入口 | [`docs/README.md`](../README.md) |
| 产品/领域不变量 | [`docs/SPEC.md`](../SPEC.md) |
| 架构决策 | [`docs/adr/`](../adr/) |
| 行为/API/语义契约 | [`docs/contracts/`](../contracts/) |
| 当前实现架构 | [`docs/architecture/`](../architecture/) + production code |
| 工程规范 | [`docs/standards/`](../standards/) |
| 当前实现状态 | [`docs/status/`](../status/) |
| 阶段边界与当前路线 | [`docs/roadmap/`](../roadmap/) |
| 当前执行顺序 | GitHub active roadmap Issue（当前由 `docs/README.md` 指向） |

## 目录结构

高信号归档目录：

```text
archive/
├── audits/                  # reality audits, reviews, closeouts, formal evidence
├── roadmap/                 # superseded/closed roadmap and backlog records
├── implementation-reports/ # historical implementation reports
├── reviews/                 # historical reviews
├── dev/                     # historical development/test records
├── frontend/                # historical frontend/UI material
├── followups/               # historical follow-up records
├── phase1-archive/          # Phase 1 history
├── phase2-archive/          # Phase 2 history
├── phase3-archive/          # Phase 3 history
├── phase3/                  # older Phase 3 evidence retained in-place
└── ...                      # other legacy archive buckets retained to preserve history
```

本次整理刻意没有为了目录美观重排所有旧 archive 子树。新归档优先使用 `audits/` 和 `roadmap/` 等高信号目录；旧目录保持原位以减少无意义 churn。

## 如何使用归档

- 查“现在应该怎么做” → 不要从这里开始，回到 [`docs/README.md`](../README.md)。
- 查“当时为什么这么设计/怎么验收” → 可以引用这里的 audit、closeout、review。
- current document 可以链接 archive 作为 evidence，但应明确它是历史证据。
- 如果 archive 与 current authority 冲突，以 current authority 与 as-built code 为准；冲突本身应作为 drift/defect 处理。

## 重要说明

`docs/archive/audits/` 不是旧的 `docs/audits/` authority namespace 的简单改名。
仍然生效的语义/行为 authority 已被重新归位到 active namespace，例如：

- [`docs/contracts/timed-sync-semantics.md`](../contracts/timed-sync-semantics.md)
- [`docs/contracts/exam-policy-authority.md`](../contracts/exam-policy-authority.md)
- [`docs/contracts/exam-profile-templates.md`](../contracts/exam-profile-templates.md)
- [`docs/contracts/admin-recovery-center.md`](../contracts/admin-recovery-center.md)

因此：**archive = evidence；contracts/ADR/SPEC/code = current authority by fact type。**
