# Standard Exam — Supported Capabilities & Guarantees

> **Status: REVIEWED PRODUCT PROJECTION** — a reviewed, version-bound
> description of what the Standard Exam product supports today. This page is
> **not** a new semantic authority: cross-boundary exam semantics stay with
> [EXSEM](../architecture/exam-semantic-boundaries.md) / Accepted
> [ADRs](../adr/README.md), product invariants with
> [SPEC](../../docs/SPEC.md), wire behavior with
> [contracts](../contracts/) and generated OpenAPI, and as-built
> implementation state with
> [implementation-status.md](../status/implementation-status.md). Where this
> page and a normative source appear to disagree, the normative source
> governs and the disagreement is a defect to reconcile — not a license to
> reinterpret.

**Applicable version:** release `v0.0.10` and master `511e6e60`
(2026-10-27). Facts below are re-checked against that tree; later commits may
have changed behavior. See §1 for when this document stops applying.

---

## 1. Applicability

- **Version binding.** This projection describes release tag `v0.0.10`
  and master commit `511e6e60dd332f376f15ea0326f95fcefddaeb84`
  (2026-10-27). It is not automatically true of older or newer builds.
- **Evidence topology.** Deployment facts describe the bundled
  single-node Docker Compose production topology (`docker-compose.yml`,
  project `exam-prod`). Reliability facts cite the #817 fault-injection
  campaign, which ran against that same topology shape (web + app + db,
  host bind-mounted PGDATA) in a disposable research environment.
- **Single organization, single deployment.** One deployment serves one
  institution. `organizationId` is an internal data-ownership boundary;
  the product is single-tenant. Multi-tenant platform features
  (tenant login, tenant switcher, SuperAdmin) are not implemented.
- **Standard-only product composition.** The only delivered product
  configuration is "Standard" ([ADR-022](../adr/ADR-022-product-capability-composition.md)
  Phase 1). A "Minimal" preset exists as accepted design, not as a
  selectable runtime.
- **Language.** The shipped web UI is Simplified Chinese (zh-CN) only.
  There is no English UI locale and no language switcher.
