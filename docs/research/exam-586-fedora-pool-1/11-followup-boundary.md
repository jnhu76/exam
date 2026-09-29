# #586 — 11 Follow-up boundary

Status: BOUNDARY STATEMENT. This file fixes what the #586 record does and
does not authorize, so that the research record cannot be cited as
authority for out-of-scope changes.

## What #586 established

- A pool of 20 or 30 does not reduce submit tail latency in the tested
  mechanism; at N=200 it degrades it 2.6–2.7× (single measurement per
  cell; replication incomplete).
- A candidate mechanism: the EXAM-558 deadline-authority read takes an
  **exclusive** Exam row lock inside every submit transaction and holds
  it to COMMIT, converting the submit transaction into a de-facto serial
  section for same-exam candidates; the pool cap sets convoy depth.

## Authorized follow-up (derived directly from the finding)

Testing whether the EXAM-558 serialization point can use a **shared**
Exam row lock (`FOR SHARE`) — preserving both required linearizations
(candidate-wins writer blocking; writer-wins stale-snapshot safety) while
letting same-exam candidate readers coexist. This is performed in the
separate research record `docs/research/exam-558-lock-mode-1/` under its
own scope freeze. #586 itself does not prove that hypothesis.

## NOT authorized by #586

Changes to any of the following require their own issue, design and
authorization — #586 must not be cited as their basis:

- production pool size or pool configuration (including pinning pool 10);
- submit transaction boundary (including "commit earlier" / split
  submit-and-grade transactions);
- grading lifecycle, delayed/background grading, grading job queues,
  worker topology, `pending_auto`-style states;
- candidate-visible submit success semantics;
- PgBouncer, Redis/MQ or other infrastructure substitutions;
- reconciliation of the incomplete main-matrix replication is available
  by re-running the frozen remaining cycles with the retained harness —
  it is a confirmation step, not a new experiment.

## Evidence boundary between #586 and #558

#586 discovered the convoy hypothesis from pool-variation evidence and
lock sampling. The #558 record tests the hypothesis by varying only the
Exam row-lock mode at fixed pool 10. Neither record may be cited as
evidence for the other's treatment; each carries its own matrix,
samplers and decision file.
