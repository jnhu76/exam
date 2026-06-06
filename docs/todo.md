# TODO

## Phase 1 Follow-ups

- [ ] Remove the remaining explicit `any` annotations from API route handlers and keep RF-009 architecture checks green.
- [ ] Add interaction tests for the expanded Job 4 management dialogs, candidate CSV preview-confirm flow, and Job 5 list/detail controls.
- [ ] Split the Web production bundle by route or feature to remove the Vite chunk-size warning (`536.77 kB` main JavaScript chunk after J7). The current production build succeeds; treat this as a Phase 1 release-polish item.
- [ ] Expand Job 6 page-level interaction tests for `ExamListPage`, `StartExamPage`, and `TakeExamPage`. Component coverage already exists for `QuestionNav`, `ExamTimer`, and `TrueFalseInput`; add end-to-end page behavior around queue polling, per-question auto-save, restore, and submit confirmation.
- [ ] **Repo 统一重构**：`userRepo.findByOrganizationAndUsername` 和 `findByOrganizationAndId` 不接收 `ctx`，违反 AGENTS.md "所有 repo 方法必须接收 ctx" 规则。当前导入循环已改用预加载 Set 规避，但其他调用点仍使用旧签名。需统一改为 `findByUsername(ctx, username)` 模式并更新所有调用方。
- [ ] **前端 detectDuplicate 防御性加固**：当前依赖后端 `validateCandidateFields` 强制恰好一个 unique 字段。如果后续放宽此约束，前端应遍历所有 unique 字段而非只取第一个。低优先级，待 CandidateField 规则变更时再处理。

## Job 8 Confirmed Execution Nodes

> Detailed scope: `docs/jobs/phase1_job8.md`
>
> J7 already provides the canonical single-attempt result endpoint: `GET /api/scores/attempts/:attemptId`. J8 extends the management workflow and must reuse this endpoint instead of creating a parallel detail API.

- [ ] **J8-A Contracts + score list API** — add tenant-scoped pagination, pass/fail filtering, search, sorting, statistics, and CandidateField-driven columns.
- [ ] **J8-B Attempt review API alignment** — confirm the J7 detail response supports teacher review; extend the shared Zod response only when the review UI requires additional fields.
- [ ] **J8-C Score management page** — implement `/admin/exams/:id/scores` with filters, dynamic columns, statistics, pagination, states, and detail navigation.
- [ ] **J8-D Teacher attempt detail page** — implement `/admin/attempts/:id` with answer review, partial-credit explanation, and return navigation.
- [ ] **J8-E CSV score export** — implement dynamic CandidateField headers, CSV escaping, authorization, tenant isolation, download headers, and AuditLog recording.
- [ ] **J8-F End-to-end verification** — run migrations, integration tests, `pnpm verify`, and browser smoke checks for list → detail → return and CSV download.

## Phase 2 Deployment Enhancements

- [ ] Replace the Job 6 in-memory exam admission queue with persistent shared storage before supporting multi-instance API deployment. The current queue is intentionally single-instance: it works for LAN single-machine deployments, but queued entries are cleared when the API service restarts and cannot be coordinated across API instances.

## Job 6 Follow-ups

> Full report: `docs/jobs/phase1_job6_review.md`

### Blocking

- [x] **B1** Add Zod schema validation to `apps/api/src/routes/attempts.ts` — all attempt endpoints validate params and payloads with `@exam/contracts` schemas.

### Important

- [x] **I1** Wire heartbeat background scheduler in server.ts — native `setInterval` scanner registered through the Fastify plugin lifecycle.
- [x] **I2** Implement queue UI in StartExamPage for `requireQueue` exams — wait count, estimated time, progress bar, polling, and auto-redirect.
- [x] **I6** Wrap `ExamTimer` `onTimeout` callback in `useCallback` to prevent unnecessary `setInterval` restarts on parent re-render.

### Low Priority

- [x] **L1** Deduplicate `QuestionSnapshot` type — derive the candidate-safe type from `@exam/contracts`.
- [x] **L2** Remove the runtime re-export of unimplemented `declare function` APIs.
- [x] **L3** Store true/false answers as booleans.
- [x] **L4** Replace `.filter(Boolean)` with an explicit type-narrowing predicate.
