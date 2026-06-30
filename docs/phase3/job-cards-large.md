# Exam Phase 3 — Large Job Cards

> Large Job 是架构级设计单元。Large Job 不直接施工。
> Large Job 必须先 grillme / ADR / spec / matrix / state diagram。
> Large Job 完成设计后，再拆成 Middle Job。

> Small / Middle Job 不在本文档展开，详见 `docs/phase3/plan.md` 和 `docs/phase3/job-cards.md`。

---

## 0. Large Job Rules

```text
Large Job 不直接施工。
Large Job 必须先 grillme / ADR / spec / matrix / state diagram。
Large Job 完成设计后，再拆成可合并的 Middle Job。
```

```text
Large Job PR 通常只能提交文档、ADR、spec、matrix、diagram。
不能无设计地直接修改业务代码。
不能无边界地引入 migration。
不能在一个 PR 里同时做 frontend + backend + DB + permission + state machine。
```

**RBAC 特殊说明：**

```text
RBAC 当前已经是 Active Large Track。
L1/L2 可以有正在施工的 derived Middle / implementation PR。
但 Large Job Cards 仍然必须记录 L1/L2 的架构边界、non-goals、依赖和后续拆分。
L7 Proctor Authority 和 L3 Custom RBAC 仍然不能混入当前 L1/L2 基础 RBAC PR。
```

---

## 1. Priority Groups

### Group A — Active RBAC Track

| ID | Large Job | Status |
| -- | --------- | ------ |
| L1 | Teacher / Proctor / Grader Account Model | **Active / In Progress** |
| L2 | Backend Permission Model | **Active / In Progress** |
| L7 | Proctor Runtime Authority Boundary | **Priority — blocked by L1/L2 base** |
| L3 | Custom Role / Custom RBAC | **Later / Explicitly Deferred** |

```text
L1/L2 正在作为 RBAC active track 推进。
L7 依赖 L1/L2 基础稳定，不要混入当前 RBAC 基础 PR。
L3 Custom RBAC 明确后置，当前只做内置角色和基础 permission model。
```

### Group B — Exam Correctness Foundation

| ID | Large Job | Status |
| -- | --------- | ------ |
| L16 | Question Bank / Paper Versioning Model | **Priority** |
| L4 | Answer Protocol v2 | **Priority** |
| L5 | WYSIWYG Submit / Final Answer Barrier | **Priority** |
| L13 | Exam Lifecycle State Model | **Priority** |
| L14 | Result Visibility / Release Policy | **Priority** |

```text
这一组决定"考试内容是什么、答案如何保存、最终提交冻结什么、考试状态如何流转、成绩何时可见"。
它们是前端状态机、监考、评分、审计的基础。
L16 必须在 L4 之前，因为答案 payload 必须引用稳定的题目/试卷版本。
```

### Group C — Runtime / Frontend / UI

| ID | Large Job | Status |
| -- | --------- | ------ |
| L6 | Frontend Exam State Machine | **ADR Started / Runtime Deferred** |
| L8 | UI Design / Workbench UI Contract | **Deferred** |
| L9 | Audit / Monitoring Full Event Taxonomy | **Priority** |
| L11 | Subjective / Rich Text / Drawing Answer Architecture | **Priority** |

```text
Frontend State Machine 已有 ADR-009 adoption strategy，但 runtime spec 应依赖 L4/L5/L13。
UI Contract 可以并行设计，但不应打断考试正确性基础。
```

### Group D — Ops / Scale / Productization

| ID | Large Job | Status |
| -- | --------- | ------ |
| L10 | E2E Full Parallelization Implementation | **Later** |
| L15 | Notification / Email Policy | **Later** |
| L17 | Import / Export / Bulk Operation Contract | **Later** |
| L18 | Deployment / On-Prem Ops Contract | **Later** |
| L19 | Data Retention / Privacy / Audit Redaction | **Later** |
| L20 | Reporting / Analytics / Score Statistics Model | **Later** |

---

## 2. Dependency Map

```text
L12 Tenant Scope → L1 Account Model → L2 Permission Model
L1 + L2 → L7 Proctor Authority
L13 Exam Lifecycle → L7 Proctor Authority
L3 Custom RBAC depends on L1/L2 and is explicitly later

L16 Paper Versioning → L4 Answer Protocol
L4 Answer Protocol → L5 Final Barrier
L4 + L5 + L13 → L6 Frontend State Machine
L13 → L14 Result Visibility
L4 + L16 → L11 Subjective / Rich Text / Drawing

Email backend (completed) + L9 Event Taxonomy + L14 Result Release → L15 Notification Policy
L9 Event Taxonomy → L19 Data Retention / Privacy
L13 + L14 + L20 interact on result reporting
```

**Key dependency notes:**

- L1/L2 are already active, but this does NOT mean L3 Custom RBAC can be pulled forward.
- Proctor Authority (L7) depends on Account Model, Permission Model, and Exam Lifecycle. It must not be mixed into current L1/L2 RBAC base PRs.
- Frontend State Machine (L6) depends on Answer Protocol (L4), Final Barrier (L5), and Exam Lifecycle (L13). ADR-009 is the adoption strategy; the runtime spec waits for these conclusions.
- Notification Policy (L15) depends on Email Outbox backend which is already completed. L15 does NOT re-implement outbox — it defines triggers, templates, privacy, and retry policy.
- Exam Lifecycle State Model (L13) is NOT covered by ADR-009. ADR-009 covers frontend interaction state machines only. L13 must be designed separately.

---

## 3. Top 5 Recommended Large Design Tasks

RBAC (L1/L2) 正在 active track 推进。以下 5 个 Exam Correctness Foundation Large Job 是 RBAC 之外的最高优先级设计任务：

| Order | Large Job | Why This Order |
| ----- | --------- | -------------- |
| 1 | **L16** Question Bank / Paper Versioning Model | 答案 payload 必须引用稳定的题目/试卷版本；L4 依赖 L16 |
| 2 | **L4** Answer Protocol v2 | 影响保存、提交、评分、审计；L5 和 L6 依赖 L4 |
| 3 | **L5** WYSIWYG Submit / Final Answer Barrier | 证明学生看到的最终答案等于后端冻结答案；L6 依赖 L5 |
| 4 | **L13** Exam Lifecycle State Model | 定义考试状态合法流转；L7、L6、L14 都依赖 L13 |
| 5 | **L14** Result Visibility / Release Policy | 影响成绩发布和学生可见性；L15、L20 依赖 L14 |

