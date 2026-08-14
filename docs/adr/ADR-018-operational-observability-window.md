# ADR-018 — Operational Observability Window

## Status

* Status: **ACCEPTED** (2026-08-14 — P7 final program closeout,
  [`docs/audits/P7-FINAL-PROGRAM-CLOSEOUT.md`](../audits/P7-FINAL-PROGRAM-CLOSEOUT.md);
  proposed 2026-08-13 with ADR-017 rev 4, accepted after the runtime boundary
  check in that closeout — the current `/system/*` surfaces already realize
  the window contract)
* Date: 2026-08-13 (proposed); 2026-08-14 (accepted)
* Decision owners: project
* Supersedes: none
* Superseded by: none
* Related decisions:
  * ADR-017 — Operational Authority and Maintainer Boundary (**revision 4
    references this ADR**). ADR-017 rev 4 defines *who* observes (the
    Application Maintainer, read-only); this ADR defines *what may flow
    through the window and under what contract*.
  * ADR-010 — Scoped RBAC Architecture
  * P7-C portable persistence / backup / PostgreSQL DR (closeout)

---

## Context

ADR-017 revision 4 narrows the Application Maintainer to a **read-only
Operational Observer**: "Exam gives the Maintainer a window, not a hand."
Future operational data — logs, metrics, events, diagnostic materials,
backup/recovery evidence, runtime state — may all be presented through that
window, but the product must **never** mutate, execute, configure, restart, or
restore through it.

This ADR establishes the **clean read-only product boundary** that future
runtime data plugs into. It deliberately does **NOT** introduce a generic
observability platform, a new storage system, or any data backend. It freezes
the **contract** future integrations must satisfy, so the window can grow
without ever becoming an infrastructure control console.

**Explicit anti-goals (NOT in this ADR / not now):** Loki, Elasticsearch,
ClickHouse, OpenTelemetry collectors, log shipping, a generic observability
database, a plugin framework, a browser terminal / shell console, a backup
trigger / restore / restart / secret-editor button. None is introduced. Each
would require its own ADR and is out of scope for the current milestone.

---

## Decision

### D1. The window is read-only and evidence-shaped

The Maintainer surface presents **Operational Evidence** — never an execution
handle. Conceptually:

```text
Operational Observability
│
├── Health / Metrics
├── Logs
├── Events
├── Diagnostic Materials / Artifacts
├── Backup Evidence
└── Recovery / Restore Evidence
```

Today the window is realized by the existing read-only `/system/*` routes
(health, diagnostics, backups, restore-readiness, ops-policy) and the
Operations page. The current data is **truthful and bounded**; nothing is
faked and no dead button pretends a backend exists.

### D2. The data-provider contract (six invariants)

All future operational runtime data exposed to the Maintainer **MUST**
satisfy:

1. **Read-only.** The product does not mutate the source through a view
   permission. A `*.view` capability never authorizes a side effect
   (ADR-017 D7 invariant).
2. **Redacted.** Secrets and sensitive business data are filtered
   **server-side** before the response. Never rely on frontend hiding.
3. **Domain-separated.** Operational data must not accidentally expose
   candidate PII, candidate answers, grading contents, question-bank
   contents, scores, or business audit detail — unless a separately
   authorized business capability explicitly allows it. (This is the
   ADR-017 D8 principle generalized to every future source.)
4. **Bounded.** Log/material APIs MUST support bounded reads: time range,
   limit, pagination/cursor, maximum payload. No unbounded `SELECT *` or
   "download entire log directory."
5. **Source-aware.** Future evidence identifies its source, timestamp,
   service/component, and correlation id where available.
6. **Truthful.** A missing data source renders `UNAVAILABLE` / `NOT CONNECTED`
   / `NO EVIDENCE` — never fake success.

### D3. Semantic taxonomy — do not collapse into one table

Future operational data falls into four kinds. They are **NOT** forced into one
DB table; each source may have its own storage, and the product provides only a
read projection.

