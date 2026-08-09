# ADR-016 — Future Offline-Resilient Client Data and Recovery Model

## Status

**Deferred** — 2026-08-09

* Status: DEFERRED
* Date: 2026-08-09
* Decision owners: project
* Supersedes: none
* Superseded by: none
* Related decisions:

  * ADR-004 — Desktop / Electron Exam Runtime
  * ADR-005 — Exam Operation State Baseline
  * ADR-006 — Exam Time Authority
  * ADR-008 — Submit Answer Freeze Barrier
  * ADR-012 — Candidate Recovery Contract
  * ADR-013 — Interruption Detection and Time-Compensation Policy

This ADR records the **future client-side durability and offline-resilience model**.

It does **not** authorize implementation of a Desktop client, local SQLite database, synchronization framework, Syncular integration, Tauri/Electron migration, CRDT layer, or fully-offline examination mode.

ADR-004 remains the adoption gate for a Desktop runtime. Any implementation must first revalidate ADR-004 and this ADR against the then-current server protocol and deployment requirements.

---

## Context

The current Exam runtime is server-authoritative.

PostgreSQL owns durable examination facts including attempts, answers accepted by the server, submission state, grading, incidents, time adjustments, receipts, result publication, and audit evidence.

The browser client is primarily online-oriented. Existing protocols already provide several primitives needed by a future more durable client:

* versioned answer writes;
* caller-owned sequencing/idempotency identity;
* safe replay of ambiguous requests;
* server-authoritative attempt and time state;
* authoritative rereads after uncertain outcomes;
* durable command receipts for selected irreversible operations.

A future managed Desktop client may need stronger resilience than browser storage can provide.

Examples include:

* temporary LAN interruption during an examination;
* Desktop process crash or OS reboot;
* continued answer entry while the server is temporarily unreachable;
* durable preservation of locally-entered answers that have not yet been acknowledged by the server;
* safe replay when connectivity returns;
* reconciliation after the authoritative server itself has been restored from an older backup or PITR point.

These requirements do not justify creating a second Exam authority.

The architectural problem is therefore:

> How can a client durably preserve candidate intent and remain usable during connectivity failures without becoming an independent authority for examination facts?

---

## Decision Summary

The future client model SHALL follow:

> **Server-authoritative, client-local-first.**

The server remains the authority for examination facts.

A future durable client MAY maintain a local database containing:

1. a server-derived local projection;
2. candidate-local working state;
3. a durable outbound operation journal;
4. durable outcomes for unresolved operations;
5. client/device recovery metadata.

Local persistence exists to preserve **intent and availability**, not to replace server authority.

A future offline-resilient implementation MUST distinguish between:

```text
SERVER-DERIVED PROJECTION
        disposable / rebootstrap-able

LOCAL UNSYNCED INTENT
        durable / must not be silently discarded

SERVER-AUTHORITATIVE FACTS
        never invented locally
```

---

## 1. Authority Model

### 1.1 Server authority

The server remains authoritative for at least:

* admission;
* attempt creation and lifecycle;
* authoritative examination time/deadline;
* interruption resolution;
* operator time grants;
* force submit;
* misconduct actions;
* final submission acceptance;
* grading and terminal grading state;
* result publication;
* Proctor/Admin commands;
* audit and durable command receipts.

A local client MUST NOT manufacture or finalize these facts while disconnected.

For example, a Desktop client may display:

```text
submission pending synchronization
```

but MUST NOT convert that into:

```text
submission accepted
```

without server evidence.

---

## 2. Local Durable State Classes

A future durable client MUST classify local state rather than treating one SQLite database as one authority domain.

### 2.1 Server-derived projection

Examples:

* candidate-safe Exam snapshot;
* question and option data;
* server-acknowledged answer versions;
* attempt metadata;
* permitted resources.

This state MAY be discarded and rebuilt from the server.

It MUST NOT be treated as independent truth after server-history recovery.

### 2.2 Local unsynchronized intent

Examples:

* newly entered answers not yet acknowledged;
* pending answer-save operations;
* pending upload references;
* stable client sequence/idempotency identifiers;
* operation payload required for replay.

This state MUST survive:

* process restart;
* Desktop restart;
* transient network loss.

It MUST NOT be silently discarded merely because a fresh server projection is downloaded.

### 2.3 Durable operation outcomes

Conflicts, permanent rejections, ambiguous outcomes requiring user/operator action, and recovery evidence SHOULD survive process restart until explicitly resolved or acknowledged.

### 2.4 Disposable local state

Examples:

* rendered UI caches;
* image cache;
* transient network state;
* derived search indexes that can be rebuilt;
* temporary files.