```text
L16 → L4 → L5 → L13 → L14 是一条最小依赖链。
完成这 5 个设计后，前端状态机 (L6)、监考权限 (L7)、通知策略 (L15) 才有稳定基础。
```

---

## 4. Recommended Large Design Order (Full Tracks)

### Track A — Active RBAC Track

```text
1. L1  Teacher / Proctor / Grader Account Model
2. L2  Backend Permission Model
3. L7  Proctor Runtime Authority Boundary
4. L3  Custom Role / Custom RBAC later
```

L1/L2 are current active. L7 waits for L1/L2 base stability. L3 is explicitly deferred to avoid premature RBAC complexity.

### Track B — Exam Correctness Design Track

```text
1.  L16 Question Bank / Paper Versioning Model
2.  L4  Answer Protocol v2
3.  L5  WYSIWYG Submit / Final Answer Barrier
4.  L13 Exam Lifecycle State Model
5.  L14 Result Visibility / Release Policy
6.  L9  Audit / Monitoring Full Event Taxonomy
7.  L6  Frontend Exam State Machine
8.  L11 Subjective / Rich Text / Drawing Answer Architecture
```

L6 ADR-009 exists but runtime spec waits for L4/L5/L13. L11 depends on L4 and L16.

### Track C — Productization / Ops Later

```text
1.  L8  UI Design / Workbench UI Contract
2.  L10 E2E Full Parallelization Implementation
3.  L15 Notification / Email Policy
4.  L17 Import / Export / Bulk Operation Contract
5.  L18 Deployment / On-Prem Ops Contract
6.  L19 Data Retention / Privacy / Audit Redaction
7.  L20 Reporting / Analytics / Score Statistics Model
```

---

## 5. Large Job Cards

---

## L1 — Teacher / Proctor / Grader Account Model

### Type

Large

### Status

**Active / In Progress.** L1 is part of the active RBAC track. Implementation PRs (account table, role assignment migration) may be in flight. This card records the architectural boundaries, non-goals, and derived Middle Jobs.

### Why Large

Account model touches every authenticated endpoint, the login flow, session shape, frontend role routing, and data isolation. Changing it without a complete design risks breaking all existing Admin/Candidate flows.

### Goal

Define the account and role assignment model for Teacher, Proctor, and Grader roles. Establish how `users.role` (primary role cache) and `user_role_assignments` (multi-role) coexist during migration.

### Key Decisions

1. What are the built-in roles? (Admin, Candidate, Teacher, Proctor, Grader, System)
2. Are Teacher/Proctor/Grader account types, roles, or role assignments?
3. Does the system support one-user-multiple-roles?
4. Is `users.role` kept as primary role cache during migration?
5. Does `user_role_assignments` support multi-role?
6. Is there a primary role concept?
7. Does the last-admin guard read `users.role` or `user_role_assignments`?
8. How is existing data backfilled?
9. What does a multi-role user see after login on the frontend?
10. Does role assignment have scope (org-level, exam-level)?

### Required Inputs

- `docs/phase3/audit/audit-current-role-checks.md` (S3)
- Current `packages/domain/src/enums.ts` Role definition
- Current `packages/contracts/src/` RoleSchema
- Current `packages/auth/src/rbac.ts`
- Current `apps/web/src/contexts/AuthContext.tsx` role routing

### Expected Outputs

- `docs/adr/ADR-0XX-account-role-assignment-model.md`
- Derived Middle Jobs: account table migration, role assignment migration, last-admin guard update, login response shape, frontend role routing

### Non-goals

- Do NOT implement Custom RBAC (that is L3)
- Do NOT implement full Proctor Authority (that is L7)
- Do NOT implement full Teacher dashboard
- Do NOT implement full Grader workflow
- Do NOT change candidate exam flow

### Grillme Questions

1. If a user has both Teacher and Proctor roles, which dashboard do they land on after login?
2. Can an Admin remove their own Admin role? What if they are the last Admin?
3. If `users.role` says "Admin" but `user_role_assignments` says "Teacher", which wins?
4. Can a Proctor also be a Candidate for the same exam?
5. Does the session JWT carry all roles, or just the primary role?
6. What happens when a Teacher role is revoked while they have an active grading session?
7. Is role assignment scoped to an organization, or is it global?
8. How does backfill handle existing users who have no role assignment row?
9. Can a Grader grade their own exam attempt if they also have Candidate role?
10. What is the database schema for `user_role_assignments`? Does it include scope columns?
11. How does the login endpoint communicate multi-role to the frontend?
12. Is there a "deactivate account" concept, or only role removal?

### Acceptance Criteria

- ADR is accepted by team review
- Built-in role list is finalized and matches `packages/domain/src/enums.ts`
- `users.role` migration strategy is documented
- `user_role_assignments` schema is documented
- Login response shape for multi-role users is defined
- Last-admin guard behavior is defined
- Derived Middle Jobs are listed with scope and non-goals

### Derived Middle Jobs

- Account table / role assignment migration
- Login response multi-role shape
- Last-admin guard update
- Frontend role routing helper
- Session JWT role claims update

### Dependencies

- None (this is a foundation for L2, L7)

### Review Standard

- Account model handles all 5 human roles
- Multi-role is supported without breaking existing Admin/Candidate flows
- Last-admin guard prevents orphaned admin state
- Backfill strategy is documented and reversible
- No Custom RBAC scope creep

---

## L2 — Backend Permission Model

### Type

Large

### Status

**Active / In Progress.** L2 is part of the active RBAC track. Permission matrix design and authorize helper implementation may be in flight. This card records architectural boundaries.

### Why Large

Permission model touches every API route, middleware, service layer, and frontend button. A wrong design creates either a security gap (too permissive) or an unusable system (too restrictive). It must be designed holistically.

### Goal

Define the backend permission model: permission definitions, role-to-permission mapping, authorize helper location, 403 error contract, and scope model.