- **When this document stops applying.** Treat it as stale when any of
  these happen: a new release tag supersedes `v0.0.10` with behavior
  changes; [ADR-022](../adr/ADR-022-product-capability-composition.md)
  Phase 2–4 land (write guards, Minimal runtime, persisted deployment
  configuration); the [#293](https://github.com/jnhu76/exam/issues/293)
  Controlled/Strict profiles land; the R4 reliability decisions
  ([#813](https://github.com/jnhu76/exam/issues/813),
  [#827](https://github.com/jnhu76/exam/issues/827),
  [#828](https://github.com/jnhu76/exam/issues/828)) are adopted; or
  [ADR-012](../adr/ADR-012-candidate-recovery-contract.md)'s durable
  local draft (`DurableAnswerDraft` / outbox) is implemented.

## 2. Supported deployment

As built (source: `docker-compose.yml`, `deploy/nginx/web.conf`,
[deployment README](../deployment/README.md),
[runbook](../deployment/mvp-deployment-runbook.md)):

- **Single host, Docker Compose.** Three default services: `web`
  (nginx edge — the only public ingress, serves the static SPA and
  proxies `/api/**`), `app` (Fastify API; runs database migrations on
  startup; hosts the in-process email outbox loop), `db`
  (`postgres:18.4-bookworm`). Redis is optional (`redis` profile) and
  only owns shared rate-limit state.
- **Storage.** PostgreSQL data lives in a host bind mount
  `${EXAM_DATA_ROOT:-./data}/postgres`. Host persistence is **not**
  backup. `app` and `db` publish no host ports; only `web` is exposed
  (`EXAM_PORT`, default 80).
- **Transport.** HTTP on a controlled LAN is the bundled, supported
  mode. HTTPS is an operator concern: a commented template exists in the
  baked-in nginx config (certificate + override mount + port 443); the
  application never terminates TLS and no certificate automation is
  bundled.
- **Backup / restore = Host Operator obligation.** The one supported
  mechanism is `pg_dump -Fc` / `pg_restore` via `scripts/db-backup.sh`,
  scheduled and retained by the operator (cron/systemd, off-host
  copies). The product ships **no** backup scheduler, catalog, evidence
  ledger, or retention engine
  ([ADR-023](../adr/ADR-023-remove-backup-evidence-subsystem.md) removed
  the backup-evidence subsystem; runbook §17).
- **Not supported:** multi-instance / HA deployments (in-process
  scanners assume a single API owner), external PostgreSQL, multi-node
  topologies, horizontal scaling, and any cloud-managed dependency.
  Measured production RPO/RTO values do **not** exist; containers
  starting healthy is not an availability or durability guarantee.

## 3. Exam lifecycle

The delivered flow (authority:
[exam-runtime.md](../architecture/exam-runtime.md),
[ADR-008](../adr/ADR-008-submit-answer-freeze.md),
[ADR-006](../adr/ADR-006-exam-time-authority.md)):

```text
Author → Configure → Publish → Enroll → Start → Save → Submit → Grade → Publish Results
```

- **Authoring.** Five question types: single choice, multiple choice,
  true/false, fill blank, text response (with rubric). Rich content
  (prompt and options) uses the frozen Rich V1 content-document grammar
  ([ADR-019](../adr/ADR-019-content-document-model.md)) with math,
  tables, and code; a plain-text projection is always derivable.
  Questions require a course; CSV import is Plain-only (it can create
  text_response questions, which then require manual grading).
- **Configuration.** Per-exam policy: timing mode (`timed_window` /
  `deadline` / `untimed`; `timed_sync` is frozen by contract but not
  activated), duration, retake policy and attempt limit, score strategy
  (highest / latest / first), result publication mode (immediate /
  after grading / manual), interruption-recovery policy
  (strict / bounded grace / operator incident), passing score. Reusable
  policy profiles exist as copy-on-apply templates.
- **Publish = freeze point.** Publishing builds the `QuestionSnapshot`
  (content, options, answers, rubric) once; attempts materialize a
  per-attempt frozen snapshot (including shuffle decisions). Later
  question-bank edits do **not** change published or running exams;
  grading reads only the frozen rubric.
- **Enrollment / admission.** Admin assigns candidates to a published
  exam (picker in the exam detail page); account-based admission is
  standard. A durable admission queue exists as a per-exam policy
  (`requireQueue`, API-only switch — no UI toggle).
- **Time authority.** The server owns exam time and deadlines
  ([ADR-006](../adr/ADR-006-exam-time-authority.md)); client countdowns
  are display-only. Interruption compensation follows
  [ADR-013](../adr/ADR-013-interruption-time-compensation-policy.md).
- **Save / submit.** Answers are saved through a versioned, idempotent,
  conflict-detecting protocol (§5). Submit freezes the attempt:
  `submitted_answers` becomes the grading authority
  ([ADR-008](../adr/ADR-008-submit-answer-freeze.md)); submit + freeze +
  workset materialization + auto-grading run in one transaction, and a
  crash after commit recovers idempotently (landed-but-ungraded).
- **Grading.** Objective types are auto-graded. Text responses go to a
  manual grading workset (rubric shown, score + optional comment,
  per-question irreversible submit). Manual completion of pending
  subjective work is a derived obligation — it cannot be skipped before
  results publish in modes that require grading.
- **Results.** Published per the exam's `resultPublicationMode`; the
  frozen mode is honored even if grading completes later. Candidates
  see pass/fail against the passing score and per-question detail when
  results are published.

## 4. Admin configuration

What an Admin can actually configure today (source: `apps/web` pages +
API routes; capability authority:
[product-capability-composition.md](../architecture/product-capability-composition.md)):

- **Real Admin UI exists for:** platform settings and branding,
  candidate fields, users (staff + candidates, CSV import for
  candidates, staff invitations), courses, questions (5 types, Rich
  editor, Plain-only CSV import), exam wizard (policy, questions,
  schedule), exam lifecycle operations (publish / unpublish / close /
  extend / cancel / archive / publish results), enrollment, grading
  queue and grading, results overview and export, recovery center,
  proctor workspace, audit logs, diagnostics.
- **API-supported but UI-thin:** admission queue switch
  (`requireQueue`) and batch size/interval (draft PATCH via API; no UI
  input); Proctor → Exam assignment (UI exists on the recovery exam
  detail page but requires typing a raw user ID — there is no
  proctor-picker dialog like the Teacher/Grader ones on the users
  page); admissions management views.
- **Static catalog, not switches.** The 13 `ProductCapabilityId`s in
  `packages/domain/src/productCapabilities.ts` are a **read-only
  projection of what Standard supports** — not 13 deployment toggles.
  The resolver is fail-closed and admits only the complete Standard
  set; no write path consults the catalog today (Phase 2 write guards
  are not implemented). The two per-exam knobs (`requireQueue`,
  `resultPublicationMode`) are exam policy choices, not deployment
  capability toggles.
- **Not implemented:** Minimal/subset composition (Phase 3), persisted
  deployment configuration with revision/CAS (Phase 4), any per-item
  capability switch.

## 5. Answer save semantics

The candidate editor keeps the current answer in React state and
debounces saves by ~1500 ms
(`apps/web/src/hooks/useSubmitFlush.ts`, `DEBOUNCE_MS = 1500`). The save
indicator has exactly four UI states: idle ("waiting"), saving, saved,
error (`apps/web/src/components/exam/SaveIndicator.tsx`). Explanatory
model — these are interpretation categories, not five implemented UI
states:

| State | What the user may conclude |
| --- | --- |
| Editing / pending (debounce window) | The edit exists in the browser only. It has **not** been accepted by the server and can be lost on refresh or tab close. |
| Inflight (request sent) | A save request is being processed. The outcome is not yet known; HTTP transport success alone proves nothing about business acceptance. |
| Failed / ambiguous | Not reliably saved. The UI shows an error; retry happens automatically while the page is alive. Nothing may be claimed "saved". |
| Server ACK accepted | The server responded `accepted: true` with a `serverVersion`; the answer version is persisted under the versioned/idempotent/conflict-detecting protocol. This is the only condition under which the UI says "saved". |
| Submitted / terminal | The attempt is frozen: `submitted_answers` is the grading authority; lifecycle and grading facts follow the submit-freeze and terminal-state authorities ([ADR-008](../adr/ADR-008-submit-answer-freeze.md)). |

What each thing means — and does not mean:

- **UI "saved" = server ACK.** The indicator switches to "saved" only
  after the API returns `accepted: true` + `serverVersion` (or a
  stale-version reconcile returned the authoritative server answer).
- **HTTP success ≠ business acceptance.** Only the structured response
  counts; the client tracks `serverVersion` for conflict detection and
  reconciles on `STALE_VERSION`.
- **Unsent edits can be lost.** A refresh inside the debounce window
  (or any loss before the request is sent) loses the in-memory edit.
  This was measured in #817 D7: four of four real pre-debounce refresh
  cuts lost the unsent edit.
- **Save and submit are different protocol stages.** Autosave keeps
  server-confirmed drafts in `exam_attempts.answers`; submit freezes
  `exam_attempts.submitted_answers`, which is what grading reads.
- **There is no durable local draft.** ADR-012's `DurableAnswerDraft` /
  save-outbox is an accepted **target** design, not shipped
  functionality; the browser holds no persistent answer journal today.

## 6. Recovery and fault domains

Evidence basis: the #817 fault-injection campaign (CLOSED 2026-10-28;
real Docker + real Chrome/CDP, per-answer value/version oracles,
exploratory sample sizes, `HISTORICAL_MEASURED`). Its numbers describe
**the tested domains only** — they are not production guarantees and do
not extend to untested failure modes (power loss, disk corruption,
host loss, malicious storage).

| Fault domain | Observed outcome in #817 | Evidence quality |
| --- | --- | --- |
| Browser refresh (D0) after server ACK | ACKed answers restored exactly from server snapshot; UI ⇄ SQL parity | HISTORICAL_MEASURED (per-answer oracle) |
| App container stop / SIGKILL (D1/D2) | ACKed answers preserved in PostgreSQL; unsent in-debounce edits and in-flight-unknown requests stay distinct | HISTORICAL_MEASURED |
| PostgreSQL restart / SIGKILL with intact PGDATA (D3/D4) | WAL crash recovery; ACKed answers preserved exactly (D3: 2 trials; D4: 3 trials — 40/40 ACKed answers across the first-stage D0+D4 arms reported by #819) | HISTORICAL_MEASURED |
| Container reconstruction (`compose down`/`up` on same bind mount) (D5) | One trial returned UNKNOWN — its browser recovery/reload leg was NOT_RUN. **D5 must not be folded into a blanket crash-recovery PASS.** | HISTORICAL_MEASURED with UNKNOWN residue |
| Restore of an older `pg_dump` snapshot (D6) | The restored database is internally consistent **as of the dump** and silently misses every ACKed answer accepted after the dump point (both trials omitted 4 post-dump ACKed updates). This is recovery-point rollback, not a PG crash-durability defect. | HISTORICAL_MEASURED (2 trials) |
| Unsent browser edit + refresh (D7) | All four pre-debounce cuts lost the unsent edit; no request/ACK had reached the server. Local pre-ACK loss, not a server defect. | HISTORICAL_MEASURED (4/4) |
| Terminal submit interrupted by app/db crash (D8) | Submitted/terminal state and grading integrity preserved in the tested crash domains; evidence carries an explicit replay provenance limitation and must not be generalized to stale-snapshot restore. | HISTORICAL_MEASURED (qualified) |
| Host/storage destruction, power loss, disk corruption | **NOT TESTED.** Recovery then depends entirely on the operator's backup cadence and off-host copies; RPO equals the last verifiable backup, which the product does not manage or measure. | NOT_VERIFIED |

Product-side recovery features that do exist: heartbeat-based disrupted
attempt detection, candidate self-service restore of the frozen attempt
snapshot, Admin/Proctor Recovery Center, operator time grants — all
server-authoritative ([ADR-012](../adr/ADR-012-candidate-recovery-contract.md),
[ADR-013](../adr/ADR-013-interruption-time-compensation-policy.md),
[ADR-014](../adr/ADR-014-exam-incident-authority.md)).

## 7. Explicit non-guarantees

Each item states what the product does **not** promise today:

1. **No durable offline exam client.** No IndexedDB journal, no local
   outbox, no offline authoring/taking mode (ADR-012 target / ADR-016
   deferred; #827 is research-only).
2. **No guaranteed recovery of unsent browser edits.** In-debounce and
   otherwise unsent edits are memory-only (#817 D7, measured loss).
3. **No production-wide zero-loss claim.** #817 covers scoped fault
   domains at exploratory sample sizes; it is not a zero-data-loss
   guarantee for production or for untested failure modes.
4. **No adopted Host RPO/RTO SLO.** All RPO/RTO figures in
   [#828](https://github.com/jnhu76/exam/issues/828) are candidate
   decision scenarios; none is adopted.
5. **No guaranteed survival of post-backup ACKed history after an old
   restore.** Restoring an older dump recovers only the dump-time state;
   later server-ACKed answers are gone from the restored authority
   (#817 D6). How to detect/handle that rollback is an open R4 decision
   ([#813](https://github.com/jnhu76/exam/issues/813)).
6. **No HA or arbitrary multi-instance deployment guarantee.** Single
   instance by design.
7. **No multi-tenant platform.** Single deployment = single institution;
   no tenant switcher, SuperAdmin, or `organizationSlug` login.
8. **No arbitrary per-capability toggling.** The 13-capability catalog
   is read-only; no deployment-level switches exist (ADR-022 Phase 2/4
   not implemented).
9. **No implemented Minimal deployment.** The Minimal preset is accepted
   design, not a selectable runtime.
10. **No shipped Controlled/Strict assurance.** No lockdown browser,
    device/session binding, secondary identity verification, or
    continuous monitoring runtime
    ([#293](https://github.com/jnhu76/exam/issues/293): not started).
11. **No product-managed automated disaster-recovery control plane.**
    Host Operator owns backup execution, scheduling, retention,
    verification, and drills ([ADR-023](../adr/ADR-023-remove-backup-evidence-subsystem.md));
    the product provides no backup UI, ledger, or RPO/RTO projection.
12. **No IP-based identity proof.** IP/CIDR restrictions, device
    binding, and single-session enforcement are not implemented
    (runbook §16); an IP address does not prove a candidate's identity.
13. **No "submit succeeded ⇒ survives every server disaster" inference.**
    Submit freeze protects business/grading semantics; it is not a
    storage-durability promise (see §6).

## 8. Support & Evidence Matrix

Product status and evidence strength are independent columns.
`EXECUTED_VERIFIED` is reserved for evidence produced by runs executed
in this documentation campaign — none — so it does not appear.
`TEST_ASSERTED` means the repository contains the named test/spec
evidence (not re-run here); `HISTORICAL_MEASURED` = #817 measured
trials; `SOURCE_INSPECTED` = read from current source at the pinned
commit.

| Capability / Guarantee | Status | Preconditions | Applicable version | Evidence type | Normative source | Limitations |
| --- | --- | --- | --- | --- | --- | --- |
| 5 question types + rubric | SUPPORTED | — | v0.0.10 / 511e6e60 | TEST_ASSERTED + SOURCE_INSPECTED | domain `enums.ts`, publish invariants, #678 audit | CSV import is Plain-only |
| Rich content (prompt/options/answers, math/table/code) | SUPPORTED | Rich V1 grammar | v0.0.10 / 511e6e60 | TEST_ASSERTED + SOURCE_INSPECTED | [ADR-019](../adr/ADR-019-content-document-model.md), rich-content semantic contract | plain projection fallback for non-rich rendering |
| Exam lifecycle + publish freeze | SUPPORTED | — | v0.0.10 / 511e6e60 | TEST_ASSERTED + SOURCE_INSPECTED | [exam-runtime.md](../architecture/exam-runtime.md), [ADR-008](../adr/ADR-008-submit-answer-freeze.md) | published exams: schedule-only edits |
| Versioned/idempotent/conflict-detecting answer save | SUPPORTED | page alive (client) | v0.0.10 / 511e6e60 | TEST_ASSERTED + SOURCE_INSPECTED | answer protocol; [ADR-012](../adr/ADR-012-candidate-recovery-contract.md) | ~1.5 s debounce; unsent edits lost on refresh (D7) |
| UI "saved" = server ACK semantics | SUPPORTED | — | v0.0.10 / 511e6e60 | SOURCE_INSPECTED | `SaveIndicator.tsx`, `TakeExamPage.tsx` | no separate "saved locally" UI state exists |
| ACKed answers survive app/PG restart (intact PGDATA), refresh | SUPPORTED (scoped) | bundled Compose topology; bind mount intact | v0.0.10 / 511e6e60 | HISTORICAL_MEASURED (#817 D0–D4) | [#817](https://github.com/jnhu76/exam/issues/817) | exploratory n; no power/disk/host-loss coverage; D5 partially UNKNOWN |
| Manual grading workset + rubric grading | SUPPORTED | text_response present | v0.0.10 / 511e6e60 | TEST_ASSERTED + SOURCE_INSPECTED | grading kernel; #678 audit | per-question grading submit is irreversible |
| Result publication modes | SUPPORTED | — | v0.0.10 / 511e6e60 | TEST_ASSERTED + SOURCE_INSPECTED | `resultPublicationMode` authority | frozen at publish; per-exam policy, not a capability toggle |
| Candidate disrupted-attempt recovery, Recovery Center | SUPPORTED | — | v0.0.10 / 511e6e60 | TEST_ASSERTED + SOURCE_INSPECTED | [ADR-012/013/014](../adr/), recovery contract | server-authoritative only; no local-draft salvage |
| Admission queue (`requireQueue`) | SUPPORTED (policy) | API-only toggle | v0.0.10 / 511e6e60 | TEST_ASSERTED + SOURCE_INSPECTED | admission runtime #292 | no UI switch; drain-on-disable is a Phase 4 duty |
| Single-node Compose deployment, HTTP LAN | SUPPORTED | Docker host, LAN | v0.0.10 / 511e6e60 | SOURCE_INSPECTED + runbook §11 smoke | [deployment README](../deployment/README.md) | HTTPS = operator template; no ACME |
| Operator backup/restore (`db-backup.sh`) | SUPPORTED (host path) | operator runs it | v0.0.10 / 511e6e60 | SOURCE_INSPECTED + HISTORICAL_MEASURED (#812 G0 DB-path restore) | runbook §17, [ADR-023](../adr/ADR-023-remove-backup-evidence-subsystem.md) | DB-path drill only; no app-boot acceptance, no product RPO/RTO |
| Old-snapshot restore completeness | PARTIAL | — | v0.0.10 / 511e6e60 | HISTORICAL_MEASURED (#817 D6) | [#817](https://github.com/jnhu76/exam/issues/817), [#828](https://github.com/jnhu76/exam/issues/828) | post-dump ACKed answers are lost on restore; rollback policy undecided |
| TLS/HTTPS ingress | PARTIAL | operator cert + nginx override | v0.0.10 / 511e6e60 | SOURCE_INSPECTED | deployment README "Network / TLS" | no certificate automation; template must be applied per image |
| Admission `timed_sync` timing mode | DEFERRED | B2 product decision | v0.0.10 / 511e6e60 | NOT_VERIFIED | [timed-sync-semantics.md](../contracts/timed-sync-semantics.md) | frozen contract, not activated |
| Durable local answer draft / offline client | NOT_SUPPORTED | — | — | NOT_VERIFIED | [ADR-012](../adr/ADR-012-candidate-recovery-contract.md) (target), [ADR-016](../adr/ADR-016-future-offline-resilient-client-data-and-recovery-model.md) (deferred), #827 (research) | research/decision stage |
| Minimal / subset composition, per-capability toggles | NOT_SUPPORTED | — | — | NOT_VERIFIED | [ADR-022](../adr/ADR-022-product-capability-composition.md) Phase 2–4, #678 | design accepted, not implemented |
| Controlled/Strict high-assurance (device binding, lockdown, continuous monitoring) | NOT_SUPPORTED | — | — | NOT_VERIFIED | [#293](https://github.com/jnhu76/exam/issues/293) | umbrella tracker; #315/#316/#317 not started |
| Multi-tenant platform | NOT_SUPPORTED | — | — | NOT_VERIFIED | [SPEC](../SPEC.md), Phase 4 roadmap | — |
| HA / multi-instance | NOT_SUPPORTED | — | — | SOURCE_INSPECTED | runbook §16 | single API owner by design |
| Product RPO/RTO SLOs | NOT_SUPPORTED | — | — | NOT_VERIFIED | [#828](https://github.com/jnhu76/exam/issues/828) (candidates only) | no threshold adopted |
| Host-loss / power-loss durability | NOT_SUPPORTED (untested) | — | — | NOT_VERIFIED | [#817](https://github.com/jnhu76/exam/issues/817) scope limits | depends on operator backups |

---

*Projection review: this page was written and adversarially reviewed for
issue [#751](https://github.com/jnhu76/exam/issues/751) against master
`511e6e60`. Corrections belong in the normative sources first; this page
must be re-verified when they change.*
