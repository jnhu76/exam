# P7-E3 — Decision Gates (Operational Capability Admissions)

**Status:** CLOSED (2026-08-12) — part of the P7-E closeout
**Program:** P7-E — Operational Control Plane
**Authority:** ADR-017 D5 (decision-gated capabilities), P7-E0 verdict (no
generic settings subsystem), P7-E1 §13.4/§17.3

---

## 1. Purpose

P7-C handed three capabilities to P7-E for a decision: RPO/RTO automation,
retention automation, and Admin backup visibility. ADR-017 D5 classifies
`backup.trigger`, `backup.schedule.manage`, `backup.retention.manage`, and
`service.restart` as **FUTURE DECISION-GATED**: each may enter the product
control plane only under its own recorded decision meeting the D5
conditions (typed contract, least privilege, audit, idempotency, explicit
failure semantics, non-secret abstraction).

This record makes those decisions explicitly — a **NO-GO counts as P7-E
closure**; it must not be written up as "unfinished".

---

## 2. Decision — backup.trigger

**Verdict: DEFERRED (NO-GO today).**

Question: does the current LAN/on-prem MVP genuinely need a product-side
backup trigger?

Evidence considered:

- Deployment model: one Compose stack per organization; the Host
  Maintainer owns the host. Backups run via `scripts/backup/*.sh` on host
  cron or manually — a trigger button would add a second execution path
  for the same mechanism, with no deployment that cannot reach the host.
- Security boundary: a trigger is a *non-destructive* execution surface,
  but it still requires a non-secret typed abstraction (D6) and moves the
  first execution authority into the product. The MVP has no operator who
  is product-only (the ops viewer role exists; the host operator exists;
  no "web-only operator" profile is deployed).
- Failure model: host cron + script retries are well understood; a
  product trigger adds in-flight-state, concurrent-trigger, and
  evidence-reconciliation complexity that the evidence ledger handles only
  for *recorded* runs.
- MVP usability: the Admin/Maintainer Operations views already answer the
  real question ("is the backup posture healthy?") without an execute
  button.

Rationale: the trigger capability has no confirmed consumer whose needs
are unmet by host cron + the evidence ledger. Admitting it would create
the first product-side execution authority for infrastructure — the exact
coupling ADR-017 exists to prevent — without a proven requirement.

## 3. Decision — backup.schedule.manage

**Verdict: DEFERRED (NO-GO today).**

Host cron remains the execution authority. A product-side schedule
manager would require: a scheduler inside the product (forbidden by
P7-E1 §17.3), cross-authority protocol with host cron, and an idempotency
contract for schedule edits. The deployment's schedule is a host fact
(`crontab` / systemd timer), not a product fact; the product renders the
EVIDENCE of runs, which is the truthful posture. No confirmed requirement
for online schedule editing exists.

## 4. Decision — backup.retention.manage

**Verdict: DEFERRED (NO-GO today).**

Retention/pruning remains manual + host-owned with the fail-closed
invariant (ADR-017 D10 #4: pruning must fail closed when safety cannot be
proven). Product-side retention enforcement would require the
cross-authority protocol between host restore actions and product
evidence records (P7-E1 §12.5) — not designed, and not needed by the
current deployment. The compliance projection truthfully renders
retention as `NOT_ENFORCED` (host-managed) rather than pretending the
product enforces it.

Advanced low-RPO retention should be evaluated via **WAL-G / pgBackRest**
as a host-side solution, not by growing an in-product scheduler/retention
engine.

## 5. Decision — service.restart

**Verdict: DEFERRED (NO-GO today).**

Service lifecycle is Compose/host territory. Restart from the product
would be the most destructive control-plane mutation admitted to the
browser — no typed non-secret abstraction exists, and no requirement has
been confirmed. Restart stays `docker compose` on the host.

## 6. Decision — Email worker / runtime operational settings

**Verdict: keep env + restart-required; no online edit.**

Question (P7-E0 §17): does the current product have a confirmed
online-edit requirement for Email worker/retry settings
(`EMAIL_MAX_ATTEMPTS`, `EMAIL_RETRY_BASE_SECONDS`,
`EMAIL_WORKER_POLL_INTERVAL_MS`, `EMAIL_WORKER_BATCH_SIZE`,
`EMAIL_WORKER_LOCK_TIMEOUT_MS`, `EMAIL_WORKER_HEARTBEAT_STALE_MS`,
`EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS`)?

Answer: **no.** These are deployment tuning knobs read at process start;
online editing would require a runtime-reload contract and a typed
settings store — neither is justified by a confirmed requirement. They
remain env-owned and restart-required (now documented in `.env.example`,
E0 P3-4/P3-5 fixed). Rate limits and feature flags stay env/Compose-owned
for the same reason.

## 7. What P7-E DID ship (read-only, per the accepted architecture)

- **Backup evidence** (E2B): typed ledger + read projections
  (`system.backup.view`, `system.restore_readiness.view`) — read-only.
- **Admin backup visibility** (E2C): the Operations view (posture, last
  verified backup, last failure, restore readiness) — the P7-C handoff
  item, delivered as read-only truth.
- **Operational policy intent** (E3): Admin-only DESIRED objectives with
  DESIRED vs OBSERVED vs STATUS rendering — intent only, never binding
  infrastructure.
- **Diagnostics + email-test splits** (E2A): view capabilities never
  authorize side effects; Maintainer never sees business-integrity data.

None of these admits a decision-gated capability; each is either
read-only evidence/intent or an already-accepted authority boundary.

---

## 8. Reopening

Any future admission of `backup.trigger`, `backup.schedule.manage`,
`backup.retention.manage`, or `service.restart` requires a NEW recorded
decision demonstrating the D5 conditions (typed contract, least
privilege, audit, idempotency, explicit failure semantics, non-secret
abstraction) for that specific capability — each independently. This
record is not a standing authorization for any of them.
