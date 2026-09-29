# #586 — 10 Evidence Ledger (mechanically derived)

Status: GENERATED. Regenerate with
`node docs/research/exam-586-fedora-pool-1/harness/make-ledger.mjs`.
Every figure below is derived from per-run `meta.json`, `driver-summary.json`,
`correctness.json` and directory listings — no hand-maintained totals.

## Run disposition

| run | kind | disposition | pool | N | rep | location | archived in Git | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aa-01 | AA | AA_VALID | postgres.js_default_10 | 100 | 1 | repo+host | yes | oracle=true |
| aa-02 | AA | AA_VALID | 10 | 100 | 1 | repo+host | yes | oracle=true |
| aa-03 | AA | AA_VALID | 10 | 200 | 1 | repo+host | yes | oracle=true |
| aa-04 | AA | AA_VALID | postgres.js_default_10 | 200 | 1 | repo+host | yes | oracle=true |
| aa-05 | AA | AA_VALID | postgres.js_default_10 | 200 | 2 | repo+host | yes | oracle=true |
| aa-06 | AA | AA_VALID | 10 | 200 | 2 | repo+host | yes | oracle=true |
| aa-07 | AA | AA_VALID | 10 | 100 | 2 | repo+host | yes | oracle=true |
| aa-08 | AA | AA_VALID | postgres.js_default_10 | 100 | 2 | repo+host | yes | oracle=true |
| diag-p20-S200 | DIAGNOSTIC | DIAGNOSTIC_VALID | 20 | 200 | 1 | repo+host | yes | oracle=true |
| diag2-p20-S200 | DIAGNOSTIC | DIAGNOSTIC_VALID | 20 | 200 | 1 | repo+host | yes | oracle=true |
| main-01 | MAIN | MAIN_VALID | 10 | 50 | 1 | repo+host | yes | oracle=true |
| main-02 | MAIN | MAIN_VALID | 20 | 100 | 1 | repo+host | yes | oracle=true |
| main-03 | MAIN | MAIN_VALID | 30 | 200 | 1 | repo+host | yes | oracle=true |
| main-04 | MAIN | MAIN_VALID | 20 | 200 | 2 | repo+host | yes | oracle=true |
| main-05 | MAIN | MAIN_VALID | 30 | 50 | 2 | repo+host | yes | oracle=true |
| main-05-interrupted-2043 | MAIN | INTERRUPTED | 30 | 50 | ? | host-only | no | killed mid-campaign (monitor shell); superseded by fresh main-05; retained per never-delete-raw-evidence policy |
| main-06 | MAIN | MAIN_VALID | 10 | 100 | 2 | repo+host | yes | oracle=true |
| main-07 | MAIN | MAIN_VALID | 30 | 100 | 3 | repo+host | yes | oracle=true |
| main-08 | MAIN | MAIN_VALID | 10 | 200 | 3 | repo+host | yes | oracle=true |
| main-09 | MAIN | MAIN_VALID | 20 | 50 | 3 | repo+host | yes | oracle=true |
| smoke-S20-r0 | SMOKE | INTERRUPTED | ? | ? | ? | host-only | no | driver_setup_failed; no driver-summary; rig bootstrap: driver_setup_failed (no meta finalized) |
| smoke-S20-r0b | SMOKE | INTERRUPTED | ? | ? | ? | host-only | no | no driver-summary; rig bootstrap: killed before meta (no meta finalized) |
| smoke-S20-r0c | SMOKE | INTERRUPTED | ? | ? | ? | host-only | no | no driver-summary; rig bootstrap: killed before meta (no meta finalized) |
| smoke-S20-r0d | SMOKE | INVALID | unset | 20 | ? | repo+host | yes | correctness_oracle_failed (§30: performance result disqualified); run-time oracle failed; no correctness.json written |
| smoke-S20-r0e | SMOKE | INVALID | unset | 20 | ? | repo+host | yes | correctness_oracle_failed (§30: performance result disqualified); oracle=true; run-time oracle failed; correctness.json present but is a LATER replay (pass=true, distinctAuditIps=21 vs 20 candidates) — run stays INVALID per finalized meta |
| smoke-S20-r0f | SMOKE | SMOKE_VALID | postgres.js_default_10 | 20 | 0 | repo+host | yes | oracle=true |

## Derived totals

| class | count |
| --- | --- |
| AA_VALID | 8 |
| MAIN_VALID | 9 |
| SMOKE_VALID | 1 |
| DIAGNOSTIC_VALID | 2 |
| **VALID (sum)** | **20** |
| INVALID | 2 |
| INTERRUPTED (host-only partials, no finalized meta) | 4 |
| TOTAL_RETAINED (run dirs on host ∪ repo) | 26 |
| — archived in Git | 22 |
| — host-only | 4 |

## Prior count inconsistency — resolution

Earlier #586 wording mixed two figures: "17 campaign cells + 1 smoke + 2
diagnostics" and "18 VALID runs". The mechanically derived truth is:

- 17 campaign cells = 8 A/A + 9 main, all VALID;
- + 1 smoke VALID (r0f) + 2 diagnostic VALID = **20 finalized VALID runs**;
- the "18" figure was a miscount and is superseded by this ledger;
- retained-but-not-VALID: 2 INVALID smoke attempts (oracle-failed, disqualified
  per protocol) and 4 host-only partials (killed before finalizing meta).

## Repository material policy

Git contains research source (docs + harness) and small normalized text
evidence only. Per run, these raw artifacts stay host-side under
`/home/jnhu/exam-586/runs/<run>/` and are integrity-pinned by each run's `SHA256SUMS`
(committed):

- 22 run dirs (aa-01, aa-02, aa-03, aa-04, aa-05, aa-06, aa-07, aa-08, diag-p20-S200, diag2-p20-S200, main-01, main-02, main-03, main-04, main-05, main-06, main-07, main-08, main-09, smoke-S20-r0d, smoke-S20-r0e, smoke-S20-r0f): requests.jsonl, candidates.sql, app.log, web.log, db.log

Container logs are the uncompressed `app.log`/`web.log`/`db.log` above.
`candidates.sql` on the host contains the experiment-only candidate
password hash; the repository never carried it unredacted.

## Reproduction

Harness and frozen schedule: `harness/` (README.md, campaign.sh,
run-cell.sh, driver.mjs, oracles.mjs, summarize586.mjs). Raw dirs can be
re-collected into Git-visible `results/` with
`bash harness/collect-runs.sh` (bounded set; raw logs/dumps/requests are
deliberately excluded).