### Key Decisions

1. Are permissions enum, string union, or DB-driven?
2. What is the permission matrix for Admin / Teacher / Proctor / Grader / Candidate?
3. Where does the authorize helper live — route, service, or repo layer?
4. How are 403 error codes unified?
5. Does the permission model support org / exam / course scope?
6. How do route-level guards and service-level guards cooperate?
7. Are denied actions recorded in audit log?
8. Does the contracts layer expose permissions to the frontend?
9. How does the frontend permission helper consume backend permissions?
10. Is permission evaluation cached or computed per request?

### Required Inputs

- `docs/phase3/audit/audit-current-role-checks.md` (S3)
- Current auth middleware (`packages/auth/src/`)
- Current route handlers with role checks
- L1 Account Model ADR (when available)

### Expected Outputs

- `docs/adr/ADR-0XX-backend-permission-model.md`
- `docs/phase3/matrices/permission-matrix.md`
- Derived Middle Jobs: authorize helper, route guards, 403 contract, permission tests

### Non-goals

- Do NOT implement Custom RBAC (that is L3)
- Do NOT implement Proctor full authority (that is L7)
- Do NOT rewrite all business flows
- Do NOT treat frontend permission as security boundary

### Grillme Questions

1. Can a single permission string encode both "what action" and "what scope"?
2. If a Teacher has `EDIT_EXAM` permission, can they edit any exam or only exams they own?
3. Does a Proctor with `FORCE_SUBMIT` permission need exam-level scope assignment?
4. What happens when a permission is added to the system — do all roles automatically get it or deny?
5. How does the authorize helper handle composite permissions (e.g., `VIEW_EXAM_ROOM` on a specific exam)?
6. Is the permission matrix stored in code, DB, or config?
7. Does the 403 response include which permission was missing?
8. Can the frontend cache permission decisions, or must it re-fetch on every page?
9. How does the permission model handle future roles without code changes?
10. Is there a "super admin" bypass for all permissions?
11. How does audit log capture denied access attempts?
12. Does the permission model distinguish between "read" and "write" at the scope level?

### Acceptance Criteria

- Permission matrix covers all 5 human roles
- Authorize helper location is decided and documented
- 403 error contract is unified
- Scope model (if any) is defined
- Derived Middle Jobs are listed

### Derived Middle Jobs

- Permission enum / constant definition
- Authorize helper implementation
- Route-level permission guards
- Service-level permission checks
- 403 error response contract
- Permission test suite
- Frontend permission helper

### Dependencies

- L1 Account Model (role list must be finalized first)

### Review Standard

- Permission matrix is complete for all roles
- No permission is defined without a corresponding deny test
- Frontend permission is explicitly not a security boundary
- Scope model (if any) is minimal and justified

---

## L3 — Custom Role / Custom RBAC

### Type

Large

### Status

**Later / Explicitly Deferred.** Custom RBAC must NOT be designed or implemented during the current RBAC track. The current focus is built-in roles only.

### Why Large

Custom RBAC is a known over-engineering trap. It requires dynamic role definition, permission inheritance, scope resolution, and a management UI. It must not be pulled into Phase 3 without clear product need.

### Goal

Define when and how custom roles would be introduced, if ever. Establish the boundary between built-in roles and custom roles.

### Key Decisions

1. Does Phase 3 need custom roles at all?
2. If yes, are custom roles a subset of built-in roles or fully dynamic?
3. How does custom role permission inherit from built-in roles?
4. Is there a role management UI?
5. Can custom roles be scoped to specific exams or courses?

### Required Inputs

- L1 Account Model ADR
- L2 Permission Matrix
- Product requirements from schools / organizations

### Expected Outputs

- `docs/adr/ADR-0XX-custom-role-rbac.md` (or explicit decision to NOT implement)

### Non-goals

- Do NOT implement custom roles in Phase 3
- Do NOT design dynamic permission resolution
- Do NOT build role management UI

### Grillme Questions

1. Has any real deployment requested custom roles?
2. Can built-in role + scope assignment cover 90% of real needs?
3. What is the maintenance cost of supporting dynamic roles?
4. How does custom RBAC interact with the audit log?
5. Can custom roles be exported / imported?
6. What happens to existing data when a custom role is deleted?
7. Is custom RBAC a Phase 4+ feature?
8. Can the permission model be extended without custom roles?

### Acceptance Criteria

- Decision is documented: implement later, or never
- If "later": boundary between built-in and custom is clear
- If "never": rationale is documented

### Derived Middle Jobs

- None in Phase 3

### Dependencies

- L1, L2 must be completed first

### Review Standard

- No custom role code exists in the codebase
- No custom role migration exists
- Decision is recorded in ADR

---

## L4 — Answer Protocol v2

### Type

Large

### Status

**Priority.** Should be designed after L16 Paper Versioning, because answer payloads must reference stable question/paper versions.

### Why Large

Answer protocol touches save, submit, grade, audit, force-submit, deadline-auto-submit, and frontend state machine. A change here ripples across the entire system.

### Goal

Define the canonical answer payload shape, save/submit protocol, versioning, conflict detection, and grading read path.

### Key Decisions

1. What is the canonical answer payload shape?
2. Are save and submit payloads consistent or different?
3. How are answer revision, clientSeq, and serverVersion defined?
4. How are empty / partial / invalid answers expressed?
5. How is JSON answer canonicalized?
6. Is a content hash required?
7. Do force-submit and deadline-submit reuse the same protocol?
8. How does the grading read path consume answers?
9. What is the conflict resolution strategy for concurrent saves?
10. How does answer versioning interact with paper versioning (L16)?

### Required Inputs

- `docs/phase3/audit/audit-current-answer-payload.md` (S8)
- Current `packages/exam-engine/src/answerProtocol.ts`
- Current `packages/domain/src/enums.ts` ConflictReason
- L16 Paper Versioning (must be designed first)

### Expected Outputs

- `docs/phase3/specs/answer-protocol-v2.md`
- Derived Middle Jobs: AnswerPayloadV2 schema, answer canonicalization helper, conflict resolution tests

### Non-goals

