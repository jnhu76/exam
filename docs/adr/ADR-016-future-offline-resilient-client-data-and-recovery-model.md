# ADR-016 — Future Offline-Resilient Client Data and Recovery Model

## Status

* Status: **DEFERRED**
* Date: 2026-08-09
* Decision owners: project
* Supersedes: none
* Superseded by: none
* Related decisions:
  * ADR-004 — Desktop / Electron Exam Runtime (Desktop-runtime adoption gate)
  * ADR-005 — Exam Operation State Baseline
  * ADR-006 — Exam Time Authority
  * ADR-008 — Submit Answer Freeze Barrier
  * ADR-012 — Candidate Recovery Contract
  * ADR-013 — Interruption Detection and Time-Compensation Policy

> Review-cycle disclosure: ADR-016 was authored before/during the P7-C0 audit
> branch (`fix/p7-c0-durability-persistence-reality-audit`) but was **not** part
> of `origin/master` at the audit baseline. ADR-016 and the P7-C0 audit
> (`docs/audits/P7-C0-DURABILITY-PERSISTENCE-REALITY-AUDIT.md`) are reviewed in
> the **same PR/review cycle** and MUST NOT be treated as independent baseline
> evidence for one another.

This ADR records **only the durable architectural boundary** for a possible
future offline-resilient client. It deliberately does **not** select a local
storage technology, a synchronization framework, a wire protocol, a Desktop
runtime, or a fully-offline examination mode, and it does **not** freeze a
concrete representation of a recovery/history-generation mechanism. All such
detail lives in the non-binding companion note
[`docs/architecture/future-offline-resilient-client.md`](../architecture/future-offline-resilient-client.md).

It does **not** authorize implementation of a Desktop client, local SQLite
database, synchronization framework, Tauri/Electron migration, CRDT layer, or
fully-offline examination mode. ADR-004 remains the adoption gate for a Desktop
runtime; any implementation must first revalidate ADR-004 and this ADR against
the then-current server protocol and deployment requirements.

---

## Context

The current Exam runtime is server-authoritative. PostgreSQL owns durable
examination facts: attempts, answers accepted by the server, submission state,
grading, incidents, time adjustments, receipts, result publication, and audit
evidence. The browser client is primarily online-oriented. Existing protocols
already provide several primitives a more durable client would reuse —
versioned answer writes, caller-owned sequencing/idempotency identity, safe
replay of ambiguous requests, server-authoritative attempt/time state,
authoritative rereads after uncertain outcomes, and durable command receipts
for selected irreversible operations.

A future managed Desktop client *may* need stronger resilience than browser
storage can provide — for example temporary LAN interruption during an
examination, Desktop/OS restart, continued answer entry while the server is
temporarily unreachable, durable preservation of locally-entered answers not
yet acknowledged by the server, safe replay when connectivity returns, and
reconciliation after the authoritative server itself has been restored from an
older backup or PITR point.

The P7-C0 audit
([§18](../audits/P7-C0-DURABILITY-PERSISTENCE-REALITY-AUDIT.md)) found that
**no stable server-history generation / incarnation identifier exists today**
that a future client could use to distinguish ordinary server restart/history
continuation from authoritative history replacement (historical restore or
PITR). None of the adoption triggers below is currently met, so this boundary
is recorded now only so that P7-C server disaster-recovery design and any
future Desktop design do not accidentally create incompatible recovery
semantics.

---

## Decision

The following boundary is frozen. Everything more detailed is deferred to the
companion architecture note and to a future reality audit when a real
deployment trigger exists.

```text
A. Desktop / offline-resilient client implementation is DEFERRED.

B. The server (PostgreSQL) remains authoritative for accepted Exam facts.

C. A future durable client MAY preserve local unsynchronized candidate intent.
   Preserving intent does NOT grant that intent authority.

D. A future client protocol MUST be able to distinguish continuation of the
   same authoritative history (process restart, container recreation, exact
   durable-state relocation, ordinary upgrade) from authoritative history
   replacement (historical backup restore, PITR rollback, recovery from a
   non-identical authoritative database image). The exact representation is
   NOT selected here.

E. No local storage technology, synchronization framework, wire protocol,
   Desktop runtime, or fully-offline examination mode is selected now.

F. Implementation requires a fresh reality audit when a concrete deployment
   trigger exists; the illustrative material in the companion note is
   non-binding and MUST be revalidated at that time.
```

### Relationship to ADR-004 — clarify, do NOT supersede

This ADR does **not** supersede ADR-004. The two are compatible once two
distinct concepts are separated:

```text
Server authority
    determines which Exam facts are accepted and authoritative.

Preserved local intent
    retains candidate input that has not yet been authoritatively accepted
    by the server.
```

Preserving unresolved local candidate intent does **not** grant that intent
authority. If local intent conflicts with authoritative server state, the
server remains authoritative unless a subsequent explicit server command
accepts the retained intent. The two ADRs therefore do **not** describe
contradictory authorities that must later be reconciled; they describe
different concepts (authority vs. intent preservation).

### Authoritative history generation / incarnation (requirement only)

Before offline-resilient clients are adopted, the protocol MUST include a
mechanism that distinguishes continuation of the same authoritative history
from authoritative history replacement/rollback. This requirement is frozen;
its representation is not.

This is a familiar class of mechanism with mature conceptual precedents:

```text
database incarnation / generation
fencing-token / epoch-style history identity
```

The illustrative name `recoveryEpoch` is used as a non-binding placeholder in
the companion note only. A future design may adopt a different name and
representation; this ADR does not freeze a `recovery_epoch` table, API header,
DB field, wire protocol, or rotation command.

### Synchronization frameworks

No synchronization framework is selected. A future implementation requires a
build-vs-adopt evaluation against the then-current Exam protocol and
requirements. References to specific frameworks (Syncular, PowerSync,
ElectricSQL, Replicache, and similar) are non-binding design references only
and live in the companion note; "not selected now" is **not** a rejection of
any of them.

### Recovery caveat

Detecting authoritative history replacement does not itself recover data that
existed after the restored recovery point. For example, a client may have
previously received an ACK for answer version 8 while the server's PITR
returns to version 6, and the client may have already discarded the ACKed
payload from its unsynced outbox. A future history-generation mechanism can
*detect* the history break; it cannot reconstruct the lost v7/v8 payload.
Whether a future Desktop may retain or salvage previously ACKed local history
is a separate future authority/threat decision, not decided here.

---

## Consequences

* No Desktop, offline, or synchronization implementation is authorized.
* Server-authoritative protocols remain the single source of accepted Exam
  facts; local persistence of intent is explicitly non-authoritative.
* Any future design must preserve the history-generation distinguishing
  requirement above and must not silently treat a server-history rollback as
  an ordinary version race.
* This ADR must be revalidated together with ADR-004 when a real Desktop/
  offline-resilient adoption trigger appears.

---

## Adoption Triggers

Implementation becomes eligible only when a concrete deployment requires one
or more of: managed Desktop examination; candidate continuity across
meaningful LAN outages; restart-safe local answer durability; offline-resilient
exam-package access; or recovery of client intent across a server disaster
restore. None is met today. Before implementation, a fresh reality audit is
required (see Decision F), including re-auditing current answer/save/submit
protocols, ADR-004, this ADR, build-vs-adopt synchronization options, the
local-data threat model, and the history-generation mechanism against the
implemented P7-C restore model.
