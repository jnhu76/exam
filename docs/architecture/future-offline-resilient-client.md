# Future Offline-Resilient Client — Design Notes

> **FUTURE DESIGN NOTES — NON-BINDING — IMPLEMENTATION DEFERRED**
>
> This document is **not** an ADR and carries **no binding decision**. It
> preserves the non-binding future-design thinking that was separated out of
> [ADR-016](../adr/ADR-016-future-offline-resilient-client-data-and-recovery-model.md)
> during the PR #270 corrective pass. The ADR freezes only the durable
> architectural boundary; everything below is illustrative material that a
> future design **may** revisit, recombine, or discard, and **MUST** be
> revalidated against the then-current Exam protocol when a real adoption
> trigger exists.
>
> None of the algorithms, state classes, scenarios, or references below is a
> current system guarantee. The illustrative name `recoveryEpoch` is a
> non-binding placeholder only.

---

## 1. Authority model (intent vs. authority)

The binding rule (ADR-016) is: the server determines which Exam facts are
accepted and authoritative; a durable client *may* preserve candidate input
that has not yet been authoritatively accepted, but preserving intent does not
grant authority.

For example, a future Desktop client may display:

```text
submission pending synchronization
```

but MUST NOT convert that into:

```text
submission accepted
```

without server evidence.

A future design may wish to classify server authority over: admission; attempt
creation and lifecycle; authoritative examination time/deadline; interruption
resolution; operator time grants; force submit; misconduct actions; final
submission acceptance; grading and terminal grading state; result publication;
Proctor/Admin commands; audit and durable command receipts. A local client MUST
NOT manufacture or finalize these facts while disconnected.

---

## 2. Local durable state classes (illustrative)

A future durable client MAY classify local state rather than treating one
local database as one authority domain. One possible split:

```text
SERVER-DERIVED PROJECTION        disposable / rebootstrap-able
LOCAL UNSYNCED INTENT            durable / must not be silently discarded
DURABLE OPERATION OUTCOMES       survive restart until resolved/acknowledged
DISPOSABLE LOCAL STATE           caches, images, transient network state
```

### Server-derived projection (illustrative examples)

Candidate-safe Exam snapshot; question and option data; server-acknowledged
answer versions; attempt metadata; permitted resources. Such state MAY be
discarded and rebuilt from the server. It MUST NOT be treated as independent
truth after server-history recovery.

### Local unsynchronized intent (illustrative examples)

Newly entered answers not yet acknowledged; pending answer-save operations;
pending upload references; stable client sequence/idempotency identifiers;
operation payload required for replay. Such state SHOULD survive process
restart, Desktop restart, and transient network loss, and MUST NOT be silently
discarded merely because a fresh server projection is downloaded.

### Durable operation outcomes (illustrative)

Conflicts, permanent rejections, ambiguous outcomes requiring user/operator
action, and recovery evidence SHOULD survive process restart until explicitly
resolved or acknowledged.

### Disposable local state (illustrative)

Rendered UI caches; image cache; transient network state; rebuildable derived
indexes; temporary files. Loss of this state MUST NOT affect examination
correctness.

---

## 3. Local write contract (illustrative)

A future local-first answer write MAY behave conceptually as:

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
The client SHOULD preserve the identity required for safe replay: a network
retry SHOULD reuse the original logical operation identity rather than inventing
a new mutation merely because the response was lost. The existing server
protocols remain authoritative over acceptance, version conflict, and terminal
state.

---

## 4. Offline as a policy dimension (illustrative)

"Desktop" and "offline" should not be synonymous. A future Exam policy model
MAY distinguish connectivity behavior explicitly. Illustrative values:

```text
required_online
offline_tolerant
offline_capable
```

* **required_online** — loss of connectivity beyond the configured boundary may
  transition the attempt into the existing disruption/recovery workflow.
