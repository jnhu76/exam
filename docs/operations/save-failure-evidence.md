# Answer Save Failure Evidence and UNKNOWN Semantics

> Scope: establishing what happened when a candidate reports that an answer
> "did not save". Applies to the versioned, idempotent save protocol
> (`POST /attempts/:attemptId/answers/:questionId`). Treats the server's save
> receipts, attempt domain state, request correlation, and structured logs as
> the authoritative evidence, in that order. Related: #861, #867.
>
> This document is NOT a content-truth contract: a receipt proves the protocol
> accepted a write at a server instant, never that the answer content was
> correct, complete, or unchanged. See the receipt-summary projection tracked
> in #866 for the read-only metadata view.

## Authority hierarchy

| Evidence | What it is | Proves | Does NOT prove |
| --- | --- | --- | --- |
| Save receipt (`exam_answer_save_receipts`) | One immutable row per ACCEPTED `(attempt, question, clientSeq)`, written atomically with the answer state | The protocol accepted that replay key at `saved_at`, at `accepted_version` | Content correctness; that the client received the ACK; that a later failed save did not happen |
| Attempt domain state (`exam_attempts.answers`) | Current saved answer + per-answer `version` / `savedAt` | The current authoritative saved value and version | Anything about the client's observation |
| Structured logs | `Answer save rejected` WARN line (`organizationId`, `actorId`, `actorRole`, `attemptId`, `questionId`, `clientSeq`, `reason`, `serverVersion`, automatic `reqId`); error responses also carry `reqId` | The server evaluated and refused/faulted a save, with a machine-readable reason, tenant- and actor-scoped | What the UI displayed; durable history beyond log retention |
| Error envelope `requestId` | Returned to the client on error responses (400/5xx); equals the log line's `reqId` | Correlation between a candidate-reported error and server logs | That the request was processed if no line exists. The 200 `accepted: false` rejection body deliberately carries no `requestId` — correlate F2 by `attemptId` + `questionId` + `clientSeq` and the client's approximate time |
| Client event telemetry (`client_events`) | Self-service browser telemetry (#544), 30-day retention | What the browser believed/reported | Any server-side fact — it is advisory, never authority |

Receipts are protocol metadata, not audit-grade: they cascade-delete with the
attempt. The durable command/audit records are separate models and are not
part of save-failure evidence.

## Six-fact classification

Classify every reported "failed save" into exactly one fact. The first five
require positive evidence; absence of evidence never selects F1.

| Fact | Positive evidence | Meaning |
| --- | --- | --- |
| **F1 — pre-arrival loss** | Client-side proof that no request was ever sent or completed (e.g. offline queue never flushed, connection refused before send) | The save never reached the API. |
| **F2 — server rejection** | HTTP 200 with `accepted: false` + `reason`, plus the matching `Answer save rejected` WARN line | The server evaluated the save and refused it. This rejection creates no new receipt and changes no answer. An EARLIER receipt for the same `(question, clientSeq)` can still exist (`CONFLICTING_PAYLOAD`: the key was reused with a different canonical answer), so receipt-first investigation must not stop at "a receipt exists". Reasons: `STALE_VERSION`, `CONFLICTING_PAYLOAD`, `ATTEMPT_ALREADY_SUBMITTED`, `ATTEMPT_CLOSED`, `DEADLINE_EXCEEDED`, `INVALID_ANSWER`, … This is a protocol verdict, NOT a transport failure. |
| **F3 — transaction/route failure** | HTTP 5xx, or HTTP 409 `RESOURCE_CONFLICT` when a retry-exhausted/constraint failure is mapped to conflict (error envelope carries `requestId`); no new receipt for that `clientSeq` — a concurrent winner may already have one | The save's transaction did not commit; receipt + answer write are atomic, so no partial state exists. A concurrent winner may have committed the same replay key — check its receipt before retrying. Retryable. |
| **F4 — ACK loss** | A receipt exists for that `(question, clientSeq)` with the same canonical answer, and the version lineage is consistent, but the client never observed `accepted: true` (timeout, tab close, response dropped) | The save IS durable — the client's belief is false. An older receipt still proves the save it recorded was accepted, even if newer saves exist. Re-sending the same `clientSeq` with the SAME canonical answer while the attempt is still open returns the recorded result with zero new writes; a receipt for an older `clientSeq` does not describe current state, and replay stops returning the receipt once the lifecycle/deadline guards reject first. |
| **F5 — success** | Receipt exists and the client observed `accepted: true` | The save is durable and acknowledged. |
| **F6 — UNKNOWN** | Evidence missing, insufficient, or conflicting: logs rotated past retention, no `reqId` retained, time window ambiguous, attempt deleted (receipts cascaded) | The fact cannot be established. Report UNKNOWN explicitly. |

**Invariant (UNKNOWN boundary):** a missing server record MUST NOT be read as
"the request never arrived". Log retention is finite, clients can fail before
sending, and a request may still be in flight. "No row" plus "no log line" is
at most consistent with F1 — it becomes F1 only with independent client-side
proof; otherwise it is F6.

**Retention asymmetry:** client telemetry is bounded at 30 days; save receipts
live until the attempt is deleted; logs follow deployment log policy. A
candidate report arriving after log rotation but while the attempt still
exists usually lands in F6 unless receipts settle it (F4/F5) or the retained
logs/domain state settle F2/F3.

## Operator procedure

1. Collect `attemptId`, `questionId`, `clientSeq`, the approximate client
   time, and — when the UI showed an error envelope (5xx/transport) — its
   `requestId`.
2. Read the attempt's organization and current state (then locate the
   question's entry in the returned `answers` array):

   ```sql
   SELECT organization_id, status, answers
   FROM exam_attempts
   WHERE id = :attempt;
   ```

3. Check receipts for that question, newest first by SERVER time (`clientSeq`
   is a client key, not a monotonic clock). `:org` is the `organization_id`
   from step 2; it is the PK prefix and keeps the lookup index-backed:

   ```sql
   SELECT client_seq, accepted_version, saved_at
   FROM exam_answer_save_receipts
   WHERE organization_id = :org
     AND attempt_id = :attempt
     AND question_id = :question
   ORDER BY saved_at DESC, client_seq DESC
   LIMIT 20;
   ```

4. Search the app logs for the `reqId` (exact correlation, error responses)
   and for `"Answer save rejected"` lines whose `attemptId` / `questionId` /
   `clientSeq` match. A rejection line exists for every `accepted: false`
   verdict; the 200 rejection body carries no `requestId`, so those three
   fields plus the time window are the keys.
5. Classify using the matrix above. Record F6 (UNKNOWN) explicitly rather
   than asserting non-arrival.
6. Follow-up per fact: for F2, `STALE_VERSION` is resolved by reloading the
   attempt and refreshing the version; `INVALID_ANSWER` is a shape/
   canonicalization problem — correct the answer and retry with a fresh
   `clientSeq`; `CONFLICTING_PAYLOAD` means the client reused a `clientSeq`
   with different content — never retry that key, allocate a fresh one and
   reconcile the stored content; lifecycle/deadline reasons
   (`ATTEMPT_ALREADY_SUBMITTED`, `ATTEMPT_CLOSED`, `DEADLINE_EXCEEDED`) are not
   fixed by a retry. F3 is a retry; F4 needs no data recovery — a same-answer
   client retry is safe while the attempt is open; F5 is a client-observation
   inconsistency, not a data loss; F6 is an evidence gap.

## Why there is no durable refusal record (#861 decision)

The #861 decision frame compared three options: (a) a new durable refusal
table, (b) advisory evidence only — structured rejection logs plus the
existing receipts/domain state, (c) reviving a deprecated action. Option (b)
was adopted; (a) failed its own necessity test and (c) remains forbidden.

- **Business necessity:** the refusal verdict and its reason are carried by
  the 200 response and the WARN line; receipts plus domain state prove
  accepted saves. No business decision consumes a durable refusal row, and
  the absence of a receipt alone never proves a refusal (that is the UNKNOWN
  boundary).
- **Atomicity:** a refusal row would either join the save transaction (adding
  writes to the highest-frequency reject path) or sit outside it (allowing
  refusal/state divergence — a second failure model).
- **Retention:** rejections are unbounded and client-retry-driven; each would
  need its own lifecycle and cascade semantics.
- **Write amplification:** every `accepted: false` would become a durable
  write while carrying no new information beyond what the log line already
  records — `(organization, actor, attempt, question, clientSeq, reason,
  serverVersion)`. The request's `baseVersion` is not logged; diagnose a
  version conflict from the client's reported `clientSeq` + `reason` +
  `serverVersion` and the receipt/state timeline.

Adopted boundary: one structured WARN line per rejection, correlated by the
automatic `reqId`, containing ids/reason/version only — never answer content
and never a new table or wire contract. Adopting the log line does not claim
durability; if future operations require refusal history beyond log
retention, that is a new explicit decision and MUST extend the existing
receipt/command-receipt model rather than create a second failure ledger.

## Rejected alternatives

- **Persisting every refusal** — see above (write amplification, no new fact).
- **Treating client telemetry as server truth** — telemetry is low-trust and
  may be lost exactly when the client is failing; it can corroborate but never
  decide.
- **Using a missing row as proof of non-arrival** — violates the UNKNOWN
  boundary and produces false operational claims.