Loss of this state MUST NOT affect examination correctness.

---

## 3. Local Write Contract

A future local-first answer write SHOULD behave conceptually as:

```text
candidate edits answer
        ↓
single local durable transaction
        ├─ update local working projection
        └─ append/revise outbound intent
        ↓
UI immediately reflects local durable state
```

Synchronization later sends the durable intent to the authoritative server.

The client MUST preserve the identity required for safe replay.

A network retry MUST reuse the original logical operation identity rather than inventing a new mutation merely because the response was lost.

The existing server protocols remain authoritative over acceptance, version conflict, and terminal state.

---

## 4. Offline Is a Policy Dimension

"Desktop" and "offline" MUST NOT be synonymous.

A future Exam policy model SHOULD distinguish connectivity behavior explicitly.

Illustrative values:

```text
required_online
offline_tolerant
offline_capable
```

### required_online

Loss of connectivity beyond the configured boundary may transition the attempt into the existing disruption/recovery workflow.

### offline_tolerant

The client may continue local candidate work across bounded connectivity failures and replay durable intent when connectivity resumes.

This is the preferred future default for a managed Desktop client unless a stricter Exam policy overrides it.

### offline_capable

The client may operate for a substantially longer interval under a server-issued offline contract.

This requires a separate accepted design covering at least:

* offline authorization/lease;
* time authority;
* device identity;
* clock manipulation;
* exam-package protection;
* submission semantics;
* reconnect reconciliation.

This ADR does not authorize that design.

### Fully offline exam

Running an authoritative examination with no reachable server for the complete examination lifecycle is explicitly **not decided here**.

---

## 5. Server-History Recovery and Recovery Epoch

Normal restart and disaster recovery are not equivalent.

The system MUST eventually be able to distinguish:

```text
process restart
container recreation
host relocation preserving exact durable state

from

backup restore
PITR rollback
authoritative history replacement
```

A future server/client protocol SHOULD therefore carry an authoritative recovery-history identity, referred to in this ADR as:

```text
recoveryEpoch
```

The exact representation is deferred.

### 5.1 Epoch-stable events

The following SHOULD NOT change the recovery epoch:

* API process restart;
* worker restart;
* container recreation;
* host relocation using the exact same authoritative PostgreSQL history;
* ordinary application upgrade that preserves authoritative history.

### 5.2 Epoch-changing events

The epoch SHOULD change when the authoritative history can move backward or be replaced, including:

* restore from historical backup;
* PITR to an earlier point;
* recovery from another authoritative database image whose history is not proven identical.

---

## 6. Epoch Mismatch Recovery

Consider:

```text
Desktop:
  recoveryEpoch = 20
  Q1 acknowledged through version 8
  Q3 has unsynchronized local intent

Server:
  restored through PITR
  recoveryEpoch = 21
  Q1 currently exists only through version 6
```

The client MUST NOT infer:

```text
client version 8 > server version 6
therefore client wins
```

It MUST also not silently discard Q3 merely because the restored server no longer contains its former history.

Instead:

```text
epoch mismatch
      ↓
stop ordinary synchronization
      ↓
preserve unsynchronized local intent
      ↓
discard/rebootstrap server-derived projection
      ↓
obtain current authoritative server truth
      ↓
reconcile retained intent under the current protocol
```

A `FUTURE_VERSION` response alone is insufficient to distinguish a buggy client from an authoritative server rollback.

Recovery-history identity exists to make that distinction explicit.

---

## 7. Rebootstrap Rule

The central client recovery invariant is:

> **Server-derived state may be replaced; unsynchronized local intent may not be silently replaced with it.**

A future rebootstrap operation MUST therefore preserve:

* pending outbound operations;
* their stable identities;
* unresolved durable outcomes;
* required device/recovery metadata.

It MAY replace:

* synchronized row projections;
* server-derived caches;
* server cursors;
* other rebuildable state.

---

## 8. Authoritative Commands Are Not Ordinary Replicated Rows

Offline-first synchronization MUST NOT collapse privileged state transitions into generic row synchronization.

Commands such as:

* submit;
* force submit;
* misconduct;
* time grant;
* interruption restore;
* incident mutation;
* Proctor assignment;
* result publication;

remain explicit server-authoritative operations.

Where ambiguous delivery is possible, they MUST retain command-specific idempotency and receipt semantics.

Generic last-write-wins replication is not an acceptable substitute.

---

## 9. Conflict Semantics

A local client may optimistically present locally-entered candidate content.

The server remains responsible for acceptance.

Conflicts MUST be explicit.

