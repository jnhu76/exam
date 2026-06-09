# Dependency Graph & Execution Strategy

> 本文档是 `phase1.4-bridge-plan.md` 的展开。若发生冲突，以 bridge plan 为准。

---

## Dependency Graph

```
A00 ──→ A01 ──→ A02 ──→ A03
                  ├──→ A04 (parallel with security, mandatory before Phase2)
                  ├──→ S01 ──→ S02
                  ├──→ S03a ──→ S03b
                  ├──→ S04
                  └──→ S07

S01 + S02 ──→ S06
S01-S07 + A04 ──→ S08 ──→ S09 ──→ V01

U01 ──→ U02
U01 ──→ U03
U01 ──→ U04

A05 ── (any time, no code)
S05 ── (after basic API plugin structure is stable)
```

---

## Wave Execution Order

### Wave 0 — Spike + Contract (Serial, Blocks All)

```
A00 (0.5d) → A01 (1d) → A02 (2d) → A03 (1d)
                                     → A04 (1d, parallel with Wave 1)
A05 (0.5d, any time)
```

- A00 只验证方案，不全量迁移
- A01 只定接口和类型
- A02 按 repo 分批迁移
- A03 修 Docker + PG smoke
- A04 可与安全工作并行，但 Phase2 Entry Gate 要求完成

### Wave 1 — Security Boundary (Serial after A02)

```
A02 → S01 (2d) → S02 (2d)
A02 → S03a (1.5d) → S03b (1d)
```

- S01 tenant guard 必须先于 S02 RBAC
- S03a server protocol 先于 S03b client flush

### Wave 2 — Security Hardening (Parallel)

```
A02 → S04 (1.5d) ── parallel
S01+S02 → S06 (1d) ── parallel
S05 (1d) ── parallel
S07 (1d) ── parallel
```

- S06 依赖 S01 + S02（cross-org audit 需要 tenant guard 和 RBAC）
- S04 依赖 A02（sessionVersion 需要 schema 变更）
- S05 可独立（安全 header 和 CSV 不依赖其他安全 Job）
- S07 依赖 A02（password 字段需要 schema 变更）

### Wave 3 — UI (Parallel with Wave 1-2)

```
U01 (1d) → U02 (1.5d) ── parallel
          → U03 (1.5d) ── parallel
          → U04 (1.5d) ── parallel
```

- U04 只做视觉和布局，不实现 submit flush
- S03b owns submit flush，may later update TakeExamPage
- Final Take Exam acceptance requires U04 + S03b together, but U04 is not blocked by S03b

### Wave 4 — Validation (Last)

```
S01-S07 + A04 → S08 (2d) → S09 (1d) → V01 (0.5d)
```

- S08 依赖 A04：红队测试必须在 SQLite 和 PG 两种环境下通过
- V01 是最终 Phase2 Entry Gate

---

## Critical Path

```
A00(0.5) → A01(1) → A02(2) → S01(2) → S02(2) → S08(2) → S09(1) → V01(0.5) = 11 days
```

With parallel execution: **~12-14 working days total**.

---

## Parallel Strategy

### Can Run In Parallel

| Group | Wave |
|-------|------|
| A04 + S01 | Wave 0→1 overlap |
| S04 + S05 + S06 + S07 | Wave 2 |
| U02 + U03 + U04 | Wave 3 |
| Wave 2 (Security) + Wave 3 (UI) | Cross-wave parallel |

### Must Be Serial

| Dependency | Reason |
|------------|--------|
| A00 → A01 → A02 | 每个 Job 依赖前一个的结论/接口 |
| A02 → S01 → S02 | tenant guard 先于 RBAC |
| A02 → S03a → S03b | server protocol 先于 client flush |
| S01-S07 + A04 → S08 | 安全测试依赖所有安全实现 |
| S08 → S09 → V01 | 验收串行 |

---

## Staffing

### 1 Person

Strict serial: Wave 0 → 1 → 2 → 3 → 4

### 2 People

- **A**: A00→A01→A02→A03→S01→S02→S08→S09→V01 (critical path)
- **B**: U01→U02→U03→U04→A04→S05→S04→S06→S07 (parallel track)

### 3 People

- **A**: Critical path
- **B**: S03a→S03b→S04→S06→S07 (exam protocol + security hardening)
- **C**: U01→U02→U03→U04→A05 (UI + docs)
