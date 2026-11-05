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
| Structured logs | `Answer save rejected` WARN line (`attemptId`, `questionId`, `clientSeq`, `reason`, `serverVersion`, automatic `reqId`); 5xx error lines also carry `reqId` | The server evaluated and refused/faulted a save, with a machine-readable reason | What the UI displayed; durable history beyond log retention |
| Error envelope `requestId` | Returned to the client on protocol errors; equals the log line's `reqId` | Correlation between a candidate-reported error and server logs | That the request was processed if no line exists |
| Client event telemetry (`client_events`) | Self-service browser telemetry (#544), deduplicated by `eventId` (#863), 30-day retention | What the browser believed/reported | Any server-side fact — it is advisory, never authority |

Receipts are protocol metadata, not audit-grade: they cascade-delete with the
attempt. The durable command/audit records are separate models and are not
part of save-failure evidence.

## Six-fact classification

Classify every reported "failed save" into exactly one fact. The first five
require positive evidence; absence of evidence never selects F1.

| Fact | Positive evidence | Meaning |
| --- | --- | --- |
| **F1 — pre-arrival loss** | Client-side proof that no request was ever sent or completed (e.g. offline queue never flushed, connection refused before send) | The save never reached the API. |
| **F2 — server rejection** | HTTP 200 with `accepted: false` + `reason`, plus the matching `Answer save rejected` WARN line | The server evaluated the save and refused it. No receipt, no answer change. Reasons: `STALE_VERSION`, `ATTEMPT_ALREADY_SUBMITTED`, `INVALID_ANSWER`, … This is a protocol verdict, NOT a transport failure. |
| **F3 — transaction/route failure** | HTTP 5xx (or internal error) for that `reqId`; no receipt for the `clientSeq` | The save did not commit; the receipt + answer write are atomic. Retryable. |
| **F4 — ACK loss** | A receipt exists for that `(question, clientSeq)` and attempt state reflects it, but the client never observed `accepted: true` (timeout, tab close, response dropped) | The save IS durable — the client's belief is false. Re-sending the same `clientSeq` is idempotent and returns the recorded result. |
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
exists usually lands in F6 unless receipts settle it (F4/F5) or domain state
shows the save never happened (F2/F3 with a retained `reqId`).

## Operator procedure

1. Collect `attemptId`, `questionId`, `clientSeq`, the approximate client
   time, and the UI error's `requestId` (if displayed).
2. Check receipts for that question, newest first:

   ```sql
   SELECT client_seq, accepted_version, saved_at
   FROM exam_answer_save_receipts
   WHERE attempt_id = :attempt
     AND question_id = :question
   ORDER BY client_seq DESC
   LIMIT 20;
   ```

3. Check current attempt state (status; then read the question's entry from
   the returned `answers` array):

   ```sql
   SELECT status, answers
   FROM exam_attempts
   WHERE id = :attempt;
   ```

4. Search the app logs for the `reqId` (exact correlation) and for
   `"Answer save rejected"` lines whose `attemptId` / `clientSeq` match. A
   rejection line exists for every `accepted: false` verdict.
5. Classify using the matrix above. Record F6 (UNKNOWN) explicitly rather
   than asserting non-arrival.
6. Follow-up per fact: F2 is candidate-correctable (reload the attempt /
   refresh the version); F3 is a retry; F4 needs no data recovery — a client
   retry is safe because the protocol is idempotent; F5 is a client-observation
   inconsistency, not a data loss; F6 is an evidence gap.

## Why there is no durable refusal record (#861 decision)

The #861 decision frame compared three options: (a) a new durable refusal
table, (b) advisory evidence only — structured rejection logs plus the
existing receipts/domain state, (c) reviving a deprecated action. Option (b)
was adopted; (a) failed its own necessity test and (c) remains forbidden.

- **Business necessity:** a refusal is fully reconstructible from the absence
  of a receipt plus the current attempt state; no business decision consumes
  a refusal row.
- **Atomicity:** a refusal row would either join the save transaction (adding
  writes to the highest-frequency reject path) or sit outside it (allowing
  refusal/state divergence — a second failure model).
- **Retention:** rejections are unbounded and client-retry-driven; each would
  need its own lifecycle and cascade semantics.
- **Write amplification:** every `accepted: false` would become a durable
  write while carrying no new information beyond `(attempt, question,
  clientSeq, reason, requested version)` — exactly the log line's fields.

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
