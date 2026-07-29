# Operator Grant Reachability Witnesses

These configs run target semantics only. Each checks an intentionally false
invariant so TLC must produce the named trace:

| Config | Required named violation | What the trace proves |
| --- | --- | --- |
| `ServerSameAttemptReplay.cfg` | `NoSameAttemptReplayWitness` | distinct transactions with the same operationId, Attempt, and payload reach `idempotent_replay` |
| `ServerSameAttemptPayloadConflict.cfg` | `NoSameAttemptDifferentPayloadConflictWitness` | same operationId + same Attempt + different payload reaches `idempotency_conflict` |

They are reachability evidence, not legacy-defect counterexamples. All legacy
flags remain `FALSE`.
