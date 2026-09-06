# ADR-011 Amendment — Delivery-attempt and abandoned-work semantics

- **Status:** ACCEPTED
- **Date:** 2026-09-06
- **Amends:** ADR-011 §26 Q3–Q5
- **Issue:** #482
- **Relationship:** This is a normative corrective amendment to ADR-011. ADR-011 §26 Q1–Q2 remain unchanged. For Q3–Q5, this amendment supersedes the wording in ADR-011 §26 where the two differ.

## 1. Reason for this corrective amendment

Issue #482 correctly separated two events that the deployment regression test had previously conflated:

1. queue claim / ownership establishment; and
2. execution of a delivery attempt.

The first §26 wording fixed that test bug, but Q3–Q5 over-froze details of the current implementation. In particular, it treated `EmailSender.send()` entry as if it were the external side-effect boundary, required `locked_at` to remain byte-for-byte unchanged across shutdown, and treated `recoverAbandoned -> pending -> claim by B != A` as the semantic definition of at-least-once recovery.

Those are useful facts about the current implementation and TEST 17, but they are not all durable architecture invariants. The durable contract is narrower: claim is not execution; unknown delivery outcome must not be made immediately retryable merely for convenience; and abandoned work must be reclaimed under valid fresh fenced ownership before retry.

## 2. Q3 — Delivery-attempt execution boundary

After a row is claimed, entry into `EmailSender.send()` establishes that **sender-adapter execution has begun**. It is a second lifecycle event after queue ownership establishment.

It does **not** prove that:

- provider/network I/O has already occurred;
- SMTP/provider acceptance has happened; or
- external delivery succeeded.

Conceptually:

```text
pending / due retry_wait
        | claim
        v
processing (valid ownership)
        | sender-adapter execution begins
        v
delivery attempt in progress
        | provider/network work may occur
        v
provider outcome known or unknown
```

The current persisted outbox state machine remains:

```text
pending | processing | retry_wait | sent | dead
```

This amendment does **not require or authorize** a new persisted `sending` or `in_flight` status. The runtime execution phase remains represented by `processing` in the current design. A future persisted execution sub-state would require a separate accepted ADR change; it is not forbidden forever by this amendment.

For TEST 17 specifically, the fake-sender send-entered witness proves only the test property it needs: execution entered `FakeEmailSender.send()` before the simulated delay, so `docker stop` occurs after sender-adapter execution has begun. It is not a claim that real SMTP I/O has already happened.

## 3. Q4 — Unknown-outcome shutdown safety

When shutdown abandons a delivery attempt after external delivery **may** have begun and the durable delivery outcome is not known, shutdown MUST NOT make the row immediately claimable merely to accelerate retry.

The safety property is:

> Unknown delivery outcome must retain valid fenced ownership / lease protection until the accepted abandoned-work recovery rule permits reclaim.

This prevents shutdown from converting uncertainty into an immediate duplicate-send opportunity.

### 3.1 Current implementation evidence

The current implementation satisfies that rule by leaving the row:

```text
status    = processing
locked_by = current owner
locked_at = current claim/lease timestamp
```

unchanged when the bounded in-process shutdown gives up waiting. TEST 17 intentionally asserts the owner and timestamp byte-for-byte to guard this **current implementation**.

That byte-for-byte representation is not itself the timeless architecture rule. A future accepted implementation may, for example, renew a valid lease while a long attempt is in progress, provided it preserves equivalent fencing and does not make an unknown-outcome row prematurely claimable.

Any change that alters the ownership/lease safety model still requires explicit architecture review; this amendment merely avoids freezing `locked_at` immutability as the semantic contract.

## 4. Q5 — Abandoned-work recovery

The durable recovery requirement is:

1. stale / abandoned ownership becomes reclaimable only according to the accepted expiry/recovery rule;
2. a retry must acquire valid **fresh fenced ownership** before executing the delivery attempt again; and
3. the recovery path must preserve at-least-once semantics without allowing concurrent valid owners for the same row.

Semantic form:

```text
processing (stale ownership)
        | accepted expiry / recovery rule
        v
safely reclaimable
        | acquire fresh fenced ownership
        v
processing (current valid ownership)
        | execute delivery attempt again
        v
at-least-once redelivery path
```

### 4.1 Current implementation evidence

The current repository implements the above as:

```text
processing (owner=A)
        | lock timeout
        v
recoverAbandoned
        v
pending (lock fields cleared)
        | claim
        v
processing (owner=B)
```

The process-start worker identity contains a fresh UUID, so in TEST 17's restart scenario `B != A` is strong evidence that the restarted process performed the reclaim.

However, `B != A` is **test evidence, not the definition of at-least-once delivery**. A future design could use a stable logical worker identity plus a fresh fencing token / lease generation and still satisfy this ADR, if the ownership semantics remain safe and explicitly accepted.

Likewise, the transient `pending` state is the current repository implementation, not the only semantically valid recovery representation. An explicitly accepted future design could use an atomic expired-owner reclaim if it provides equivalent durable fencing and recovery safety.

## 5. What remains unchanged from ADR-011 §26

ADR-011 §26 Q1 and Q2 remain normative without modification:

- `pending/retry_wait -> processing` establishes queue ownership, not evidence that send execution has begun;
- `processing` requires valid persisted ownership evidence (`locked_at` and `locked_by` in the current schema).

The following broader ADR-011 decisions also remain unchanged:

- PostgreSQL `email_outbox` remains the workload-specific delivery queue;
- delivery remains at-least-once, not exactly-once;
- duplicate delivery remains an accepted V1 limitation;
- `FOR UPDATE SKIP LOCKED` claim semantics remain the current implementation;
- retry/backoff policy is unchanged;
- bounded shutdown budgets are unchanged;
- Redis/BullMQ/Kafka/general-purpose queue adoption is unchanged.

## 6. TEST 17 authority boundary

TEST 17 is a regression proof for the current implementation. It may assert implementation-specific evidence more strongly than this ADR's portable semantic minimum, including:

- original `locked_by` and `locked_at` remain unchanged across the bounded shutdown;
- restart produces a different process-scoped `locked_by` value;
- current `recoverAbandoned -> pending -> claim` behavior eventually reclaims the row.

Those assertions are valuable because they detect drift in the implementation currently shipped. They must not be read backwards as proof that every future conforming ownership implementation must use the same physical representation.

## 7. Decision summary

The corrected durable split is:

```text
QUEUE AUTHORITY
claim -> valid fenced ownership

DELIVERY-ATTEMPT EXECUTION
sender-adapter execution begins

UNKNOWN-OUTCOME SHUTDOWN SAFETY
do not make the row immediately retryable merely for convenience

ABANDONED-WORK RECOVERY
expiry/recovery -> fresh fenced ownership -> retry
```

This amendment intentionally separates **semantic safety** from the **current lease representation** while preserving the stronger current-implementation regression checks in TEST 17.