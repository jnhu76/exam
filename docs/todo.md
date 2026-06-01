# TODO

## Phase 1 Follow-ups

- [ ] Remove the remaining explicit `any` annotations from API route handlers and keep RF-009 architecture checks green.
- [ ] Add interaction tests for the expanded Job 4 management dialogs, candidate CSV preview-confirm flow, and Job 5 list/detail controls.
- [ ] Split the Web production bundle by route or feature to remove the Vite chunk-size warning (`533.60 kB` main JavaScript chunk). The current production build succeeds; treat this as a Phase 1 release-polish item.
- [ ] Expand Job 6 page-level interaction tests for `ExamListPage`, `StartExamPage`, and `TakeExamPage`. Component coverage already exists for `QuestionNav`, `ExamTimer`, and `TrueFalseInput`; add end-to-end page behavior around queue polling, per-question auto-save, restore, and submit confirmation.

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
