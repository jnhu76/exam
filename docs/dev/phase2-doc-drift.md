# Phase 2 Document Drift Audit

> Phase F of Phase 2 收口. Audit whether existing documentation matches the
> implementation. No large new docs are written here; only misleading content
> is corrected or marked stale. ADRs must record real status (not proposed-as-
> completed).

## Summary

Documentation is broadly aligned. The drift is concentrated in three areas:
(1) the **ADR-007 number collision** — three files share the "ADR-007" number;
(2) the **phase-roadmap Phase 2 scope** lists capabilities (timing modes, queue)
>that are only partially/documented-but-not-active; (3) a few stale
>descriptions of Redis as "not needed / deferred" that pre-date the Phase 2
>收口 Redis baseline. None of these is a MUST FIX for correctness; most are
>SHOULD FIX (clarity for maintainers).

## Drift matrix

| Document | Says | Implementation does | Action | Priority |
|---|---|---|---|---|
| `docs/adr/ADR-001-redis.md` (Decision §) | "Do not introduce Redis in Phase 2 single-instance LAN deployment" + "Redis baseline has been introduced" (later section) | Redis baseline IS introduced (Phase C); plugin + compose + diagnostics | Slight internal tension: the "Decision" header still reads "Do not introduce Redis" while the "Phase 2 Decision" + "Redis Baseline" sections say it is introduced. Add a one-line pointer at the top of Decision noting the 收口 superseded it. | SHOULD FIX |
| `docs/phase-roadmap.md` Phase 2 in-scope | "timed_sync / deadline / untimed timing modes"; "Queue admission" | Only `timed_window` is implemented (AGENTS.md confirms Phase 1 only); queue is in-process Map; others documented-but-not-active | Add a note that these are documented/forward-looking, only `timed_window` + in-process queue are active | SHOULD FIX |
| `docs/adr/` — 3 files share "ADR-007" | `ADR-007-flake-and-speed-audit.md`, `ADR-007-phase6-evidence-gap-audit.md`, `ADR-007-stateful-infrastructure-test-isolation.md` | Three distinct ADRs under one number | Renumber two of them (e.g. ADR-008, ADR-009) to remove the collision; or add a disambiguating index. Low-risk doc change. | SHOULD FIX |
| `docs/dev/redis-baseline.md` (pre-existing tone) | originally written as if baseline already fully landed | Now accurate after Phase C edits (skip-when-absent, fastify.now, port note added) | Already corrected in Phase C commit ecccf1f | done |
| `README.md` | (stack + commands) | matches package.json scripts and stack | none | — |
| `docs/adr/ADR-005` | Accepted (implemented); error codes/audit actions/canceled state | matches examStateMachine + reconciliation + audit actions | none | — |
| `docs/adr/ADR-006` | Accepted; now.ts canonical, guardrail active | guardrail green (Phase C fixed system.ts) | none | — |
| `docs/adr/ADR-002/003/004` | Deferred | WebSocket/SSE, job queue, desktop all not implemented | none (accurate) | — |
| `docs/dev/test-flakes.md` BUG-FLAKE-001 | "I/O contention not fixed, mitigated by serial containment" | confirmed by Phase D audit | none (accurate, detailed) | — |
| `docs/known-test-isolation-issues.md` K-1 | shared-DB sub-set pagination residue | confirmed pre-existing | none (accurate; tracked) | — |

## Stale documents/sections

- **ADR-001-redis.md "Decision" section**: the header "Do not introduce Redis in
  Phase 2 single-instance LAN deployment" predates the 收口 Redis baseline.
  The later "Phase 2 Decision" and "Redis Baseline" sections correctly record
  the baseline. A reader hitting the Decision section first may be confused.
  This is the only genuinely misleading section; the rest of the ADR is accurate.
- **phase-roadmap.md Phase 2 in-scope list**: lists "timed_sync / deadline /
  untimed" and "Queue admission" as in-scope without flagging that only
  `timed_window` and an in-process queue are active. Acceptance signals even
  say "Non-timed_window timing modes have documented lifecycle behavior" —
  which is true (documented) but could read as implemented. Mild.

## Missing documents/sections

- No single **observability contract** document exists (added in Phase G).
- No top-level **API reference document** beyond the OpenAPI/Swagger UI at
  `/_dev/api-reference` (acceptable; the contract audit captures the shape).
- These are added/new, not drift.

## Docs that should not be changed yet

- `docs/SPEC.md` — the specification authority; drift here is resolved in
  favor of SPEC, not by editing SPEC (per AGENTS.md).
- `docs/dev/test-flakes.md`, `docs/known-test-isolation-issues.md` — active
  registers; accurate and in use. Do not edit as part of 收口.
- `docs/dev/test-ci-parallelism-plan.md`, `docs/dev/test-suite-taxonomy.md` —
  forward-looking Phase 3+ plans; accurate as plans.
- ADR-002/003/004 (Deferred) — accurately reflect not-implemented state.

## MUST FIX docs

None. No document makes a false claim about security, tenant boundary, or
business semantics. The drift is clarity/status-labeling, not correctness.

## SHOULD FIX docs

1. **ADR-001-redis.md**: add a one-line note at the top of the "Decision"
   section pointing to the "Phase 2 Decision"/"Redis Baseline" sections so the
   baseline is not read as rejected. (Local, low-risk.)
2. **phase-roadmap.md Phase 2 scope**: annotate timing modes + queue as
   "documented / forward-looking; only timed_window + in-process queue active
   in Phase 2" to avoid implying full implementation.
3. **ADR-007 collision**: renumber two of the three ADR-007 files (or add an
   `docs/adr/README.md` index disambiguating them) so ADR numbers are unique.

> These are deferred to a small follow-up doc PR; they do not block 收口.
> Per the task's "只修会误导维护者/开发者的文档" rule, they are worth doing
> but are isolated edits, not mixed into the 收口 audit commits.

## DEFER

- Reconciling the three ADR-007 documents' internal cross-references after
  renumbering (touches several docs that link to "ADR-007").
- A full API reference doc (the OpenAPI UI serves this).
