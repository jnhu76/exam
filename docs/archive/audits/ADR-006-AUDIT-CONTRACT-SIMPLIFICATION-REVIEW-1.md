# ADR-006 AUDIT CONTRACT SIMPLIFICATION AND ADVERSARIAL RE-REVIEW

## 0. Review verdict

```text
ADR-006 AUDIT CONTRACT RE-REVIEW:
CORRECTIVE REQUIRED

BLOCKING FINDINGS:
F-SCOPE
F-A-WIDTH
F-SAVE-ANSWER
F-AUTH
F-B-MUTATION
F-C-SHUTDOWN
F-ACTIVE
F-EVIDENCE
F-PROCESS
F-STORAGE
F-NOOP-EVENTS
F-WRITER-BYPASS

CURRENT COMMITS:
DO NOT MERGE AS M10-F

AUDIT CORRECTIVE:
NOT CLOSED

M10-F:
MUST BE RERUN AFTER CORRECTIVE MERGES
```

The PostgreSQL transaction changes reviewed here generally use the same lexical
`tx` for business and audit writes. That local property is not the reason for
this rejection. The review rejects the corrective because it broadens the audit
availability boundary far beyond the proven product obligation, puts answer
saves and automatic domain transitions on that boundary, leaves authentication
semantics incomplete, contradicts the declared best-effort shutdown contract,
and overstates runtime coverage from a compile-time-complete enum.

This report distinguishes findings using the following labels:

- **PROVEN DEFECT** — current repository evidence directly contradicts the
  claimed contract or required process.
- **ACCEPTED TRADEOFF** — a cost is proportionate and supported by an authority
  document or an explicit policy decision.
- **UNIMPLEMENTED RESERVED ACTION** — vocabulary exists but no production
  emitter is wired.
- **FUTURE PRODUCT DECISION** — the repository has no current authority for the
  stronger policy; it must not be represented as implemented.
- **NON-BLOCKING OPTIMIZATION** — useful improvement that is not required to
  restore contract correctness.

## 1. Review method and authority

The review was read-only until every finding below had a disposition. It
inspected the complete diff from the requested base, all declared audit actions,
all non-test audit writer callsites, transaction wrappers, scanners, CLI scripts,
email services, authentication branches, schemas, repositories, frontend save
behavior, and the new tests.

Primary authorities used:

- `docs/SPEC.md`, especially §3.5, §3.8, §6.3, and §6.4.
- `docs/phase-roadmap.md` and the repository `AGENTS.md` phase rules.
- `docs/code-quality.md` logging, repository, testing, and review rules.
- `docs/adr/ADR-006-exam-time-authority.md`.
- `docs/testing/test-system-contract.md`.
- `docs/dev/test-flakes.md`.

Framework behavior was checked against official documentation through
Context7. Fastify documents that `close()` rejects new work and runs `onClose`
after in-flight requests complete; child plugin close hooks run before parent
hooks. Postgres.js documents that `sql.end({ timeout })` force-closes pending
connections after a finite deadline and can reject with
`CONNECTION_DESTROYED`. Those facts support a bounded resource close, but do
not justify making a best-effort audit plugin mutate global process policy.

The `code-review` and `code-review-and-quality` skills were used. The latter's
referenced `security-checklist.md` and `performance-checklist.md` files were not
present in the installed skill tree, so no claim is made that those missing
resources were read. The five axes in the available skill — correctness,
readability, architecture, security, and performance — were applied directly.

CodeRabbit 0.6.5 independently reviewed the committed diff. Its output was
treated as untrusted review input and verified against local code; §12 records
the disposition.

## 2. Branch and scope integrity

The required commands produced:

```text
BRANCH:                   verify/rbac-M10-F
BASE_SHA:                 fcc3d74d3e4a9c7adf0c9883c625e9efaff1a059
REVIEW_HEAD:              23bb3639ad117259d74ee39e36def67c28953d27
COMMITS_AFTER_BASE:       5
FILES_CHANGED:            43
PRODUCTION_FILES_CHANGED: 30
TEST_FILES_CHANGED:       10
DOC_FILES_CHANGED:        3
DIFF_SIZE:                +2211 / -1299
PRE_REPORT_WORKTREE:      clean
REMOTE_M10_F_TIP:         d0f1676
```

Commits after the requested base:

```text
0d60ab8 test(audit): prove mutation-audit atomicity gaps
695cf0a fix(audit): make critical mutation audits transactional
fb304ab fix(audit): bound shutdown audit drain
c7e33de docs(adr): close audit durability and shutdown contract
23bb363 test(audit): allow transactional save-answer wrapper
```

### F-SCOPE — P0 PROCESS BLOCKER — PROVEN DEFECT

`verify/rbac-M10-F` is verification-only, but the reviewed range changes 30
production files and more than 3,500 total lines. The M10-F final-verification
evidence at `077b13f` and the remote follow-up at `d0f1676` predate these audit
behavior changes. This is not repaired by renaming the branch.

Required disposition:

1. Do not push `0d60ab8..23bb363` as part of the M10-F verification PR.
2. Rebase/cherry-pick the audit work onto an approved dedicated corrective
   branch whose base contains any explicitly accepted lifecycle prerequisite.
3. Correct and review the audit contract there.
4. Merge the audit corrective independently.
5. Recreate and rerun M10-F evidence from the resulting master. Old M10-F
   evidence cannot be relabelled as post-corrective evidence.

## 3. Vocabulary reconstruction and lifecycle totals

```text
DECLARED_ACTIONS:                            58
ACTIVE_ACTIONS:                              55
RESERVED_ACTIONS:                             3
DEPRECATED_ACTIONS:                           0
UNREACHABLE_ACTIONS:                          0
ACTIONS_WITH_ZERO_WIRED_PRODUCTION_CALLSITES: 3
ACTIONS_WITH_MULTIPLE_UNEXPLAINED_CALLSITES:  0
SEMANTIC_OVERLAP_REQUIRING_CLARIFICATION:     attempt.restore
```

The three zero-wired actions are `email.outbox_created`, `email.send_failed`,
and `email.send_retried`. Their service classes invoke an optional
`auditEmitter` callback, but no production composition supplies that callback.
They are **RESERVED**, not active coverage. `attempt.restore`,
`user.role_changed`, `candidate.import`, and `login.failure` have multiple
source locations with mechanically identifiable branches. The callsites are
not unexplained, although `attempt.restore` still has overlapping semantics
between an idempotent start and an explicit restore.

### Complete action/callsite matrix

Abbreviations in the table:

