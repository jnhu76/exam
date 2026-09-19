# #550 Final capacity re-proof — 10 Adversarial review (fresh context)

Status: FROZEN. A fresh-context reviewer (no prior exposure to this campaign) audited docs 00–09
plus the retained artifacts with active verification: every regeneration tool was re-executed in
a scratch copy of the tree, committed vs regenerated artifacts were diffed, and each headline
number in the docs was cross-checked against its named raw artifact. Question set A–S and the
full evidence trail are in the review transcript; this page records the findings and their
resolutions. All fixes below are doc/harness-text fixes — **no measurement was re-run, no number
changed, no raw artifact was altered**.

## Verdicts by question

| # | question | verdict |
| --- | --- | --- |
| A | claim-to-evidence bound, no extrapolation | MAJOR → fixed (M3, M4 below; no extrapolation found) |
| B | classification vocabulary (4 labels only) | OK |
| C | regeneration drift (active re-derivation) | MAJOR → fixed (M2) |
| D | issue metrics contract (p50/p90/p95/p99/max, errors/timeouts, CPU/mem, pool) | OK |
| E | CI honesty (UNAVAILABLE_BILLING, never PASS) | OK |
| F | architecture freeze (default-OFF instrumentation only) | OK |
| G | secrets in committed evidence | OK |
| H | #549 admission contract exactness (durable oracle) | OK (one doc-column defect → M3) |
| I | #546 rate-limit topologies + rig-deviation honesty | OK (one citation miss → m12) |
| J | #545 long-lived residual re-proof | OK |
| K | soak rotation exercised, 95 min window | OK |
| L | #547 readiness re-proof + vacuous-attempt disclosure | OK |
| M | durable oracle computation (not HTTP-trusting) | OK |
| N | reconnect storm coverage at every scale | OK |
| O | exact tested topology statement | MAJOR → fixed (M5) |
| P | reproducibility of harness commands | MAJOR → fixed (M1) |
| Q | internal consistency after late regenerations | MINOR → fixed (m1–m12) |
| R | non-goal compliance (no tuning, no scope creep) | OK |
| S | repo hygiene (change set exact, no junk) | OK (m8 dropped) |

## Findings and resolutions

