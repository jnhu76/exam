# EXAM #885 — POST-FIX VALIDATION (realized behaviour vs. the research prediction)

The #885 study (`DECISION.md`) chose candidate **C** on the strength of a
**counterfactual** classifier: candidate C was never product code, so its event
stream was a *prediction*. This file closes that gap. It re-runs the **same 20
scenarios, unchanged**, against the **implemented** `operability.tick_failure`
leg and compares the REAL stdout events with the predicted ones, tuple for
tuple.

- Pre-fix observations: one deterministic run at `BASE_SHA` — receipt hashes in
  `REPRO.md` §4.3, regenerable via `REPRO.md` §5 (the dumps are intentionally
  not committed; scope diet §4.4)
- Post-fix observations: the same harness, same fake clock, same fake `db`,
  run against the implementation commit (not committed here — it is a replay,
  reproduced by the commands below)
- Prediction: `counterfactual.events[candidate=C]` recorded by the pre-fix run

## 1. Commands

```bash
# In the implementation worktree, with the evidence package in place:
apps/api/node_modules/.bin/vitest run --config research/issue-885/harness/vitest.config.ts \
  research/issue-885/harness/
# -> rewrites research/issue-885/results/experiments.json (post-fix)
```

Both runs: `2 files / 2 tests passed`, exit 0. The harness contains **zero
assertions** — it is an observation recorder, so it runs unchanged against
modified product code and cannot "pass by construction".

## 2. Result — 20/20 scenarios, 38/38 event tuples

`tick_failure` columns are the REAL post-fix stdout lines. `match` compares
`(component, state, elapsedMs)` against candidate C's prediction, sorted.

| scenario | pre-fix `operability.*` | post-fix `tick_failure` | predicted C | match | failing (ms) | recovered (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| `E0-normal-empty-tick` | 0 | 0 | 0 | YES | — | — |
| `E1-db-down-throws` | 2 | 4 | 4 | YES | 150000, 150000 | 270000, 270000 |
| `E2-both-org-discovery-logic-throw` | 0 | 4 | 4 | YES | 150000, 150000 | 330000, 330000 |
| `E2-hb-attempt-discovery-logic-throw` | 0 | 2 | 2 | YES | 150000 | 330000 |
| `E2-dl-attempt-discovery-logic-throw` | 0 | 2 | 2 | YES | 150000 | 330000 |
| `E3-hb-pg-query-error` | 0 | 2 | 2 | YES | 150000 | 330000 |
| `E3-dl-pg-query-error` | 0 | 2 | 2 | YES | 150000 | 330000 |
| `E4-both-business-failures-settle` | 4 | 0 | 0 | YES | — | — |
| `E5-hb-alternating-biz-and-throw` | 2 | 0 | 0 | YES | — | — |
| `E5-dl-alternating-biz-and-throw` | 2 | 0 | 0 | YES | — | — |
| `E5-both-alternating` | 4 | 0 | 0 | YES | — | — |
| `E6-hb-recover-after-continuous-throws` | 0 | 2 | 2 | YES | 150000 | 330000 |
| `E6-dl-recover-after-continuous-throws` | 0 | 2 | 2 | YES | 150000 | 330000 |
| `E6-business-failure-recovery` | 4 | 0 | 0 | YES | — | — |
| `E7-restart-during-continuous-throws` | 0 | 6 | 6 | YES | 150000, 150000, 330000, 330000 | 450000, 450000 |
| `E8-desync-short-bursts` | 0 | 4 | 4 | YES | 300000, 300000 | 450000, 450000 |
| `E9-db-down-then-db-up-with-throws` | 2 | 4 | 4 | YES | 150000, 150000 | 390000, 390000 |
| `E10-business-failure-then-continuous-throws` | 4 | 4 | 4 | YES | 330000, 330000 | 450000, 450000 |
| `E11-hung-tick-not-throwing` | 2 | 0 | 0 | YES | — | — |
| `E12-chronic-intermittent-3-throw-1-clean` | 0 | 0 | 0 | YES | — | — |

Totals: **38 real `operability.tick_failure` lines, 20/20 scenarios matching the
prediction exactly.** The pre-fix `operability.*` column is unchanged in every
scenario where `tick_failure` is silent (0, 2 or 4 lines as measured before), so
the three existing facts keep their authority.

**Latency, measured from the actual fault on the fake clock** (not derived from
threshold arithmetic): detection `150000 − 45000 = 105000 ms` after the first
throwing tick in E2/E3/E6/E9/E10/E8; recovery `15 000 ms` after the fault clear.

**Zero false positives** (real lines = 0) in: clean (E0), business-failure-only
(E4, E5, E6-business-failure), stalled (E11), 3-tick burst (E8's first burst),
and chronic-intermittent (E12).

## 3. E7 — one instrument artifact, and why it does not change the result

The first post-fix replay produced ONE mismatch: E7's post-restart raise landed
at `225000` instead of `330000`.

Cause: the harness simulates a process restart by calling `resetAllMetrics()`,
which zeroes the process-local fields **it knew about when the study was
written**. `consecutiveThrowTicks` did not exist then, so the simulated restart
leaked the pre-restart count (4) into the "new process", and the fresh monitor
raised on its first sample. **A real process restart cannot do this** — the
counter lives in module scope and starts at 0.

Verification (temporary scaffold patch, NOT part of the committed package; the
harness as run was byte-identical to `BASE_SHA`'s evidence, hash `fc8b4596…` —
since reformatted by the scope diet, hashes mapped in `REPRO.md` §4.4 and
re-verified behaviour-identical on 2026-11-06, see §5):

```ts
// in resetAllMetrics(), simulating a process restart
if ("consecutiveThrowTicks" in m) (m as { consecutiveThrowTicks: number }).consecutiveThrowTicks = 0;
```

With that one line the replay is **20/20 with zero mismatches**, and E7's second
raise moves to `330000` — exactly the predicted fresh-process accumulation
(restart at `210000` + 4 ticks). The unpatched `225000` figure is therefore
recorded as an **INSTRUMENT ARTIFACT**, never as product behaviour.

## 4. What this does and does not prove

- **Proves (MEASURED):** the implemented event streams — counts, components,
  ordering and timestamps — reproduce the accepted design across all 20
  scenarios, including the negative ones; and the pre-existing facts are
  unchanged.
- **Does not prove:** operator delivery (there is still no watcher in the repo;
  only stdout event production is measured), real-PostgreSQL behaviour (the db
  is a fake reproducing the drizzle chain shapes), or statistical rates (20
  deterministic scenarios cannot support a percentage).
- **Does not cover:** E12 (chronic intermittent), which remains a documented
  false-negative boundary for every candidate including the implemented one.

## 5. Post-diet replay receipt (2026-11-06)

After the PR #896 scope diet moved the runner into the bundle and reformatted
the harness (mapping: `REPRO.md` §4.4), the replay was re-executed from the
diet commit:

- Migrated runner CMD1: 2 files / 2 tests, exit 0.
- **19/20 scenarios tuple-identical** to candidate C with **38/38** real
  `operability.tick_failure` lines; E7 reproduces the §3 INSTRUMENT ARTIFACT
  exactly (225000 unpatched → 330000 with the §3 scaffold → **20/20**), so the
  reformat is behaviour-neutral.
- BASE_SHA clean-room control (`REPRO.md` §5 recipe, bundle copied in):
  3 files / **67 tests**.
- Post-fix plugin suites through the same runner (DB-free): **75/75**.