- `TX` — `recordTransactionalAudit(tx, ...)`.
- `DIRECT-TX` — `createAuditLogRepo(tx).create(...)`, bypassing the category
  writer.
- `SYNC` — `recordDurableAudit(rootDb, ...)` before response.
- `BE` — `recordBestEffortAudit(...)` through the lifecycle registry.
- `D` — review classification: canonical domain state/history, not a
  transaction-critical security audit. It does not require adding a production
  `D` enum.

| Action | Lifecycle | Active production callsite | Trigger / expected frequency | Writer | Transaction | Current failure effect | Review disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin.bootstrap` | ACTIVE | `scripts/bootstrap-admin.ts` | Local bootstrap; once per installation/recovery | DIRECT-TX | User + role + audit, same tx | Script fails; all roll back | Keep A; route through typed non-HTTP atomic writer |
| `admin.password_reset.local` | ACTIVE | `scripts/reset-admin-password.ts` | Rare local recovery | DIRECT-TX | Password + audit, same tx | Script fails; password rolls back | Keep A; typed non-HTTP atomic writer |
| `login.success` | ACTIVE | `routes/auth.ts` | Every successful login | SYNC | Standalone audit before cookie header | Audit failure causes authentication outage/500 | Move off B; platform security log plus tenant best-effort event |
| `login.failure` | ACTIVE | `routes/auth.ts` | Every known-tenant credential/authority denial | SYNC | Standalone tenant audit | Audit failure changes normal 401 to 500 | Move off B; platform security log; tenant audit only after tenant resolution |
| `logout` | ACTIVE | `routes/auth.ts` | At most once per logout request | BE | No business tx | 204 preserved; loss logged | Genuine C |
| `auth.profile_update` | ACTIVE | `routes/auth.ts` | Rare self-service name update | TX | User + audit, same tx | Audit failure rejects profile update | C/D; no security obligation proves A |
| `auth.password_update` | ACTIVE | `routes/auth.ts` | Rare credential change | TX | Password + audit, same tx | Audit failure rolls back password | Keep A |
| `attempt.start` | ACTIVE | `routes/attempts.candidate.ts` | Normally once per candidate attempt | TX | Attempt/enrollment + audit | Audit failure prevents start | D; attempt row is canonical lifecycle state |
| `attempt.saveAnswer` | ACTIVE | `routes/attempts.candidate.ts` | Every accepted debounced save, including accepted replay | TX | Answer + audit, same tx | Audit failure rejects a valid save | D; remove from security-audit critical path |
| `attempt.submit` | ACTIVE | `orchestrators/submitAndGradeAttempt.ts` | Submit request; currently also idempotent retries | TX | Submit/grading + audit, same tx | Audit failure rejects submit/retry | A only for the real first transition; suppress/reclassify replays |
| `attempt.restore` | ACTIVE | `routes/attempts.candidate.ts` | Existing-attempt start branch and explicit resume | TX | Restore/start tx + audit | Audit failure prevents recovery | D; canonical status/deadline/lastActivity state |
| `attempt.forceSubmit` | ACTIVE | `routes/attempts.admin.ts` | Rare privileged intervention | TX | Submit/grading + audit | Audit failure rolls back intervention | Keep A |
| `attempt.extendTime` | ACTIVE | `routes/attempts.admin.ts` | Rare privileged fairness change | TX | Deadline + audit | Audit failure rolls back extension | Keep A |
| `attempt.misconductFlagged` | ACTIVE | `routes/attempts.admin.ts` | Rare proctor/admin record | TX | Misconduct JSON + audit | Audit failure rolls back flag | Keep A while audit is overwrite history; reconsider dedicated incident history |
| `attempt.exported` | ACTIVE | `routes/attempts.admin.ts` | Sensitive answer export; rare | SYNC | Standalone audit before export | Audit failure denies export | Keep B; SPEC treats sensitive/result export as auditable |
| `attempt.autoSubmit` | ACTIVE | `plugins/deadlineScanner.ts` | At most one real deadline transition per attempt | DIRECT-TX | Submit/grading + audit | Scanner item rolls back and retries | D; system lifecycle state is canonical, not actor security evidence |
| `attempt.disrupted` | ACTIVE | `plugins/heartbeat.ts` | Once per disconnect cycle | DIRECT-TX | Status + audit | Scanner item rolls back and retries | D; do not make recovery depend on compliance table |
| `branding.update` | ACTIVE | `routes/settings.ts` | Rare organization display update | TX | Settings + audit | Audit failure rejects update | C/D; not a security setting |
| `candidate.create` | ACTIVE | `routes/candidate.ts` | Admin creates login identity; low frequency | TX | User/role/profile + audit | Audit failure rolls all back | Keep A because it creates an account/authority row |
| `candidate.update` | ACTIVE | `routes/candidate.ts` | Routine identity-field/name update | TX | Candidate/user + audit | Audit failure rejects update | C; current state is canonical and action lacks change details |
| `candidate.import` | ACTIVE | `routes/candidate.ts` | Once per accepted input row | TX | Per-row create/update + audit | Audit outage becomes row-level INTERNAL_ERROR | Split semantics; use canonical import job + proportionate summary, not blanket per-row A |
| `candidate.password_reset` | ACTIVE | `routes/user.ts` | Rare credential reset | TX | Password + audit | Audit failure rolls back reset | Keep A |
| `candidate_field.create` | ACTIVE | `routes/candidateField.ts` | Rare configuration CRUD | TX | Field + audit | Audit failure rejects CRUD | C/D |
| `candidate_field.update` | ACTIVE | `routes/candidateField.ts` | Rare configuration CRUD | TX | Field + audit | Audit failure rejects CRUD | C/D |
| `candidate_field.delete` | ACTIVE | `routes/candidateField.ts` | Rare configuration CRUD | TX | Field + audit | Audit failure rejects CRUD | C unless an explicit irreversible-compliance policy is adopted |
| `course.create` | ACTIVE | `routes/course.ts` | Routine authoring CRUD | TX | Course + audit | Audit failure rejects CRUD | C/D |
| `course.update` | ACTIVE | `routes/course.ts` | Routine authoring CRUD | TX | Course + audit | Audit failure rejects CRUD | C/D |
| `course.delete` | ACTIVE | `routes/course.ts` | Draft/reference-constrained deletion | TX | Course + audit | Audit failure rejects delete | C unless explicit irreversible-policy evidence exists |
| `enrollment.add` | ACTIVE | `routes/exam.ts` | Per candidate assignment | TX | Enrollment + audit | Failed item rolls back | Keep A: changes exam eligibility |
| `enrollment.remove` | ACTIVE | `routes/exam.ts` | Per candidate removal | TX | Enrollment + audit | Removal rolls back | Keep A: changes exam eligibility |
| `exam.create` | ACTIVE | `routes/exam.ts` | Routine draft creation | TX | Exam + audit | Audit failure rejects create | C/D |
| `exam.update` | ACTIVE | `routes/exam.ts` | Draft edit or published schedule edit | TX | Exam/reconciliation + audit | Audit failure rejects update | Split: draft edits C/D; published schedule changes A |
| `exam.publish` | ACTIVE | `routes/exam.ts` | Once per publish transition | TX | Snapshot/status + audit | Audit failure rolls back publish | Keep A |
| `exam.unpublish` | ACTIVE | `routes/exam.ts` via transition executor | Rare privileged rewind | TX | Status + audit | Audit failure rolls back | Keep A |
| `exam.close` | ACTIVE | `routes/exam.ts` via transition executor | Explicit admin close | TX | Status + audit | Audit failure rolls back | Keep A |
| `exam.cancel` | ACTIVE | `routes/exam.ts` via transition executor | Exceptional irreversible action | TX | Status + audit | Audit failure rolls back | Keep A |
| `exam.archive` | ACTIVE | `routes/exam.ts` via transition executor | Rare lifecycle settlement | TX | Status + audit | Audit failure rolls back | Keep A |
| `exam.delete` | ACTIVE | `routes/exam.ts` | Draft deletion | TX | Delete + audit | Audit failure rolls back | Keep A as irreversible admin action |
| `exam.extend` | ACTIVE | `routes/exam.ts` via transition executor | Rare schedule/fairness change | TX | closeAt + audit | Audit failure rolls back | Keep A |
| `exam.publish_results` | ACTIVE | `routes/exam.ts` | Result visibility command; repeat is idempotent | TX | Visibility timestamp + audit | Audit failure rejects real or repeat command | Keep A only on real publication; define repeat as command observation or suppress |
| `exam.open` | ACTIVE | `routes/reconciliation.ts` callers | Automatic time reconciliation | TX | Status + audit | Read/mutation request can fail due audit | D; domain transition, no human actor evidence |
| `exam.closed` | ACTIVE | `routes/reconciliation.ts` callers | Automatic time reconciliation | TX | Status + audit | Read/mutation request can fail due audit | D; domain transition, no human actor evidence |
| `question.create` | ACTIVE | `routes/question.ts` | Routine authoring CRUD | TX | Question + audit | Audit failure rejects CRUD | C/D |
| `question.update` | ACTIVE | `routes/question.ts` | Routine authoring CRUD | TX | Question + audit | Audit failure rejects CRUD | C/D; published attempts use snapshots |
| `question.delete` | ACTIVE | `routes/question.ts` | Reference-constrained deletion | TX | Delete + audit | Audit failure rejects delete | C unless explicit irreversible policy exists |
| `question.import` | ACTIVE | `routes/question.ts` | One confirmed batch | TX | Whole batch + one audit | Audit failure rolls back entire batch | C/D; audit availability should not reject authoring batch absent policy |
| `user.create` | ACTIVE | `routes/user.ts` | Admin account/role creation | TX | User/assignment + audit | Audit failure rolls all back | Keep A |
| `user.update` | ACTIVE | `routes/user.ts` | Name, active status, and role-compatible projection | TX | User/assignment + audit | Audit failure rejects all variants | Split: disable/reactivate A; profile-only update C; role already has dedicated A action |
| `user.delete` | ACTIVE | `routes/user.ts` | Permanent account deletion | TX | Delete + audit | Audit failure rolls back | Keep A |
| `export_scores` | ACTIVE | `routes/export.ts` | Sensitive/bulk result export | SYNC | Standalone audit before CSV | Audit failure denies export | Keep B; explicitly supported by SPEC §6.4 |
| `grading.score_entered` | ACTIVE | `routes/gradingQueue.ts` | Per manual grade/overwrite | TX | Entry/attempt + audit | Audit failure rolls back score | Keep A; audit preserves prior-score and actor history |
| `grading.finalized` | ACTIVE | `routes/gradingQueue.ts` | Last manual grade may finalize attempt | TX | Terminal projection + audit | Audit failure rolls back finalization | Keep A; distinct terminal event, but document double-row behavior |
| `grading.detail_viewed` | ACTIVE | `routes/gradingQueue.ts` | Sensitive candidate-answer access | SYNC | Standalone audit before response | Audit failure denies grading detail | Keep B only as explicit privacy-over-availability policy; record that policy in product authority |
| `user.role_changed` | ACTIVE | `routes/roleAssignments.ts`, `routes/user.ts` | Every authority assignment/promotion/deactivation/removal | TX | Assignment/projection + audit | Audit failure rolls back authority change | Keep A |
| `email.outbox_created` | RESERVED | No wired emitter; optional callback in `notificationService.ts` | None in production | Optional callback only | None | No production effect | Remove from ACTIVE claims; durable outbox row already owns state |
| `email.send_failed` | RESERVED | No wired emitter; optional callback in `outboxService.ts` | None in production | Optional callback only | None | No production effect | Operational log/metric if wired; not actor compliance audit by default |
| `email.send_retried` | RESERVED | No wired emitter; optional callback in `outboxService.ts` | None in production | Optional callback only | None | No production effect | Operational log/metric if wired; not actor compliance audit by default |
| `proctor.incident_marked` | ACTIVE | `routes/proctorMonitoring.ts` | Explicit proctor/admin incident command | SYNC | Audit row is the only persisted business record | Audit failure rejects command | Reclassify as A-like canonical mutation or use a dedicated incident table; it is not a sensitive read |

## 4. Classification reassessment

### F-A-WIDTH — P1 REQUIRED — PROVEN DESIGN DEFECT

The policy assigns 48 of 58 actions to A. The implementation rule is visibly
`mutation -> A`, with only reads/auth/C exceptions. The SPEC requires a minimal
audit set and says all sensitive operations are audited; it does not state that
routine authoring CRUD, candidate runtime state, automatic reconciliation, or
branding must fail when `audit_logs` cannot insert.

This width creates harms not balanced by unique evidence:

- Routine authoring and identity-field updates fail for an audit-table-specific
  error even though canonical rows already capture the requested state.
- Candidate runtime operations fail on an ancillary compliance insert.
- Scanner recovery and time reconciliation roll back canonical state and retry
  because a secondary timeline insert failed.
- Bulk candidate imports turn audit failures into per-row business errors;
  confirmed question imports roll back the entire batch.
- Several audit payloads contain only actor/target/requestId, with no before/after
  values, so they do not justify making the audit row more available than the
  canonical state.

The table above gives a provisional narrower disposition. Mixed actions such
as `user.update`, `exam.update`, and `candidate.import` must be split by
semantic operation or assigned the least disruptive common contract; a broad
name must not hide a security-critical subcase.

### Accepted A tradeoffs

Atomic audit remains proportionate for authority changes, credential changes,
account deletion/creation, eligibility changes, privileged exam transitions,
result publication, manual grading history, force submit, time extension, and
misconduct history. These operations either have irreversible/security effects
or the audit row carries actor/previous-value evidence not recoverable from the
latest canonical row.

### D/domain-history direction

`attempt.start`, `attempt.saveAnswer`, `attempt.restore`,
`attempt.autoSubmit`, `attempt.disrupted`, `exam.open`, and `exam.closed` are
domain lifecycle facts. Their canonical state, answer version, timestamps, or
scanner transition already live in the business model. If a full transition
timeline is a product requirement, it should have an explicit domain-history
owner; it should not silently make the compliance table an exam-runtime
dependency.

## 5. Mandatory high-frequency review

### Evidence and assumptions

The current frontend uses a **1,500 ms per-question debounce**, not a periodic
1.5-second save. Each accepted request writes the latest answer/version and,
after this corrective, one `attempt.saveAnswer` audit row. The generic audit
repository performs an INSERT and then a SELECT readback for every event.

No production telemetry establishes question count, answer-change rate,
concurrency shape, or exam duration. The estimates below therefore use an
explicit illustration, not a capacity claim:

```text
Illustrative exam duration:          60 minutes
Illustrative questions:              50
Accepted save episodes per question: 1.2
Accepted saves per candidate:        60
```

| Event | Per candidate | Per exam formula | 100 candidates | 1,000 candidates | Rows/minute under stated illustration | Additional DB work |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `attempt.saveAnswer` | `S` accepted episodes; illustration 60 | `N*S` | 6,000 | 60,000 | 100 / 1,000 average | Per event: one audit INSERT, one index entry, one readback SELECT, shared tx latency/WAL |
| `attempt.start` | Normally 1 | `N` | 100 | 1,000 | If arrivals span 5 min: 20 / 200 | Same INSERT + SELECT pattern |
| `attempt.restore` | `R`, driven by disconnect/reload | `N*R` | Unknown | Unknown | No telemetry; burst follows network recovery | Same INSERT + SELECT pattern |
| `attempt.autoSubmit` | 0 or 1 real transition | `N*p(deadline)` | Up to 100 | Up to 1,000 | Can burst in one 30-second scanner tick | Same INSERT + SELECT pattern inside scanner tx |
| Heartbeat request | 2/minute at current 30-second interval | `2N/min` | 200 API writes/min | 2,000 API writes/min | **0 audit rows** | Updates `lastActivityAt`; only later `attempt.disrupted` is audited |

The 60-save illustration yields 60,000 audit rows for one 1,000-candidate
exam. Actual volume may be lower or higher. A single-choice change usually
produces one save; pausing while editing text, revisiting questions, network
retries, and idempotent replays increase it. The per-question debounce also
allows pending saves for multiple questions when the candidate navigates.

### F-SAVE-ANSWER — P0 PRODUCT/AVAILABILITY BLOCKER — PROVEN DEFECT

The current route awaits `recordTransactionalAudit` after an accepted save.
Therefore an audit INSERT failure rolls back a valid answer and returns an
error. An idempotent replay produces no answer update in the engine but still
writes an audit row, turning the compliance insert into the only mutation.

The saved answer JSONB already retains question ID, value, version, client
sequence, and server save time; `lastActivityAt` is also updated. The audit row
does not contain answer content or even the question ID, so it supplies little
unique save evidence beyond actor/request/IP. No authority says rejecting a
valid answer is preferable to accepting it without that duplicate row.

Consequences:

- `audit_logs` is now part of the answer-save availability boundary.
- An audit-table-specific trigger, permission, index, or storage failure rejects
  otherwise valid saves.
- Shared WAL, index, cache, and query pressure can degrade the core exam path.
- The table's only index does not support attempt timeline lookups, so the new
  volume also degrades reads by target.

Required disposition: remove `attempt.saveAnswer` from transaction-critical
security audit. Use canonical answer version/history as the source of truth;
retain bounded operational telemetry only if needed. Any proposal to keep A
must supply an explicit product/legal requirement plus a measured capacity and
failure-budget decision.

## 6. Authentication audit model

### Current behavioral matrix

| Scenario | Organization known? | Tenant audit possible? | Current public response | Current log/evidence | Required evidence |
| --- | ---: | ---: | --- | --- | --- |
| Malformed body/type | No handler execution | No | 400 validation response | Generic request/error handling; no named auth event | Bounded validation event if security policy requires; never fabricate tenant |
| Unknown default organization | No | No | Generic 401 | Pino warning with `unknown_organization`, slug, username | Platform security log |
| Unknown user | Yes | Yes | Generic 401 | Synchronous tenant `login.failure`, reason `invalid_credentials` | Platform auth decision + optional tenant audit |
| Invalid password | Yes | Yes | Generic 401 | Same as unknown user | Same public/evidence shape as unknown user |
| Disabled user | Yes | Yes | Generic 401 | Same as unknown user | Same public/evidence shape; no account enumeration |
| No active assignment | Yes | Yes | Generic 401 | Tenant `login.failure` plus pino warning | Platform reason plus tenant event |
| Authority load/integrity failure | Yes | Technically, but authority unavailable | 503 `AUTHZ_UNAVAILABLE` | Pino error; no tenant audit | Platform operational/security error; do not disguise as bad credentials |
| Non-login primary role | Yes | Yes | Generic 401 | Tenant `login.failure` plus pino warning | Platform reason plus tenant event |
| Credentials and authority accepted | Yes | Yes | 200 with cookie header | Tenant `login.success` committed before `setCookie` | Define event as authentication/session issuance accepted, not cookie delivery |

`LoginRequestSchema.username` has no maximum length. Known-tenant failures copy
the supplied username into both `targetId` and JSON metadata, so the audit sink
accepts attacker-controlled data up to the HTTP body limit. This is a payload
bound defect independent of the durability category.

### F-AUTH — P1 REQUIRED — PROVEN CONTRACT GAP

`login.failure` is declared durable B, but unknown-organization failures cannot
write it. Known-tenant audit failure also converts a normal authentication
denial from 401 to 500, making the audit table an authentication availability
dependency. The current model is neither globally complete nor uniformly
tenant-scoped.

Chosen review model:

```text
PLATFORM SECURITY LOG:
all authentication decisions that occur before or outside a proven tenant,
including unknown organization, malformed input policy, authority failure,
and sanitized failure reasons.