* **offline_tolerant** — the client may continue local candidate work across
  bounded connectivity failures and replay durable intent when connectivity
  resumes; a possible future default for a managed Desktop client unless a
  stricter Exam policy overrides it.
* **offline_capable** — the client may operate for a substantially longer
  interval under a server-issued offline contract. This would require a
  separate accepted design covering at least offline authorization/lease, time
  authority, device identity, clock manipulation, exam-package protection,
  submission semantics, and reconnect reconciliation. It is explicitly NOT
  decided here.

Running an authoritative examination with no reachable server for the complete
examination lifecycle is explicitly NOT decided here.

---

## 5. History-generation / incarnation handling (non-binding)

> This section describes a *requirement* that ADR-016 freezes, plus non-binding
> illustration of how a future design *might* satisfy it. The exact
> representation is deferred.

The binding requirement (ADR-016 §Decision D) is that a future protocol MUST
distinguish continuation of the same authoritative history from authoritative
history replacement/rollback. The illustrative placeholder name
`recoveryEpoch` is used below; a future design may adopt any representation
(table, header, field, protocol value). This is a familiar class of mechanism
with mature conceptual precedents — e.g. database incarnation/generation and
fencing-token/epoch-style history identity.

Illustrative epoch-stable events (SHOULD NOT change the history-generation
identity):

```text
API process restart
worker restart
container recreation
host relocation using the exact same authoritative PostgreSQL history
ordinary application upgrade that preserves authoritative history
```

Illustrative epoch-changing events (the identity SHOULD change when the
authoritative history can move backward or be replaced):

```text
restore from historical backup
PITR to an earlier point
recovery from another authoritative database image whose history is not
proven identical
```

### Illustrative mismatch handling

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

A future client MUST NOT infer `client version 8 > server version 6, therefore
client wins`. It MUST also not silently discard Q3 merely because the restored
server no longer contains its former history. One possible handling:

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

A `FUTURE_VERSION` response alone is insufficient to distinguish a buggy client
from an authoritative server rollback; history-generation identity exists to
make that distinction explicit.

### Rebootstrap rule (illustrative central invariant)

```text
Server-derived state may be replaced;
unsynchronized local intent may not be silently replaced with it.
```

A future rebootstrap operation would therefore preserve pending outbound
operations, their stable identities, unresolved durable outcomes, and required
device/recovery metadata; it MAY replace synchronized row projections,
server-derived caches, server cursors, and other rebuildable state.

### Recovery caveat (binding, restated from ADR-016)

Detecting authoritative history replacement does not itself recover data that
existed after the restored recovery point. For example:

```text
client had previously received ACK for answer version 8
server PITR returns to version 6
client already discarded the ACKed payload from its unsynced outbox
```

A future history-generation mechanism can detect the history break, but it
cannot reconstruct the lost v7/v8 payload. Whether a future Desktop may retain
or salvage previously ACKed local history is a separate future authority/threat
decision, not decided here.

---

## 6. Authoritative commands are not ordinary replicated rows

Offline-first synchronization MUST NOT collapse privileged state transitions
into generic row synchronization. Commands such as submit; force submit;
misconduct; time grant; interruption restore; incident mutation; Proctor
assignment; result publication — remain explicit server-authoritative
operations. Where ambiguous delivery is possible, they MUST retain
command-specific idempotency and receipt semantics. Generic last-write-wins
replication is not an acceptable substitute.

---

## 7. Conflict semantics (illustrative)

A local client may optimistically present locally-entered candidate content;
the server remains responsible for acceptance. Conflicts SHOULD be explicit.
A future client MUST NOT silently overwrite authoritative data after a version
conflict; discard unsynchronized candidate input; reinterpret a permanent server
rejection as success; or convert server-history rollback into an ordinary
latest-version race. A recovery UX MAY distinguish at least: synced; saved
locally / waiting for sync; sync retrying; conflict requiring reconciliation;
server recovery detected; permanently rejected. Exact UX is deferred.