- Do NOT implement rich text / drawing answers (that is L11)
- Do NOT change grading algorithm
- Do NOT change frontend state machine (that is L6)
- Do NOT implement answer encryption

### Grillme Questions

1. If a candidate saves answer A, then the question is edited by admin, what happens to the saved answer?
2. Can two devices save different answers for the same question simultaneously?
3. What is the maximum answer payload size?
4. How does the system handle a save that arrives after submit?
5. Is the answer payload encrypted at rest?
6. Can the candidate see their submitted answer after submit?
7. How does force-submit generate the final answer snapshot?
8. What happens if the answer payload fails JSON validation on the server?
9. Does the answer protocol support partial question sets (e.g., adaptive exams)?
10. How does the grading engine handle answers from different paper versions?

### Acceptance Criteria

- Canonical payload shape is defined
- Save vs submit protocol is specified
- Conflict detection rules are documented
- Force-submit and deadline-submit paths are covered
- Derived Middle Jobs are listed

### Derived Middle Jobs

- AnswerPayloadV2 schema definition
- Answer canonicalization helper
- Conflict resolution tests
- Force-submit answer snapshot generation
- Grading read path adapter

### Dependencies

- L16 Paper Versioning (must be done first)

### Review Standard

- Payload shape covers all question types
- Conflict resolution is deterministic
- No answer data loss on save/submit race
- Grading path reads correct answer version

---

## L5 — WYSIWYG Submit / Final Answer Barrier

### Type

Large

### Status

**Priority.** Depends on L4 Answer Protocol.

### Why Large

The final answer barrier is the trust boundary between candidate interaction and backend frozen state. If this is wrong, grading is wrong, audit is wrong, and exam integrity is compromised.

### Goal

Define what the candidate sees as their final answer, how the backend freezes it, and how the system proves the frozen answer matches what was displayed.

### Key Decisions

1. What does the candidate see as their final answer before submit?
2. Must pending saves be flushed before submit?
3. Does the backend freeze an answer snapshot or current answer rows?
4. Does the final snapshot require a content hash?
5. How does deadline auto-submit handle unsaved answers?
6. How does force-submit generate the final snapshot?
7. Is any write allowed after submit success?
8. How does the audit trail prove the final answer?

### Required Inputs

- L4 Answer Protocol v2
- Current `apps/web/src/hooks/useSubmitFlush.ts` flush-before-submit logic
- Current `apps/web/src/pages/exam/TakeExamPage.tsx` submit flow

### Expected Outputs

- `docs/adr/ADR-0XX-final-answer-barrier.md`
- Derived Middle Jobs: final answer snapshot, submit hash, audit proof

### Non-goals

- Do NOT change answer protocol (that is L4)
- Do NOT change frontend state machine (that is L6)
- Do NOT implement post-submit answer viewing

### Grillme Questions

1. If the candidate clicks submit while a save is in flight, does submit wait for the save to complete?
2. What happens if flush succeeds but submit API fails — is the candidate allowed to re-submit?
3. Does the final snapshot include a hash of all answers?
4. Can the candidate see a "submission receipt" after submit?
5. If the backend freezes answer rows, what happens if a concurrent save arrives after freeze?
6. How does deadline auto-submit handle a question the candidate never touched?
7. Is the final snapshot stored in a separate table or as a JSON blob on the attempt?
8. How does the audit log prove which answers were in the final snapshot?
9. Can an admin view the final snapshot for audit purposes?
10. Does the barrier handle network partitions where submit succeeds on server but response is lost?

### Acceptance Criteria

- Final answer snapshot mechanism is defined
- Flush-before-submit requirement is documented
- Post-submit write prohibition is specified
- Audit trail for final answer is designed
- Derived Middle Jobs are listed

### Derived Middle Jobs

- Final answer snapshot generation
- Submit hash / content hash
- Audit trail for final answer
- Post-submit read-only enforcement

### Dependencies

- L4 Answer Protocol v2

### Review Standard

- Final answer is deterministic and reproducible
- No answer can be modified after submit success
- Audit trail can reconstruct the final answer
- Deadline and force-submit paths are covered

---

## L6 — Frontend Exam State Machine

### Type

Large

### Status

**ADR Started / Runtime Deferred.** ADR-009 (`docs/adr/ADR-009-frontend-state-machine-adoption.md`) defines the adoption strategy (reducer + transition table + tests, no XState). Runtime spec must wait for L4/L5/L13 conclusions.

### Why Large

The exam-taking page (`TakeExamPage.tsx`) has 19 state slots managing loading, saving, heartbeat, deadline, submit, flush, and disconnect. Without a formal model, race conditions and illegal state combinations are untestable.

### Goal

Define the CandidateExamMachine state shape, events, transitions, guards, and commands. Wire TakeExamPage to use the machine.

### Key Decisions

1. What are the orthogonal state dimensions (phase, connection, save, submit)?
2. What is the composed machine state shape?
3. What events trigger state transitions?
4. Which transitions are illegal and what happens on them?
5. How do commands / effects work in the useReducer pattern?
6. How does the machine interact with useSubmitFlush?
7. How does the machine handle deadline and heartbeat?
8. What is the AdminExamOperationMachine shape?

### Required Inputs

- `docs/adr/ADR-009-frontend-state-machine-adoption.md`
- `docs/phase3/audit/audit-current-candidate-runtime.md` (S7)
- L4 Answer Protocol v2
- L5 Final Barrier
- L13 Exam Lifecycle State Model

### Expected Outputs

- `docs/phase3/specs/candidate-exam-state-machine.md`
- `apps/web/src/lib/state-machines/candidateExamMachine.ts` (after design accepted)
- Derived Middle Jobs: machine spec, runtime integration, tests

### Non-goals

- Do NOT directly rewrite TakeExamPage without design
- Do NOT introduce XState in Phase A-C
- Do NOT invent business states (backend is authority)
- Do NOT implement Proctor state machine (that is separate)

### Grillme Questions