TENANT AUDIT:
only after organization identity is established; it must not fabricate an
organization ID and should not turn ordinary credential denial into 500.
```

The platform log must keep the public response uniform for unknown user,
invalid password, and disabled user. A global organization-less audit table is
not justified for Phase 1 and is not recommended.

`login.success` currently means: credentials and assignment authority were
accepted, a JWT was signed, and the tenant audit committed; the cookie header
is attached immediately afterward. It does **not** prove that a client received
or used the cookie. ADR wording must use “authentication/session issuance
accepted,” not “cookie successfully issued” or “first authenticated request.”

## 7. Duplicate, overlap, and no-op semantics

| Group | Current evidence | Disposition |
| --- | --- | --- |
| `attempt.misconductFlagged` / `proctor.incident_marked` | First updates `exam_attempts.misconduct` with actor/time/severity/notes and writes audit. Second stores only an audit row with incident type/reason/note. Separate endpoints can represent the same real-world misconduct. | Distinct storage today, overlapping product meaning. Pick one canonical incident model; do not have one UI action call both. |
| `attempt.exported` / `export_scores` | Individual attempt-answer export vs exam-level score CSV. | Distinct sensitive reads; no duplicate. |
| `exam.open` / `exam.closed` / `exam.close` | `open/closed` are automatic reconciliation results. `close` is an explicit admin command. Transition executor suppresses `exam.close` when reconciliation already closed the exam. | Distinct and currently duplicate-safe; move automatic actions to D/domain history. |
| `grading.score_entered` / `grading.finalized` | The final manual question intentionally emits a per-question score-history row and a terminal-finalization row. | Distinct; document the two-row behavior. Keep failure proof for both branches. |
| `user.update` / `user.role_changed` | A PATCH that changes role emits both generic update and authority-change rows. | Intentional but generic row is redundant for role-only changes; split payload semantics or suppress generic duplicate. |
| `attempt.restore` | Emitted both when start returns an existing attempt and by explicit restore. | No same-request duplicate, but action conflates “existing attempt returned” with a state restoration. Clarify/rename semantics. |
| `attempt.saveAnswer` | Accepted idempotent replay does not update answers but still emits the action. | False mutation semantics and avoidable volume; suppress/remove. |
| `attempt.submit` | `submitAndGradeAttempt.finish()` emits even when the attempt is already `graded`. | Idempotent retries create duplicate submit rows; emit only on real transition or use a distinct observation. |
| `exam.publish_results` | Repeat command emits another row with `alreadyPublished: true` although the visibility timestamp is unchanged. | Decide command-attempt versus state-transition semantics; current A description says mutation but records both. |

### F-NOOP-EVENTS — P1 REQUIRED — PROVEN DEFECT

The ADR claims an A “business mutation committed iff audit committed” model,
but several A actions deliberately produce audit rows without a business
mutation. That is not a PostgreSQL atomicity failure; it is an event-semantics
failure. Tests must distinguish a command attempt, an idempotent replay, and a
real state transition.

### F-B-MUTATION — P1 REQUIRED — PROVEN TAXONOMY DEFECT

`proctor.incident_marked` is classified B even though it is not a sensitive
read. Its audit row is the only durable business record. Synchronous failure is
correct for the current endpoint, but the category and rationale are wrong.
Treat it as an A-like canonical incident mutation or create a dedicated incident
table and audit that mutation. Do not use B merely to avoid a transaction.

## 8. Transaction evidence by architecture family

No production callsite was found casting a root `Database` to
`TransactionDatabase`. Apart from the central cast inside
`executeInTransaction`, reviewed A helper callsites use the same lexical `tx`
for business and audit repositories. This is positive repository evidence.
It is not equivalent to failure proof for every architecture family.

| Architecture family | Active current-A examples | Transaction creation / audit site | Same tx observed | Deterministic audit-failure rollback test |
| --- | --- | --- | ---: | --- |
| Simple route-owned transaction | auth mutation, course, settings, candidate field, question CRUD, exam publish/delete/results | `executeInTransaction` in route; TX writer inside callback | Yes | `exam.publish_results` only |
| Admin-invariant / role-assignment wrapper | `user.update/delete`, `user.role_changed` | `mutateWithEffectiveAdminPostcondition` or route tx | Yes | Role assignment and user delete |
| Candidate runtime composition | start/save/restore | Route-owned locked transaction | Yes | No audit-insert failure test |
| Service-owned submit/grading orchestration | `attempt.submit` | `submitAndGradeAttempt` creates tx and closes over it | Yes | No audit-insert failure test; no no-op duplicate test |
| Exam transition executor / reconciliation | unpublish/close/cancel/archive/extend/open/closed | `executeAdminExamTransition` or `reconcileExamForRead` | Yes | No audit-insert failure test for this family |
| Background scanner | auto-submit/disrupted | Per-attempt `executeInTransaction`; DIRECT-TX | Yes | No audit-insert failure rollback test |
| CLI/bootstrap | bootstrap/reset | Script `executeInTransaction`; DIRECT-TX | Yes | No audit-insert failure rollback test |
| Bulk/partial import | candidate per row; question whole batch | Per-row tx or batch tx | Yes | No audit-insert failure test for either boundary |
| Manual grading | score/finalization | Locked route transaction | Yes | `grading.score_entered`; finalization branch not separately failed |

The branded type is a useful compile-time boundary, but it does not by itself
prove runtime inventory completeness. In particular:

- scanners and scripts call `createAuditLogRepo(tx).create` directly, bypassing
  action/category validation;
- `createAuditLogRepo` accepts a plain `string` action;
- `auditArchitecture.test.ts` scans a hard-coded file list rather than all
  production sources;
- its direct-writer test checks only four named files and only a text pattern;
- a new module can be missed without failing the inventory test;
- transaction-bound role repository methods receive both a tx-bound repo and
  a separate `tx` argument, so the type cannot prove those two handles are the
  same transaction even though current callsites pass the same variable.

### F-EVIDENCE — P1 REQUIRED — PROVEN COVERAGE GAP

The four rollback tests are real and valuable, but they do not establish all
48 A callsites or all materially different transaction architectures. Add one
real audit-insert rollback test per retained A architecture family, after the A
set is narrowed. Avoid multiplying tests for actions that should no longer be A.

### F-WRITER-BYPASS — P1 REQUIRED — PROVEN ARCHITECTURE GAP

The ADR says the category-aware API is the audit boundary, but scanners and CLI
scripts bypass it. Create a typed non-HTTP/system atomic writer that accepts a
transaction plus explicitly bounded actor/request metadata. Do not fabricate a
Fastify request merely to reuse the HTTP helper. Then forbid direct production
audit-repository creates outside that owning module.

## 9. Category B availability review

| B action | If `audit_logs` is unavailable today | Availability harm | Review disposition |
| --- | --- | --- | --- |
| `login.success` | Login returns 500; no cookie | Organization-wide authentication outage | Move to platform security log + tenant best-effort event; B not proven |
| `login.failure` | Normal denial becomes 500 | Amplifies attack/audit outage and contradicts unknown-org path | Move to platform security log; never require tenant row before tenant exists |
| `attempt.exported` | Export denied | Emergency answer export unavailable | Keep B only as explicit privacy/compliance policy; current data sensitivity supports it |
| `export_scores` | Export denied | Emergency result export unavailable | Keep B: SPEC explicitly requires result export audit |
| `grading.detail_viewed` | Grading detail denied | Grading outage | Keep B as explicit privacy-over-availability decision; elevate that decision to product authority |
| `proctor.incident_marked` | Incident command fails | Proctor workflow unavailable | Failure is appropriate because row is the command's only persistence, but reclassify as mutation |

B is not a substitute for an outbox decision. No generic outbox is recommended.
After removing authentication and moving proctor incident to its owning
mutation class, B should contain only the sensitive reads for which denial on
audit failure is explicitly accepted.

## 10. Category C, shutdown, and process ownership

### F-C-SHUTDOWN — P1 REQUIRED — PROVEN CONTRACT CONTRADICTION

The ADR calls C explicitly lossy and says loss is accepted, but a stalled C
event logs `fatal` and sets non-zero process exit. With the currently active C
set, one stalled logout audit can mark an otherwise normal deployment shutdown
as failed. If reserved email emitters were later wired, duplicate email
observations could do the same even though the durable outbox row already owns
the email state.

Chosen review policy:

```text
GENUINE BEST-EFFORT C:
- stop accepting new work;
- bounded drain;
- warning/error with pending count on timeout;
- abandon pending observations;
- normal shutdown;
- loss remains explicitly accepted.
```

If an event must produce a non-zero shutdown, it is not C and needs durable
ownership before acknowledgement.

### F-PROCESS — P1 REQUIRED — PROVEN ARCHITECTURE DEFECT

`auditLifecyclePlugin` mutates `process.exitCode`. This contaminates embedded
Fastify use and tests with module-global process state. The lifecycle also
returns `AuditDrainResult`, but the public `drainAuditWrites(): Promise<void>`
decoration discards it, preventing the server owner from applying policy.

Required separation:

```text
audit lifecycle:
returns { timedOut, pendingCount } and owns no process-global decision

