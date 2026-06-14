# Dependency Graph & Execution Strategy

> 本文档是 `phase1.4-bridge-plan.md` 的展开。若发生冲突，以 bridge plan 为准。
> **重要更新（2026-06-11）**：Phase1.4 当前状态为 partial closeout，S03b-S09 已迁移到 Phase1.7。

---

## Dependency Graph

```
Phase1.4
  ├─ S01
  ├─ S02
  ├─ S03a
  ├─ U01
  ├─ U02
  ├─ U03
  └─ U04

Phase1.5
  └─ PostgreSQL-only convergence
       ├─ J1 DB Runtime Inventory
       ├─ J2 PG Test Harness
       ├─ J3 Migration Convergence
       ├─ J4 Seed Convergence
       ├─ J5 Repository Dialect Removal
       ├─ J6 CI PG Switch
       └─ J7 SQLite Correctness Removal Report

Phase1.6
  └─ PostgreSQL correctness hardening
       ├─ J1 Transaction Correctness
       ├─ J2 Concurrency Tests
       ├─ J3 S03a PG Verification
       ├─ J4 Migration/Seed Regression
       └─ J5 CI Gate

Phase1.7
  ├─ S03b Client Submit Flush Protocol
  ├─ S04-lite Auth Session Security Baseline
  ├─ S05-lite CSV + Security Headers + CSRF Baseline
  ├─ S06-lite Audit Log Baseline
  ├─ S07-lite Password Policy Baseline
  ├─ S08-lite Red-Team Baseline Suite
  └─ S09-lite Phase1.7 Security Baseline Validation

Phase2
  ├─ 2A Exam Operation
  ├─ 2B Proctor Panel
  ├─ 2C Exam Flexibility
  └─ 2D Integration Export
```

---

## Wave Execution Order

### Phase1.4 — Partial Closeout

```
S01 (2d) ── parallel
S02 (2d) ── parallel (after S01)
S03a (1.5d) ── parallel
U01 (1d) → U02 (1.5d) ── parallel
         → U03 (1.5d) ── parallel
         → U04 (1.5d) ── parallel
```

- S01 tenant guard 必须先于 S02 RBAC
- S03a server protocol 已在 Phase1.4 基础完成
- U04 只做视觉和布局，不实现 submit flush
- S03b 已迁移到 Phase1.7

### Phase1.5 — PostgreSQL-only Convergence

```
J1 (0.5d) ── parallel
J2 (1d) ── parallel
J3 (1d) ── parallel (after J1, J2)
J4 (1d) ── parallel (after J1, J2)
J5 (2d) ── serial (after J1)
J6 (1d) ── serial (after J2, J3, J5)
J7 (0.5d) ── parallel (after J5, J6)
```

### Phase1.6 — PostgreSQL Correctness Hardening

```
J1 (2d) ── parallel
J2 (2d) ── parallel (after J1)
J3 (1d) ── parallel (after J1)
J4 (1d) ── parallel
J5 (1d) ── serial (after J1-J4)
```

### Phase1.7 — Security Completion

```
S03b (1d) ── parallel (after Phase1.6 S03a)
S04-lite (1d) ── parallel
S05-lite (1d) ── parallel
S06-lite (1d) ── parallel (after S04-lite)
S07-lite (1d) ── parallel
S08-lite (2d) ── serial (after all above)
S09-lite (1d) ── serial (after S08-lite)
```

---

## Critical Path

```
Phase1.4: S01(2) → S02(2) = 4 days
Phase1.5: J1(0.5) → J5(2) → J6(1) = 3.5 days
Phase1.6: J1(2) → J2(2) = 4 days
Phase1.7: S03b(1) + S04-S07-lite(1) → S08-lite(2) → S09-lite(1) = 4 days
```

Total critical path: **~15-16 working days** (含并行)

---

## Parallel Strategy

### Can Run In Parallel

| Group | Phase |
|-------|-------|
| Phase1.4 UI (U01-U04) + Phase1.4 Security (S01, S02, S03a) | Phase1.4 |
| Phase1.5 J1-J4 | Phase1.5 |
| Phase1.6 J1-J4 | Phase1.6 |
| Phase1.7 S03b + S04-lite + S05-lite + S06-lite + S07-lite | Phase1.7 |

### Must Be Serial

| Dependency | Reason |
|------------|--------|
| Phase1.4 → Phase1.5 | 基础安全层完成后做数据库收敛 |
| Phase1.5 → Phase1.6 | PG-only 基础是 correctness hardening 前置条件 |
| Phase1.6 → Phase1.7 | 数据库正确性是安全完成的前置条件 |
| Phase1.7 → Phase2 | 安全 baseline 是 Phase2 前置条件 |
| S01 → S02 | tenant guard 先于 RBAC |
| S03a → S03b | server protocol 先于 client flush |
| J1 → J5 | 盘点完成后才清理 dialect |
| J5 → J6 | repo 清理完成后才切 CI |

---

## Staffing

### 1 Person

Strict serial: Phase1.4 → Phase1.5 → Phase1.6 → Phase1.7

### 2 People

- **A**: Phase1.4 S01→S02→S03a → Phase1.5 J1→J5→J6 → Phase1.6 J1→J2
- **B**: Phase1.4 U01→U02→U03→U04 → Phase1.5 J2→J3→J4 → Phase1.7 S03b→S04→S05→S06→S07→S08→S09

### 3 People

- **A**: Phase1.4 S01→S02 → Phase1.5 J5 → Phase1.6 J1→J2
- **B**: Phase1.4 U01→U02→U03→U04 → Phase1.5 J3→J4 → Phase1.7 S03b→S04→S06
- **C**: Phase1.4 S03a → Phase1.5 J1→J2→J6→J7 → Phase1.7 S05→S07→S08→S09