1. Can a candidate edit answers while the submit flush is in progress?
2. What happens if heartbeat fails 10 times in a row — is there a max retry?
3. How does the machine handle a network partition that lasts 30 minutes?
4. Can the machine recover from a "submitted" state if the backend rejects the submit?
5. How does the machine coordinate with ExamTimer's countdown?
6. What is the exact composed state shape (CandidateExamMachineState)?
7. How does the machine handle deadline reached during flush?
8. Can the machine be tested without mocking API calls?
9. How does the AdminExamOperationMachine differ from the candidate machine?
10. What happens to the machine state when the component unmounts mid-operation?

### Acceptance Criteria

- State shape and events are fully defined
- Transition table covers all valid and invalid transitions
- ADR-009 Phase A (spec + tests) is complete
- Runtime integration plan is documented
- Derived Middle Jobs are listed

### Derived Middle Jobs

- CandidateExamMachine transition table + tests
- Runtime integration (useReducer wiring)
- AdminExamOperationMachine
- Save/submit/deadline integration tests

### Dependencies

- ADR-009 (adoption strategy — completed)
- L4 Answer Protocol v2
- L5 Final Barrier
- L13 Exam Lifecycle State Model

### Review Standard

- All state transitions are tested
- Illegal transitions are no-ops with dev warnings
- Machine is pure (no side effects in transition function)
- Backend business state remains source of truth

---

## L7 — Proctor Runtime Authority Boundary

### Type

Large

### Status

**Priority — blocked by L1/L2 base.** Must NOT be mixed into current L1/L2 RBAC base PRs. Proctor authority requires Account Model, Permission Model, and Exam Lifecycle to be stable first.

### Why Large

Proctor authority defines what a proctor can see (candidate identity, answers, timeline), what they can do (force submit, extend time, flag misconduct), and what they cannot do (modify answers, change grades). This is a security-sensitive boundary.

### Goal

Define the Proctor authority matrix: permissions, data visibility, action boundaries, and audit requirements.

### Key Decisions

1. What data can a proctor see per candidate? (identity, answers, timeline, heartbeat)
2. What actions can a proctor take? (force submit, extend time, flag misconduct)
3. What data is a proctor explicitly forbidden from seeing?
4. Is proctor scope assigned per-exam or per-organization?
5. How does proctor authority interact with exam lifecycle states?
6. Does force-submit require a reason logged in audit?
7. Can a proctor extend time beyond the exam's closeAt?
8. How does proctor authority differ from admin authority?

### Required Inputs

- L1 Account Model ADR
- L2 Permission Matrix
- L13 Exam Lifecycle State Model
- Current proctor API routes

### Expected Outputs

- `docs/adr/ADR-0XX-proctor-authority-matrix.md`
- Derived Middle Jobs: proctor scope assignment, authority tests, audit logging

### Non-goals

- Do NOT implement proctor dashboard redesign
- Do NOT implement real-time proctor monitoring (WebSocket)
- Do NOT implement proctor-to-candidate messaging
- Do NOT mix into L1/L2 RBAC base PRs

### Grillme Questions

1. Can a proctor view a candidate's answers during the exam?
2. Can a proctor extend time for one candidate without affecting others?
3. Does force-submit generate an audit log entry with the proctor's identity?
4. Can a proctor flag misconduct after the exam is closed?
5. Is proctor authority scoped to specific exams, or is it global?
6. What happens if a proctor tries to grade a candidate's exam?
7. Can a proctor see other proctors' actions on the same exam?
8. How does the system prevent a proctor from becoming a candidate in the same exam?
9. What is the maximum time extension a proctor can grant?
10. Does the proctor authority matrix change based on exam lifecycle state?

### Acceptance Criteria

- Proctor authority matrix is complete
- Data visibility boundaries are explicit
- Action boundaries are explicit
- Audit requirements are defined
- Derived Middle Jobs are listed

### Derived Middle Jobs

- Proctor scope assignment (per-exam or per-org)
- Authority enforcement tests
- Audit logging for proctor actions
- Force-submit / extend-time / flag-misconduct API guards

### Dependencies

- L1 Account Model
- L2 Permission Model
- L13 Exam Lifecycle State Model

### Review Standard

- Every proctor action has a corresponding permission check
- Every data visibility rule has a deny test
- Audit trail captures all proctor actions
- No proctor action bypasses backend enforcement

---

## L8 — UI Design / Workbench UI Contract

### Type

Large

### Status

**Deferred.** Can be designed in parallel but must not block exam correctness foundation.

### Why Large

UI contract affects every page: component semantics, status badge grammar, table/form/action patterns, page templates, and responsive behavior. A wrong contract creates inconsistent UX across the entire platform.

### Goal

Define the UI design system: design tokens, component contracts, page templates, status grammar, and responsive patterns.

### Key Decisions

1. What are the design tokens (colors, spacing, typography)?
2. What component contracts exist (DataTable, FormLayout, StatusBadge)?
3. What page templates exist (list, detail, form, exam runtime)?
4. How is status expressed (badges, colors, icons)?
5. What is the responsive breakpoint strategy?
6. How are loading / error / empty states expressed?

### Expected Outputs

- `docs/ui/` design token spec (extend existing if present)
- Component contract documentation
- Page template documentation

### Non-goals

- Do NOT rewrite existing UI components
- Do NOT change the visual design system
- Do NOT implement new pages

### Grillme Questions

1. Are status badges consistent across admin and candidate views?
2. Do all tables use the same column resize / sort / filter pattern?
3. How are form validation errors expressed consistently?
4. What is the standard empty state illustration strategy?
5. How does the UI handle long Chinese text in tables?
6. What is the mobile breakpoint for exam-taking pages?

### Acceptance Criteria

- Design token spec is documented
- Component contracts cover 80% of existing usage
- Page templates cover admin and candidate views
- Status grammar is consistent

### Derived Middle Jobs

- Design token alignment
- Component contract tests
- Page template migration (one page at a time)

### Dependencies

- None (parallel track)

### Review Standard

- Existing pages match the contract
- No new components are introduced
- Status expression is consistent

---

## L9 — Audit / Monitoring Full Event Taxonomy

### Type

Large

### Status

**Priority.** Should be designed before L15 and L19.

### Why Large

Event taxonomy defines what is recorded, what is observable, what is private, and what is retained. A wrong taxonomy creates either audit gaps or privacy violations.

### Goal

Define the full event taxonomy: audit events, monitoring events, privacy rules, retention policy, and event schema.

