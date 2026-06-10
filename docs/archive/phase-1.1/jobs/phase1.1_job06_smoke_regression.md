# Phase 1.1 Job 06 — Smoke + Regression

## Goal

用测试保护 Phase 1 闭环，避免修一个 bug 又断另一个链路。

## Scope

- Integration tests
- E2E smoke if available
- Manual smoke checklist
- Regression tests for known bugs

## Required Regression Tests

```txt
[ ] no-body POST does not send JSON content-type
[ ] no-body DELETE does not send JSON content-type
[ ] publish exam succeeds
[ ] publish exam refreshes status
[ ] delete course succeeds or returns domain error
[ ] exam enrollment add/list/remove works
[ ] candidate my exams works
[ ] candidate start exam works
[ ] save answer remains idempotent
[ ] submit and grade works
[ ] score export works
```

## Smoke Command

推荐新增：

```bash
pnpm smoke
```

如果暂时无法自动化所有 UI，至少自动化 API smoke：

```txt
1. login teacher
2. create course
3. create question
4. create exam
5. publish exam
6. create candidate or use seed candidate
7. add enrollment
8. login candidate
9. list my exams
10. start exam
11. save answer
12. submit
13. grade
14. export scores
```

## Acceptance

```txt
[ ] docs/phase1.1-smoke-test.md 手动通过
[ ] 自动 regression 覆盖已知 P0
[ ] pnpm verify 或替代命令通过
```