| severity | finding | resolution |
| --- | --- | --- |
| **M1** | `harness/README.md` run commands failed as written: `pnpm --filter @exam/db exec` runs with cwd = `packages/db`, so repo-root-relative paths threw ERR_MODULE_NOT_FOUND; `analyze-pool.ts` wrote its cross-run table via `process.cwd()` and broke from any other cwd. | Rewrote README invocation contract: every tool resolves paths from its own file location (`lib/config.ts`), so only the tsx source path matters; documented a `HARNESS=$(git rev-parse --show-toplevel)/…/harness` pattern that works from any directory. `analyze-pool.ts` now derives `RESULTS_DIR` from the config instead of cwd. Verified by re-running the full regenerate chain. |
| **M2** | 14 committed `drift-check.json` reported `ok:false`, unexplained. Root cause: before 2026-09-19T08:00Z the runner recorded the reconnect take-view requests under phase `RECONNECT_RESTORE` in raw JSONL while the committed summary split `RECONNECT_RESTORE`/`RECONNECT_TAKE` — a runtime partition not re-derivable from the JSONL. | `summarize.ts` now merge-compares like-for-like: committed `RECONNECT_TAKE` is merged back into `RECONNECT_RESTORE`; `requests`/`max` compare exactly and the non-regenerable percentile partition is recorded in `drift-check.json` (`partitionNote`), never fake-compared. `run-lifecycle.ts` now records `RECONNECT_TAKE` in the JSONL for future runs. Regenerated: **14/14 drift checks `ok:true`** with the merge note. |
| **M3** | `06` admission "resume wall (ms)" column mixed QUEUE_RESUME max/p99 values and cells matching nothing; actual `resumeWallMs` values in `admission-matrix-…-Z.json` differ (e.g. N200-dt90: doc said 1007, artifact says 1049). Also "≈1.12 s" vs "≈1.13 s" for the same N200-dt150 event. | Column now equals the artifact `resumeWallMs` cell-for-cell (15/15 rows, incl. both N20-dt15 rows 100/105); prose unified on ≈1.13 s with a pointer to the `resumeWallMs` field. |
| **M4** | `03` claimed a lifecycle `auditIps` oracle ("distinctAuditIps = N + admin per run") that the lifecycle runner never computed; the distinct-IP oracle exists only in the topology group. | `03` scoped: lifecycle runs share the same IP-binding scheme, the measured audit-IP evidence is attributed to the topology group (21/51/101), and the oracle table row is marked accordingly. |
| **M5** | `01` "measured rig wiring" still depicted the nginx container although 07 documents that it never worked in this rig (Docker NAT erasure, ineffective host networking) and the proxy topology was measured through the in-harness Node reverse proxy. | `01` diagram and state table now show the as-built wiring (host-side Node reverse proxy with faithful `$proxy_add_x_forwarded_for` semantics, `TRUSTED_PROXY_CIDRS` self-calibrated from live probes) with an explicit as-built note pointing at 07's rig-deviation records. |
| m1 | `05` soak "784–807 requests per window" — the final retirement's ±60 s window is truncated by run end (467). | Corrected to "467–807 (final window truncated by run end)". |
| m2 | `04`/`09` "STEADY satFrac ≤ 0.017" contradicted by `pool-decomposition.md` (S100-r2 = 0.029). | Bound corrected to ≤ 0.029. |
| m3 | `04` note promised "unaggregated `RECONNECT_TAKE` rows" that do not exist in the aggregate output. | Replaced with the accurate lump note (raw JSONL lumps take under `RECONNECT_RESTORE`; committed per-run summaries carry the split). |
| m4 | `03` "every accepted save present with the accepted version" overstated the answers oracle (which spot-checks the last accepted save per candidate, payload only). | Reworded to the implemented assertion. |
| m5 | `09` pointed event-loop data at `pool-analysis.json` (`eventLoop`) which does not exist there. | Pointer corrected to the raw `pool.jsonl` `snapshot.process.eventLoop` records. |
| m6 | `03` proctor cadence "~10 s" vs measured ~3 s (code: 3000 ms). | Corrected. |
| m7 | `05` attempts row (120) was the pre-live snapshot; the final cardinality is 220. | Labeled as snapshot-at-seed with the before/after pointer to `cardinality.json`. |
| m8 | `logs/undefined.api.log.gz` — junk-named crash trace from a failed boot. | Dropped (no campaign evidence). |
| m9 | `02` logs shape `logs/<run_id>/` vs actual `logs/<run_id>.api.log.gz`. | Corrected. |
| m10 | `04`/`09` LOGIN CPU "~850–935%" vs measured 745.4–935.1%. | Corrected to 745–935%. |
| m11 | `09` START_BURST "satFrac 0.5–1.0" without noting S200-r1's burst landed between research polls (0). | Rep-variance noted. |
| m12 | `07` cited one artifact for two distinct facts (collapse in `05-01-07`, 12×502 in `05-21-03`). | Both artifacts cited precisely. |

## Re-verification after fixes

- All regeneration tools re-executed post-fix: `summarize.ts` (14/14 runs `ok:true` with
  `partitionNote` only for the pre-merge reconnect split), `aggregate.ts` (byte-stable vs the
  embedded 04 tables; still 36,961 samples, 13 runs, all oracles pass), `analyze-pool.ts`
  (identical cross-run table, now cwd-independent), `analyze-rotation.ts` (unchanged).
- Superseded longlived pilot attempts (no raw samples, stale drift artifacts, unreferenced in
  any doc) were removed from the evidence tree; only the final run is retained.
- Format gate re-run over the harness: clean.

Bottom line recorded for [11](11-final-verdict.md): after the fixes, every MAJOR/MINOR is
resolved; the load-bearing evidence is unchanged and the deliverable is closeout-ready for the
human capacity review.