### Key Decisions

1. What is the complete list of audit events?
2. What is the complete list of monitoring events?
3. How are audit and monitoring events distinguished?
4. What data is forbidden in event payloads?
5. What is the event schema (flat vs structured)?
6. How are events correlated (traceId, requestId)?
7. What is the event retention policy?
8. How are events exported for external systems?

### Expected Outputs

- `docs/adr/ADR-0XX-event-taxonomy.md`
- Event schema definition
- Privacy rules document

### Non-goals

- Do NOT implement a monitoring platform
- Do NOT implement event streaming (Kafka, etc.)
- Do NOT implement event analytics dashboard

### Grillme Questions

1. Should candidate answer content ever appear in audit events?
2. How are events from different services correlated?
3. What is the minimum retention period for audit events?
4. Can audit events be deleted by an admin?
5. How are events handled when the audit log table is full?
6. Should monitoring events include request/response bodies?
7. How does the event taxonomy handle future event types?
8. What is the performance impact of audit logging on hot paths?

### Acceptance Criteria

- Event taxonomy covers all current and planned events
- Privacy rules are explicit and enforced
- Retention policy is documented
- Derived Middle Jobs are listed

### Derived Middle Jobs

- Audit event enum expansion
- Monitoring event schema
- Privacy enforcement tests
- Event retention policy implementation

### Dependencies

- S6 Current Audit Event Map (completed)

### Review Standard

- No event contains forbidden data
- Audit and monitoring are clearly separated
- Retention policy is implementable

---

## L10 — E2E Full Parallelization Implementation

### Type

Large

### Status

**Later.** Depends on M10 readiness report and L9 event taxonomy.

### Why Large

E2E parallelization touches database isolation, seed management, test fixture strategy, and CI pipeline. Wrong implementation creates flaky tests and false confidence.

### Goal

Enable E2E tests to run in parallel without shared state conflicts.

### Expected Outputs

- `docs/adr/ADR-0XX-e2e-isolation.md`
- Derived Middle Jobs: DB isolation, seed isolation, worker config

### Non-goals

- Do NOT implement parallel E2E in Phase 3 without design
- Do NOT change unit/integration test strategy

### Grillme Questions

1. Can each Playwright worker have its own database?
2. How are seed data conflicts resolved between parallel workers?
3. What is the CI time improvement from parallelization?
4. How do tests that share candidate/attempt data handle isolation?

### Acceptance Criteria

- Isolation strategy is documented
- CI improvement is estimated
- Derived Middle Jobs are listed

### Derived Middle Jobs

- Worker DB isolation
- Seed data isolation
- CI pipeline config

### Dependencies

- M10 E2E readiness report
- L9 Event Taxonomy

### Review Standard

- Parallel tests do not interfere
- CI time improvement is measurable
- No flaky tests introduced

---

## L11 — Subjective / Rich Text / Drawing Answer Architecture

### Type

Large

### Status

**Priority.** Depends on L4 and L16.

### Why Large

Subjective answers (rich text, drawings, file attachments) require a fundamentally different answer storage, rendering, and grading architecture than multiple-choice or fill-blank.

### Goal

Define the architecture for subjective answer types: storage format, rendering, grading workflow, and file attachment handling.

### Expected Outputs

- `docs/adr/ADR-0XX-subjective-answer-architecture.md`

### Non-goals

- Do NOT implement rich text editor
- Do NOT implement drawing canvas
- Do NOT implement file upload UI

### Grillme Questions

1. How are rich text answers stored — HTML, Markdown, or custom format?
2. Where are drawing answers stored — SVG, bitmap, or coordinates?
3. How are file attachments linked to answers?
4. Can subjective answers be auto-graded?
5. How does the grading workflow handle long-form text?
6. What is the maximum answer size for subjective questions?

### Acceptance Criteria

- Storage format is defined
- Rendering strategy is defined
- Grading workflow is specified

### Derived Middle Jobs

- Subjective answer schema
- Rich text renderer
- Drawing answer storage
- File attachment handler

### Dependencies

- L4 Answer Protocol v2
- L16 Paper Versioning

### Review Standard

- All subjective answer types have storage and rendering specs
- Grading workflow covers all types
- No security risks from unsanitized rendering

---

## L12 — Tenant / Organization / School Scope Model

### Type

Large

### Status

**Priority.** Should be designed before L1 and L2, because scope determines role boundaries.

### Why Large

Tenant scope affects data isolation, permission boundaries, exam ownership, and cross-organization data access. Wrong scope model creates data leakage or unusable multi-org deployments.

### Goal

Define the organization/tenant scope model: how data is partitioned, how users relate to organizations, and how cross-scope access is controlled.

### Expected Outputs

- `docs/adr/ADR-0XX-tenant-scope-model.md`

### Non-goals

- Do NOT implement multi-tenant routing
- Do NOT implement cross-organization data sharing
- Do NOT implement tenant management UI

### Grillme Questions

1. Is each deployment single-tenant or multi-tenant?
2. Does every business table have an `organizationId` column?
3. Can a user belong to multiple organizations?
4. How does scope affect permission evaluation?
5. What happens when an organization is deleted?
6. Is there a "default organization" for single-tenant deployments?

### Acceptance Criteria

- Scope model is documented
- Data isolation rules are explicit
- Cross-scope access is denied by default

### Derived Middle Jobs

- Scope column audit
- Scope guard implementation
- Cross-scope denial tests

### Dependencies

- None (foundation for L1, L2)

### Review Standard

- All business tables have scope column (or justified exception)
- Scope guard prevents cross-org access
- Single-tenant mode works without scope overhead

---

## L13 — Exam Lifecycle State Model

### Type

Large

### Status

**Priority.** Must be designed as an independent Large Job, NOT covered by ADR-009.

### Why Large

Exam lifecycle defines the legal state transitions for exams. Wrong transitions create impossible states (e.g., editing a published exam, reopening a closed exam). This affects admin operations, candidate access, proctor authority, and grading.

### Goal

Define the exam lifecycle: state枚举, legal transitions, side effects, and guards for each transition.

### Key Decisions