server signal owner:
logs/chooses process policy after app close according to event durability
```

For genuine C, the server should not select non-zero merely because the drain
timed out. Postgres.js's finite `sql.end({ timeout })` remains a valid final
resource bound. The existing DB-order test is useful and shows accepted audit
work normally settles before pool close.

## 11. Payload, privacy, storage, and query model

### Payload inventory

Positive findings:

- No reviewed audit payload includes a password, password hash, JWT, cookie,
  authorization header, raw candidate answer, or standard answer.
- `attempt.saveAnswer` records no answer body.
- grading-detail access records IDs, not candidate/standard answers.
- misconduct notes are capped at 1,000 characters; proctor notes at 500 and
  reason codes at 100.

Gaps:

- `AuditTarget.metadata` is an unrestricted `Record<string, unknown>` with no
  per-action schema or serialized-byte cap.
- `targetType`, `targetId`, full user-agent, and central request-derived fields
  have no audit-specific storage cap.
- login username is unbounded and duplicated into `targetId` and metadata.
- proctor free-text notes can contain PII or answer material despite a comment
  saying they must not; no content policy can prove otherwise.
- reserved `email.outbox_created` metadata contains recipient email and subject;
  it should not become actor compliance data by accidental wiring.

### Storage and query evidence

`audit_logs` has one index: `(organizationId, createdAt)`. Current queries also
filter by action and by `(targetType, targetId)` for attempt/proctor timelines.
No matching target/action index exists. There is no retention, archive,
partition, quota, or table-size alert. The SPEC defers compliance retention,
which was tolerable for a low-volume minimal audit but is not evidence for a
per-answer event stream.

The supposedly append-only repository spreads the generic CRUD repository,
therefore exposing `update` and `delete` methods. No route currently exposes
them, but the code-level append-only claim is not enforced. Each audit create
also performs a SELECT readback whose result callers discard.

### F-STORAGE — P1 REQUIRED — PROVEN EVIDENCE GAP

The corrective introduces high-frequency transaction-critical writes without
a benchmark, row-growth budget, query plan, payload limit, retention decision,
or matching timeline index. It therefore has not proven that audit index or
storage pressure cannot degrade exam runtime.

Required disposition:

1. Remove high-frequency domain events from transaction-critical audit first.
2. Add per-action payload schemas/allowlists and a serialized-size ceiling.
3. Bound username/target/user-agent fields and minimize PII.
4. Give audit logs an append-only repository interface; do not expose generic
   update/delete.
5. Use an insert-only method without unnecessary readback when callers need no
   row.
6. Measure retained volume and `EXPLAIN` target/action queries before adding
   indexes; likely candidates are org/target/time and org/action/time.
7. Define operational size monitoring and a retention/archive decision before
   any event stream is promoted to high frequency.

Index/readback work is a **NON-BLOCKING OPTIMIZATION** after classification is
fixed; payload bounds and removal of the save hot path are required.

## 12. Test value review and independent second opinion

### Test classification

| Test/change | Classification | Disposition |
| --- | --- | --- |
| `auditAtomicity.test.ts` role/user/result/grading trigger cases | REAL DEFECT PROOF | Retain; resize around the final A families |
| Category B login audit failure/cookie suppression | REAL DEFECT PROOF | Retain behavior mechanism, but authentication policy must change |
| Lifecycle deferred-promise/fake-timer timeout tests | REAL DEFECT PROOF | Retain bounded drain; change fatal/non-zero expectation for genuine C |
| `auditArchitecture.test.ts` exact object-key equality | TYPE-LEVEL DUPLICATION | `satisfies Record<AuditActionKey,...>` already proves enum-key completeness |
| Type-only A-versus-C target assertion | TYPE-LEVEL DUPLICATION | Keep at most one compile-time boundary proof |
| Hard-coded `productionFiles` text scan | ARCHITECTURE CONFORMANCE + IMPLEMENTATION-DETAIL LOCK | Incomplete today; replace with recursive/owned-boundary conformance |
| Four-file direct-writer text scan | ARCHITECTURE CONFORMANCE | Useful intent, but bypasses category/action validation and omits future files |
| `answer-protocol-ownership` regex adjustment | IMPLEMENTATION-DETAIL LOCK | Necessary only because the broad corrective wrapped save in a transaction; reassess after removing save audit |
| Removal of audit polling for A/B assertions | REAL SEMANTIC IMPROVEMENT | Retain; committed A/B rows should be immediately visible |

Missing mutation checks required after simplification:

- retained A family uses root DB or moves its audit after the callback;
- direct repository writer bypasses category validation;
- B response resolves before the audit promise;
- actual logout still returns 204 when C write rejects;
- idempotent save/submit/result-publication does not create a false transition;
- two helpers do not emit duplicate logical actions;
- ACTIVE action has no wired production emitter;
- RESERVED action is incorrectly counted as ACTIVE.

### F-ACTIVE — P1 REQUIRED — PROVEN DEFECT

`KNOWN_PRODUCTION_AUDIT_ACTIONS` includes the three reserved email actions and
the architecture test validates the manual constant against the enum, not
against runtime composition. Enum completeness is therefore being reported as
production coverage. Direct repo writers additionally bypass the runtime
assertion entirely.

Separate vocabulary lifecycle (`ACTIVE`, `RESERVED`, `DEPRECATED`) from
durability. Generate or recursively verify active emitter inventory from the
production composition boundary. An optional callback with no injected
implementation must remain RESERVED.

### CodeRabbit disposition

CodeRabbit reported five findings:

1. **Valid, subsumed by F-WRITER-BYPASS:** bootstrap script bypasses the
   category-aware writer.
2. **Valid, subsumed by F-WRITER-BYPASS:** reset-password script bypasses it.
   The suggested HTTP writer cannot be used directly because CLI has no
   `FastifyRequest`; the correct remedy is a typed non-HTTP writer.
3. **Rejected as not actionable:** the M10-D comment now accurately says audit
   absence is checked after awaited transactional boundaries; it does not
   promise a settle window.
4. **Valid, subsumed by F-ACTIVE/F-EVIDENCE:** the hard-coded architecture scan
   omits `export.ts`, `reconciliation.ts`, `examTransitionExecutor.ts`, and
   other possible production owners.
5. **Non-blocking consistency suggestion:** serialize exam extend Dates to ISO
   explicitly. JSONB serialization already converts `Date` through JSON, but
   explicit ISO strings would make payload shape clearer.

The independent tool did not identify the branch-scope, high-frequency,
availability, authentication, process ownership, or retention findings. Its
clean completion is therefore not merge approval.

## 13. Mandatory finding dispositions

| Finding | Severity | Classification | Disposition |
| --- | --- | --- | --- |
| `F-SCOPE` | P0 | PROVEN DEFECT | Move corrective to independent branch/PR; regenerate M10-F afterward |
| `F-A-WIDTH` | P1 | PROVEN DESIGN DEFECT | Narrow A by obligation, not mutation syntax; split mixed actions |
| `F-SAVE-ANSWER` | P0 | PROVEN DEFECT | Remove audit criticality from answer saves unless contrary policy + capacity evidence is approved |
| `F-AUTH` | P1 | PROVEN CONTRACT GAP | Platform security log before tenant; tenant audit only after resolution; no 500 for ordinary denial |
| `F-B-MUTATION` | P1 | PROVEN TAXONOMY DEFECT | Treat proctor incident as canonical mutation/domain record, not B read |
| `F-C-SHUTDOWN` | P1 | PROVEN CONTRADICTION | Genuine C uses warning + bounded abandon + normal shutdown |
| `F-ACTIVE` | P1 | PROVEN DEFECT | Separate lifecycle from durability; reserved email actions cannot count as active |
| `F-EVIDENCE` | P1 | PROVEN COVERAGE GAP | One rollback proof per retained architecture family |
| `F-PROCESS` | P1 | PROVEN ARCHITECTURE DEFECT | Lifecycle reports result; server owns process policy |
| `F-STORAGE` | P1 | PROVEN EVIDENCE GAP | Bound payloads, remove hot path, enforce append-only interface, measure growth/query plans |
| `F-NOOP-EVENTS` | P1 | PROVEN DEFECT | Separate state transitions from idempotent command attempts and suppress duplicates |
| `F-WRITER-BYPASS` | P1 | PROVEN ARCHITECTURE GAP | Typed HTTP and non-HTTP writers; forbid direct production repository inserts elsewhere |

Accepted tradeoffs:

- Direct same-PostgreSQL transaction remains the smallest correct mechanism
  for the narrower retained A set.
- Synchronous B can remain for explicitly policy-approved sensitive exports and
  grading-answer access.
- C loss on crash/SIGKILL is acceptable when shutdown also treats it as genuine
  best-effort.
- The current finite Postgres.js pool-close timeout is an appropriate final
  resource bound.

Unimplemented/reserved:

- All three `email.*` audit actions.
- Global organization-less audit storage.
- Compliance retention/archive policy and external log shipping.

Future product decisions:

- Whether grading-detail access must be denied during an audit outage.
- Whether full exam/attempt transition history needs a dedicated domain table.
- Whether proctor incidents share the misconduct model or require their own
  append-only incident entity.

## 14. Corrective sequence — no implementation performed by this review

1. Move the audit commits off `verify/rbac-M10-F`; do not push them with M10-F.
2. Establish an action definition that separates lifecycle status, durability,
   security obligation, frequency class, and payload schema.
3. Remove RESERVED email actions from active-coverage claims.
4. Narrow A using the matrix above; split mixed actions such as user/exam update.
5. Remove `attempt.saveAnswer` and automatic domain transitions from the audit
   availability boundary; fix idempotent/no-op event semantics.
6. Implement the platform authentication security-log model without changing
   public enumeration behavior.
7. Reclassify proctor incident and rationalize overlapping incident actions.
8. Make C shutdown genuine best-effort and move process policy to `server.ts`.
9. Centralize typed HTTP and non-HTTP writers; eliminate direct repo bypasses.
10. Add payload bounds, an append-only repository surface, volume measurement,
    and only evidence-backed indexes/retention guidance.
11. Add real rollback tests per retained transaction architecture family and
    runtime ACTIVE/RESERVED conformance tests.
12. Run full verification for the corrective PR, merge it independently, then
    rerun and republish M10-F evidence from post-corrective master.

No generic event bus, Kafka, Redis stream, workflow engine, or general-purpose
outbox is justified by this review.

## 15. Final decision

```text
CLASSIFICATION:
NOT PROPORTIONATE