---

## 8. Local storage technology — build vs. adopt (open question)

No storage implementation is selected. Candidates a future design MAY evaluate
include: native SQLite; SQLite through a Desktop runtime; a purpose-built
operation journal; an offline-first synchronization framework. The
implementation SHOULD prefer a transactional local store capable of atomically
persisting local state and outbound intent.

This note explicitly does NOT reject any framework. "Not selected now" is not a
rejection. The following are non-binding references for future evaluation only;
none is adopted or rejected by this document:

* Syncular
* PowerSync (documented as a server-authoritative local-first model)
* ElectricSQL / TanStack DB
* Replicache
* CRDTs
* Electron
* Tauri

Adopting any of them requires a separate reality audit and decision that
compares build-vs-adopt against the then-current Exam protocol and requirements.

---

## 9. Sync framework boundary (illustrative constraints)

If a synchronization framework is adopted in the future, it MUST coexist with
the binding boundary (ADR-016): it MUST NOT become the authority for Exam state
transitions; it MUST coexist with explicit authoritative Exam commands; its
local outbox MUST preserve stable replay identity; server-derived projections
MUST be rebootstrap-able; unsynchronized intent MUST survive rebootstrap;
server-history recovery MUST have an explicit history-generation/reset
mechanism; protocol/schema upgrades MUST NOT silently invalidate durable
pending intent; and deterministic failure/restart tests are required.

---

## 10. Security boundary (illustrative, including missing threat classes)

Offline durability increases the value and sensitivity of local client storage.
A future implementation MUST separately address at least: local answer
confidentiality; OS account access; device theft; local database copying;
rollback of client files; tampering with client state; encryption key storage;
secure deletion after retention expiry; and code signing/update integrity.

Local encryption does not confer authority. A candidate controlling the local
machine must still be unable to forge authoritative server facts merely by
modifying local storage.

### Threat classes a future design MUST additionally address

These were under-identified in earlier drafts and are recorded here so they
are not lost:

```text
local-store TOCTOU / rollback / mutation attacks
patched or malicious Desktop client injecting fabricated local state
```

A future design must treat the local store and the Desktop binary as
adversarially controlled: any local file or local process output is attacker
input. The server-authority rule (ADR-016) is the ultimate safety boundary —
the server never trusts a local assertion of fact without its own authoritative
acceptance — but a future design must still reason explicitly about how a
patched client cannot escalate preserved *intent* into accepted *fact*, and
how replay of fabricated intent is bounded (e.g. by server-side version
conflict, admission, and receipt semantics). Solving these threats is deferred;
this section only ensures they are named.

---

## 11. Deterministic recovery testing (illustrative future scenarios)

Offline/client recovery behavior SHOULD be tested through deterministic
failure injection. Illustrative required future scenarios include: request
delivered but response lost; disconnect before delivery; disconnect after
server commit; client crash before local ACK persistence; client crash after
local mutation but before synchronization; restart with non-empty outbox;
conflict after reconnect; schema/protocol upgrade with pending intent; server
backup restore while client remains alive; server PITR causing history
mismatch; rebootstrap with pending local writes. Tests SHOULD use explicit
barriers/hooks rather than sleep-based race construction. (Note: deterministic
failure injection against a browser client is itself a non-trivial testing
problem a future design must acknowledge.)

---

## 12. Adoption triggers (restated, non-binding)

Implementation becomes eligible only when a concrete deployment requires one or
more of: managed Desktop examination; candidate continuity across meaningful
LAN outages; restart-safe local answer durability; offline-resilient
exam-package access; or recovery of client intent across a server disaster
restore. None is met today. Before implementation, a fresh reality audit is
required, including re-auditing current answer/save/submit protocols; ADR-004;
ADR-016; build-vs-adopt synchronization options; the local-data threat model;
and the history-generation mechanism against the implemented P7-C restore
model.