1. What is the complete exam status枚举?
2. What are the legal transitions between states?
3. Are `published` and `open` separate states?
4. Can `cancel` or `archive` be reversed?
5. Is `extend` only allowed on `open` exams?
6. Is `release results` a status or a timestamp field?
7. How do `closeAt`, `openAt`, and `publishAt` interact with status?
8. How does exam lifecycle relate to candidate attempt status?

### Required Inputs

- `packages/domain/src/enums.ts` ExamStatus
- Current `apps/api/src/routes/exam.ts` status transitions
- `docs/adr/ADR-005-exam-operation-state-baseline.md`

### Expected Outputs

- `docs/adr/ADR-0XX-exam-lifecycle-state-model.md`
- State diagram (Mermaid or equivalent)
- Derived Middle Jobs: lifecycle transition guards, status contract tests

### Non-goals

- Do NOT implement frontend state machine (that is L6)
- Do NOT change existing transitions without design
- Do NOT implement exam scheduling system

### Grillme Questions

1. If an exam is `open` and the `closeAt` passes, does it auto-transition to `closed`?
2. Can a `closed` exam be `reopened`?
3. If an exam is `canceled`, can candidates still see their submitted results?
4. Does `archive` remove the exam from all lists?
5. Can an admin `extend` a `published` (not yet `open`) exam?
6. What is the difference between `publish results` and `release results`?
7. If an exam has `canceled` status, can proctors still force-submit?
8. How does the lifecycle handle exams with no `closeAt` (untimed)?

### Acceptance Criteria

- State枚举 is finalized
- Legal transitions are documented
- State diagram is produced
- Side effects for each transition are listed
- Derived Middle Jobs are listed

### Derived Middle Jobs

- Lifecycle transition guard implementation
- Status contract tests
- Auto-transition (close on deadline) implementation
- Admin operation state machine integration (ADR-009 PR 5)

### Dependencies

- `docs/adr/ADR-005-exam-operation-state-baseline.md` (existing)

### Review Standard

- Every transition has a guard and a test
- No illegal transitions are possible through the API
- State diagram matches the code

---

## L14 — Result Visibility / Release Policy

### Type

Large

### Status

**Priority.** Depends on L13.

### Why Large

Result visibility affects candidate experience, grader workflow, and audit compliance. Wrong policy creates premature score leaks or permanent score invisibility.

### Goal

Define when and how exam results become visible to candidates, teachers, graders, and admins.

### Key Decisions

1. When can a candidate see their result?
2. Is result release exam-level or candidate-level?
3. Can results be released before grading is complete?
4. Is partial result release supported?
5. Is there a review / appeal process?
6. Can results be revoked after release?
7. How do teacher / admin / grader visibility differ?
8. Is release recorded in audit?

### Expected Outputs

- `docs/adr/ADR-0XX-result-visibility-release-policy.md`

### Non-goals

- Do NOT implement result release UI
- Do NOT implement score appeal workflow
- Do NOT implement score statistics (that is L20)

### Grillme Questions

1. If grading is pending, what does the candidate see on the result page?
2. Can an admin release results for one candidate but not others?
3. If a result is released, then grading is corrected, does the candidate see the updated score?
4. Is there a "results embargo" period after exam ends?
5. Can a teacher see candidate answers before results are released?
6. How does result visibility interact with `resultPublicationMode`?

### Acceptance Criteria

- Release policy covers all roles
- Visibility rules are explicit
- Audit trail for release is designed

### Derived Middle Jobs

- Result visibility guard
- Release API endpoint
- Audit logging for release

### Dependencies

- L13 Exam Lifecycle State Model

### Review Standard

- No premature score leaks
- All roles see appropriate data
- Release is auditable

---

## L15 — Notification / Email Policy

### Type

Large

### Status

**Later.** Email backend is already completed. L15 defines policy, not infrastructure.

### Why Large

Notification policy affects user experience, privacy, and system load. Wrong triggers create email spam; wrong privacy creates compliance violations.

### Goal

Define notification triggers, templates, privacy constraints, retry policy, and audit requirements. Do NOT re-implement email outbox.

### Key Decisions

1. Which events trigger email notifications?
2. What email templates are needed?
3. What privacy constraints apply to email content?
4. What is the retry policy for failed emails?
5. Can users opt out of notifications?
6. Are notifications recorded in audit?

### Expected Outputs

- `docs/adr/ADR-0XX-notification-email-policy.md`

### Non-goals

- Do NOT re-implement email outbox (already done in M3)
- Do NOT implement email templates
- Do NOT implement email UI
- Do NOT接真实 SMTP

### Grillme Questions

1. Should candidates receive an email when results are published?
2. Should graders receive an email when new grading tasks are assigned?
3. Can an admin disable all email notifications?
4. What happens if email delivery fails 5 times — is the event lost?
5. Should email content include candidate answers?
6. Is there a daily email rate limit per user?

### Acceptance Criteria

- Trigger rules are documented
- Privacy constraints are explicit
- Retry policy is defined

### Derived Middle Jobs

- Email trigger configuration
- Template definitions
- Privacy enforcement tests
- Retry policy implementation

### Dependencies

- Email outbox backend (M3 — completed)
- L9 Event Taxonomy
- L14 Result Release Policy

### Review Standard

- No sensitive data in emails
- Retry policy is implementable
- Users can opt out

---

## L16 — Question Bank / Paper Versioning Model

### Type

Large

### Status

**Priority / High Priority.** Must be designed before L4, because answer payloads reference question/paper versions.

### Why Large

Question versioning affects exam creation, answer snapshots, grading comparisons, audit trails, and export. Without versioning, editing a published exam's question creates ambiguity about which version candidates answered.

### Goal

Define question bank versioning: how questions are versioned, how exam papers are snapshotted, and how grading references the correct version.

### Key Decisions

1. Are questions editable after creation?
2. Does publishing an exam create a paper snapshot?
3. Does an attempt use the current question value or the published snapshot?
4. Which question version is used during grading?
5. Which paper version is used during export?
6. Does editing a question create a new version?
7. Does deleting a question affect historical exams?
8. How is the paper snapshot audited?

### Required Inputs

- Current `packages/db/src/schema.ts` question and exam tables
- Current exam creation flow
- Current attempt creation (question snapshot mechanism)