| Kind | Meaning | Examples |
| --- | --- | --- |
| **Metrics** | Quantitative runtime measurements | CPU, memory, DB latency, queue depth |
| **Logs** | Textual / structured runtime records | API errors, worker logs, DB/runtime logs |
| **Events** | Discrete lifecycle / operational occurrences | scanner delayed, service startup, backup completed, backup failed, recovery drill recorded |
| **Materials / Artifacts** | Durable diagnostic / evidence objects | diagnostic bundle, backup evidence, restore-drill evidence, generated reports |

The current `/system/*` surfaces are a partial realization: health/diagnostics
(metrics + operational logs), backups (materials/evidence), restore-readiness
(drill evidence), ops-policy (reliability objective + compliance projection).

### D4. Correlation direction — and its boundary

The window should make it possible to correlate by timestamp, `requestId`,
service, worker, `operationId`, backup-run id, and `examId`/`attemptId`
**only when safe and redacted**. The hard rule:

> An operational Maintainer must **NOT** automatically receive business-domain
> detail just because a correlation key exists.

```text
ALLOWED for Maintainer:                      FORBIDDEN without extra authority:
  "attempt processing latency spike"           candidate name
  "affected attempt count = 17"                candidate answer
                                               question content
                                               score
```

Server-side projection/redaction is required; correlation keys never carry an
implicit grant of business detail.

### D5. Conceptual UI shape (preparation only — no fake data)

```text
Operations / 系统运维
│
├── Overview              (health, DB, Redis, workers, scanners)  — TODAY
├── Evidence              (backup, restore readiness)             — TODAY
└── Runtime Data
    ├── Metrics           (future)
    ├── Logs              (future)
    ├── Events            (future)
    └── Materials         (future)
```

Acceptable preparation: a neutral route/layout structure; a typed frontend
section model; clearly marked `UNAVAILABLE` / not-yet-connected states;
reusable read-only query/filter presentation primitives **only if genuinely
needed**; documentation of the data-provider boundary. **Forbidden:** faking
data for future sections, dead buttons pretending a backend exists, or a
generic plugin framework.

### D6. Infrastructure execution stays outside the window (and outside Exam RBAC)

The following stay **outside Exam RBAC** entirely — they are Host Operator
authority, granted by host/CLI access, never by an Exam login:

```text
SSH, terminal, Docker, Compose, systemd, PostgreSQL administration,
WAL, pgBackRest, filesystem, secrets, restore, PITR
```

A real-world person may hold an Exam Maintainer account **plus** host SSH
access, but these grants are **independent**: an Exam login never implies host
authority, and host authority never implies an Exam account (ADR-017 D12). The
window is a view; it is **not** an infrastructure control console.

### D7. Per-source ADR requirement

Adding a new operational data source to the window requires a recorded
decision proving the source satisfies D2's six invariants, the D3 taxonomy
placement, and the D4 redaction boundary for that source's data. No source is
connected by accident.

---

## Consequences

Positive:

- The Maintainer window has a durable, enforceable contract (D2) that any
  future source can be reviewed against — the window can grow without becoming
  a control console.
- The read-only / redacted / domain-separated / bounded / truthful invariants
  generalize the patterns already proven by the current `/system/*` surfaces
  (D8 integrity split, D7 view≠side-effect).
- Metrics / Logs / Events / Materials are kept distinct (D3), avoiding a
  premature unified store.

Negative:

- Until concrete sources are connected, D2–D4 are contract/prose, not
  runtime-enforced on new sources (enforced by review + per-source ADR, D7).
- The taxonomy (D3) is documentation; it does not create storage.

Risks:

- Scope creep into a generic observability platform. Any proposal to add a
  store, collector, or execution surface must be reviewed against this ADR's
  anti-goals and ADR-017 D4/D5 before design.
- Redaction-by-review (D2/D4) is only as strong as the per-source discipline;
  D7's per-source ADR is the control.

---

## Alternatives considered

1. **Build a generic observability platform now.** Rejected: out of scope, and
   the product must remain LAN/offline-capable with no new storage system. The
   contract (this ADR) is the deliverable; backends are per-source, later.
2. **One unified operational table.** Rejected (D3): metrics, logs, events, and
   materials have different shapes and lifecycles; collapsing them loses
   semantics and invites unbounded reads.
3. **No contract — ad hoc per-route.** Rejected: without D2's invariants, a
   future route could leak business detail (D4) or fake success (D2.6). The
   contract is what keeps the window a window.