The client MUST NOT silently:

* overwrite authoritative data after a version conflict;
* discard unsynchronized candidate input;
* reinterpret a permanent server rejection as success;
* convert server-history rollback into an ordinary latest-version race.

Recovery UI SHOULD distinguish at least:

```text
synced
saved locally / waiting for sync
sync retrying
conflict requiring reconciliation
server recovery detected
permanently rejected
```

Exact UX is deferred.

---

## 10. Local Storage Technology

No storage implementation is selected by this ADR.

Candidates for future evaluation include:

* native SQLite;
* SQLite through a Desktop runtime;
* a purpose-built operation journal;
* an offline-first synchronization framework.

The implementation SHOULD prefer a transactional local store capable of atomically persisting local state and outbound intent.

This ADR does not select:

* Syncular;
* PowerSync;
* ElectricSQL;
* Replicache;
* CRDTs;
* Electron;
* Tauri.

Such adoption requires a separate reality audit and decision.

---

## 11. Sync Framework Boundary

If a synchronization framework is adopted in the future:

1. it MUST NOT become the authority for Exam state transitions;
2. it MUST coexist with explicit authoritative Exam commands;
3. its local outbox must preserve stable replay identity;
4. server-derived projections must be rebootstrap-able;
5. unsynchronized intent must survive rebootstrap;
6. server-history recovery must have an explicit epoch/reset mechanism;
7. protocol/schema upgrades must not silently invalidate durable pending intent;
8. deterministic failure/restart tests are required.

---

## 12. Security Boundary

Offline durability increases the value and sensitivity of local client storage.

Any implementation MUST separately address:

* local answer confidentiality;
* OS account access;
* device theft;
* local database copying;
* rollback of client files;
* tampering with client state;
* encryption key storage;
* secure deletion after retention expiry;
* code signing and update integrity.

Local encryption does not confer authority.

A candidate controlling the local machine must still be unable to forge authoritative server facts merely by modifying local storage.

---

## 13. Deterministic Recovery Testing

Offline/client recovery behavior MUST be tested through deterministic failure injection.

Required future scenarios include:

* request delivered, response lost;
* disconnect before delivery;
* disconnect after server commit;
* client crash before local ACK persistence;
* client crash after local mutation but before synchronization;
* restart with non-empty outbox;
* conflict after reconnect;
* schema/protocol upgrade with pending intent;
* server backup restore while client remains alive;
* server PITR causing epoch mismatch;
* rebootstrap with pending local writes.

Tests SHOULD use explicit barriers/hooks rather than sleep-based race construction.

---

## 14. Relationship to ADR-004

ADR-004 remains the Desktop-runtime adoption decision.

This ADR refines one future area anticipated by ADR-004: local offline-resilient answer storage and recovery.

ADR-004's invariant remains:

> PostgreSQL/server authority is not transferred to Desktop.

However, a future implementation SHOULD distinguish a disposable "cache" from **durable unsynchronized candidate intent**.

Server authority means the server determines accepted examination facts.

It does **not** mean a client may discard a candidate's locally durable but not-yet-acknowledged input whenever the server lacks that input.

Any future Desktop implementation must reconcile both ADRs explicitly.

---

## 15. Non-Goals

This ADR does not implement or authorize:

* Desktop runtime;
* Electron or Tauri;
* local SQLite;
* Syncular or another synchronization dependency;
* browser offline-first conversion;
* fully offline examinations;
* CRDT-based examination state;
* peer-to-peer synchronization;
* client-owned deadlines;
* client-owned submission truth;
* replication of Admin/Proctor authority into an offline client;
* P7-C backup/restore implementation.

Server durability and disaster recovery remain a separate P7-C workstream.

---

## 16. Adoption Triggers

Implementation becomes eligible only when a concrete deployment requires one or more of:

* managed Desktop examination;
* candidate continuity across meaningful LAN outages;
* restart-safe local answer durability;
* offline-resilient exam-package access;
* recovery of client intent across server disaster restore.

Before implementation:

1. re-audit current answer/save/submit protocols;
2. re-audit ADR-004 runtime choice;
3. compare build-vs-adopt synchronization options;
4. define local-data threat model;
5. define recoveryEpoch semantics against the implemented P7-C restore model;
6. prove the design with deterministic crash/reconnect experiments.

---

## 17. Deferred Decision

**Offline-resilient client implementation is DEFERRED.**

The architectural direction is recorded now so P7-C server disaster recovery and future Desktop design do not accidentally create incompatible recovery semantics.

Current implementation work remains focused on server-side persistence, backup, restore, disaster recovery, and configuration control-plane readiness.