### Expected Outputs

- `docs/adr/ADR-0XX-question-bank-paper-versioning.md`
- Derived Middle Jobs: versioning schema, snapshot generation, version reference in grading

### Non-goals

- Do NOT implement question bank UI redesign
- Do NOT implement random paper generation (that is a separate feature)
- Do NOT implement question difficulty tagging

### Grillme Questions

1. If a question is edited after an exam is published, do existing attempts see the old or new version?
2. Does the system create a new question version on every edit, or only on exam-relevant changes?
3. Can an admin view the exact paper snapshot that candidates saw?
4. How does the grading engine know which question version to compare against?
5. If a question is deleted, does it disappear from historical exam records?
6. What is the storage cost of paper snapshots for large exams?
7. Can two exams share the same paper snapshot?
8. How does export handle questions from different versions?

### Acceptance Criteria

- Versioning mechanism is defined
- Paper snapshot creation is specified
- Grading version reference is documented
- Derived Middle Jobs are listed

### Derived Middle Jobs

- Question version schema
- Paper snapshot generation
- Version reference in attempt/grading
- Snapshot audit trail

### Dependencies

- None (foundation for L4, L11)

### Review Standard

- Every question in an exam has a deterministic version
- Paper snapshots are immutable after creation
- Grading references the correct version

---

## L17 — Import / Export / Bulk Operation Contract

### Type

Large

### Status

**Later.** Depends on L4, L16, and L9.

### Why Large

Import/export touches data format, error handling, permission checks, audit logging, and partial failure handling. Wrong contract creates data corruption or silent failures.

### Goal

Define the import/export contract: supported formats, error reporting, permission requirements, and audit logging.

### Expected Outputs

- `docs/adr/ADR-0XX-import-export-contract.md`

### Non-goals

- Do NOT implement import/export UI
- Do NOT implement PDF export
- Do NOT implement batch scoring

### Grillme Questions

1. What formats are supported for question import?
2. What happens when 3 out of 10 rows fail validation during import?
3. Can a Teacher import questions, or only an Admin?
4. Are import operations logged in audit?
5. What is the maximum import file size?

### Acceptance Criteria

- Supported formats are defined
- Error handling strategy is documented
- Permission requirements are explicit

### Derived Middle Jobs

- Import format spec
- Error reporting format
- Audit logging for import/export

### Dependencies

- L4 Answer Protocol
- L16 Paper Versioning
- L9 Event Taxonomy

### Review Standard

- Partial failures are handled correctly
- Audit trail covers all import/export operations

---

## L18 — Deployment / On-Prem Ops Contract

### Type

Large

### Status

**Later.** Depends on L9 and current deployment infrastructure.

### Why Large

LAN/on-premise deployment requires configuration management, backup strategy, upgrade procedures, and diagnostic tooling. Wrong ops contract creates unmanageable deployments.

### Goal

Define the operations contract: configuration, backup, upgrade, diagnostic, and support procedures.

### Expected Outputs

- `docs/adr/ADR-0XX-ops-contract.md`

### Non-goals

- Do NOT implement Kubernetes deployment
- Do NOT implement cloud deployment
- Do NOT implement auto-scaling

### Grillme Questions

1. What is the backup strategy for PostgreSQL?
2. How are configuration changes applied without downtime?
3. What is the upgrade procedure?
4. How does the system handle database migration failures?
5. What diagnostic tools are available to operators?

### Acceptance Criteria

- Backup strategy is documented
- Upgrade procedure is documented
- Diagnostic runbook exists

### Derived Middle Jobs

- Backup script
- Upgrade script
- Diagnostic runbook

### Dependencies

- L9 Event Taxonomy

### Review Standard

- Backup can be restored
- Upgrade is reversible
- Diagnostics cover all infrastructure components

---

## L19 — Data Retention / Privacy / Audit Redaction

### Type

Large

### Status

**Later.** Depends on L9.

### Why Large

Data retention affects compliance, storage costs, and audit capabilities. Wrong retention policy creates legal risk or data loss.

### Goal

Define data retention, privacy, and audit redaction policies.

### Expected Outputs

- `docs/adr/ADR-0XX-retention-privacy-redaction.md`

### Non-goals

- Do NOT implement data deletion UI
- Do NOT implement GDPR compliance tools
- Do NOT implement audit log archival

### Grillme Questions

1. How long are candidate answers retained?
2. Can audit logs be redacted?
3. What happens when retention period expires?
4. Are email contents retained?
5. Can candidates request data deletion?

### Acceptance Criteria

- Retention periods are defined
- Privacy rules are documented
- Redaction strategy is specified

### Derived Middle Jobs

- Retention policy implementation
- Redaction helper
- Privacy compliance tests

### Dependencies

- L9 Event Taxonomy

### Review Standard

- Retention periods are enforceable
- Privacy rules cover all data types
- Redaction does not break audit integrity

---

## L20 — Reporting / Analytics / Score Statistics Model

### Type

Large

### Status

**Later.** Depends on L13 and L14.

### Why Large

Reporting affects data aggregation, privacy, export formats, and performance. Wrong model creates slow queries or inaccurate statistics.

### Goal

Define the reporting and analytics model: score statistics, pass rates, ranking, and export formats.

### Expected Outputs

- `docs/adr/ADR-0XX-reporting-analytics.md`

### Non-goals

- Do NOT implement analytics dashboard
- Do NOT implement real-time reporting
- Do NOT implement external BI integration

### Grillme Questions

1. What score statistics are computed? (mean, median, pass rate, distribution)
2. Can statistics be computed per-exam, per-course, or per-time-period?
3. Are statistics available to teachers, or only admins?
4. What export formats are supported for reports?
5. How do statistics handle partially graded exams?

### Acceptance Criteria

- Statistics model is defined
- Export formats are specified
- Privacy rules for statistics are documented

### Derived Middle Jobs

- Statistics computation engine
- Report export format
- Privacy filtering for statistics

### Dependencies

- L13 Exam Lifecycle
- L14 Result Visibility

### Review Standard

- Statistics are accurate and reproducible
- Export formats are well-defined
- Privacy is enforced