AVAILABILITY COUPLING:
NOT ACCEPTED OR PROVEN

TRANSACTION COVERAGE:
CURRENT CALLSITES LOOK TRANSACTION-AFFINE; FAILURE EVIDENCE INCOMPLETE

AUTHENTICATION AUDIT:
INCOMPLETE AND INTERNALLY INCONSISTENT

SHUTDOWN CONTRACT:
CONTRADICTORY

BRANCH SCOPE:
CONTAMINATED

MERGE DISPOSITION:
REQUEST CHANGES
```

## 16. Corrective disposition (added after the independent verdict)

This section records the implementation disposition. It does not rewrite or
weaken the independent verdict in §0/§15.

```text
CORRECTIVE_BRANCH: fix/adr-006-audit-contract
CORRECTIVE_BASE:   ff87f219407dd37c8ef1f32723ea2faaf9266867
M10-F BRANCH:      unchanged by the corrective
M10-F STATUS:      INVALIDATED — MUST BE RERUN AFTER CORRECTIVE MERGES
```

| Finding | Corrective status | Evidence/disposition |
| --- | --- | --- |
| `F-SCOPE` | **CLOSED** | Audit production changes are on the dedicated corrective branch based on the merged M10-F result. No corrective commit is added to `verify/rbac-M10-F`; post-corrective M10-F evidence remains required. |
| `F-A-WIDTH` | **CLOSED** | Five policy dimensions are explicit. Atomic durability is narrowed from 48/58 to 28/62 declared actions and is selected by authority/credential/privileged obligation rather than mutation syntax. Mixed user/exam/import actions are split. |
| `F-SAVE-ANSWER` | **CLOSED** | Start/save/restore/auto-submit/disruption/open/closed are deprecated domain-history vocabulary with zero production emitter. A valid or idempotent answer save writes canonical answer state and zero audit rows. |
| `F-AUTH` | **CLOSED** | Pre-tenant failures use sanitized platform security logs; tenant events begin only after organization resolution and are best effort. Ordinary tenant-audit failure cannot turn login success/401 denial into 500. Username input and recorded identifiers are bounded. |
| `F-B-MUTATION` | **CLOSED** | `proctor.incident_marked` is atomic, not a sensitive read. The current minimal model treats its append-only row as the canonical incident mutation; `attempt.misconductFlagged` remains a distinct attempt-state mutation and no command emits both. |
| `F-C-SHUTDOWN` | **CLOSED** | Best-effort timeout returns pending count, warns, abandons observations, and continues normal shutdown without a nonzero code. |
| `F-ACTIVE` | **CLOSED** | Lifecycle is independent from durability: 51 ACTIVE, 3 RESERVED email actions, and 8 DEPRECATED. Reserved actions have no production emitter and do not count as runtime coverage. |
| `F-EVIDENCE` | **CLOSED** | Deterministic trigger tests cover route-owned transaction, admin-invariant/role wrapper, submit/grading service, exam transition executor, CLI/bootstrap, per-row bulk import, and manual grading/finalization. Business failure/no-op tests prove no false successful audit. |
| `F-PROCESS` | **CLOSED** | The lifecycle module owns only scheduling/drain state and never mutates process policy. `server.ts` owns signals and logs the best-effort timeout decision. |
| `F-STORAGE` | **CLOSED**, retention **DEFERRED PRODUCT DECISION** | Strict per-action schemas, common field/byte bounds, append-only no-readback writer, hot-path removal, current indexes, measured local size, and three query plans are documented. No speculative index was added. Retention/archive duration remains unapproved and is explicitly not claimed. |
| `F-NOOP-EVENTS` | **CLOSED** | Submit and result-publication audits occur only for the first state transition; role-only updates do not emit generic profile rows; automatic close does not emit admin close; score-entered/finalized are intentionally distinct. |
| `F-WRITER-BYPASS` | **CLOSED** | Typed HTTP/system/sensitive/best-effort writer boundaries own production inserts. The DB surface is insert-only; recursive source conformance reports zero direct production bypasses. |

### Accepted tradeoffs

- `attempt.exported`, `export_scores`, and `grading.detail_viewed` deny the
  sensitive response during audit failure. ADR-006 now explicitly accepts
  privacy over availability for these three operations only.
- `proctor.incident_marked` uses the audit row as its canonical append-only
  record for the current minimal model. A dedicated incident table remains a
  future product decision.
- Best-effort login/routine observations can be lost on crash or bounded drain
  timeout; failure is observable and never changes the business result.

### Runtime and storage closure

```text
DECLARED:                     62
ACTIVE:                       51
RESERVED:                      3
DEPRECATED:                    8

ATOMIC:                       28
SENSITIVE_READ:                3
BEST_EFFORT:                  24
DOMAIN_HISTORY:                7

ACTIVE_WITH_ZERO_CALLSITES:    0
RESERVED_WITH_ACTIVE_CALLSITE: 0
UNOWNED_DIRECT_WRITER:         0
```

The frontend's 1.5-second per-question debounce was used for the volume review.
With the documented 60-question/10-edit/60-minute assumption, 100 and 1,000
concurrent candidates produce approximately 117 and 1,167 saves/minute. Those
saves now add zero compliance-audit writes. The local development fixture had
21 audit rows / 48 KiB. All three inspected queries use the existing
organization/time index; target/action predicates are residual filters at this
scale, so no new index is justified without production selectivity/latency
evidence.

### Remaining decisions and process status

- **DEFERRED PRODUCT DECISION:** compliance retention/archive/deletion period.
- **DEFERRED PRODUCT DECISION:** dedicated attempt/exam history or proctor
  incident table if product requirements outgrow canonical state/current
  append-only incident records.
- **NON-BLOCKING OPTIMIZATION:** reconsider target/action indexes after table
  growth and query latency cross the ADR monitoring thresholds.

```text
AUDIT CORRECTIVE:
READY FOR INDEPENDENT REVIEW

VERIFICATION:
pnpm verify PASS (2026-07-21)

M10-F:
INVALIDATED — MUST BE RERUN AFTER AUDIT CORRECTIVE MERGES
```
