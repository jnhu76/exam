# EXAM #885 — POST-FIX VALIDATION (implemented behaviour vs. independent expectation)

This file records the post-fix replay after the 2026-11-06 instrument corrections.
The earlier replay narrative is preserved as history in §7; its `20/20` claim
depended on an uncommitted one-line scaffold and is superseded by the committed
instrument and the clean-checkout run below.

## 1. Result

| Item | Value |
| --- | --- |
| Frozen baseline | `f2d44b78136cda1358148dbce891590975d4c88f` |
| Subject under test | `f088c4bfea918d2344345ff1ab5c9218eeb133c2` |
| Subject worktree dirty | **NO** |
| Instrument | `issue-885-instrument-v2` |
| Instrument manifest SHA256 | `5f7cec21a25c0e0c90581e42addf4504211ea2385815d952b386a07d055e527f` |
| Baseline control | **PASS** — 20 scenarios, 0 `operability.tick_failure` events |
| Subject replay | **20/20 scenarios**, **38/38 expected tuples**, **0** tuple differences |
| Comparator negative control | **PASS** — one mutated tuple produced exit 1 and 19/20 |
| Product plugin suites on subject | **78/78** (`heartbeat` 14, `deadlineScanner` 11, `operabilityMonitor` 53) |
| Product plugin suites on baseline | **67/67** (`heartbeat` 13, `deadlineScanner` 10, `operabilityMonitor` 44) |

The 20 scenarios retain the original identities, fault phases, order and phase
lengths. The expected table is
[`harness/expected-events.json`](harness/expected-events.json); the comparator
is [`harness/compare.mjs`](harness/compare.mjs). The comparator does not import
the product classifier or transition tracker.

## 2. Clean-checkout commands

The authoritative recipe is [`REPRO.md`](REPRO.md) §5. The commands used for
this receipt were:

```bash
# baseline worktree at f2d44b78..., final research bundle copied in
apps/api/node_modules/.bin/vitest run --config research/issue-885/harness/vitest.config.ts research/issue-885/harness/
node research/issue-885/harness/baseline-control.mjs

# subject worktree at f088c4bf..., no edits, no scaffold
apps/api/node_modules/.bin/vitest run --config research/issue-885/harness/vitest.config.ts research/issue-885/harness/
node research/issue-885/harness/analyze.mjs
node research/issue-885/harness/compare.mjs
apps/api/node_modules/.bin/vitest run --config research/issue-885/harness/vitest.config.ts \
  apps/api/src/plugins/heartbeat.test.ts \
  apps/api/src/plugins/deadlineScanner.test.ts \
  apps/api/src/plugins/operabilityMonitor.test.ts
```

`experiments.json`, `analysis.json` and `comparison.json` are regenerable
outputs under `research/issue-885/results/`, which is ignored. They are not
committed. Their `subjectSha`, `subjectDirty`, product-module paths and SHA256s,
instrument manifest hash and runtime versions are recorded inside
`experiments.json`.

## 3. E7 restart — proof of the corrected instrument

The historical harness simulated a restart by closing the app, resetting the
metrics fields it knew about, and registering a new app. It did not reset
`consecutiveThrowTicks`, because that field did not exist when the harness was
written. The module singleton therefore leaked the pre-restart count into the
“new process”, and E7's post-restart raise appeared at `225000` instead of the
fresh-process `330000`. A real process cannot inherit that count.

The committed `resetAllMetrics()` now resets the throw counter through a
compatibility probe:

```ts
resetOptionalCounter(m, "consecutiveThrowTicks");
```

On the frozen baseline the field does not exist, so the probe does nothing and
no fake baseline field is created. On the implementation the field exists and is
reset to 0. The new app creates fresh monitor trackers, so there is no
carry-over recovery. E7 now shows:

| process epoch | event | elapsed |
| --- | --- | --- |
| 0 (pre-restart) | heartbeat / failing | 150000 |
| 0 (pre-restart) | deadline_scanner / failing | 150000 |
| 1 (post-restart) | heartbeat / failing | 330000 |
| 1 (post-restart) | deadline_scanner / failing | 330000 |
| 1 (post-restart) | heartbeat / recovered | 450000 |
| 1 (post-restart) | deadline_scanner / recovered | 450000 |

The post-restart raise requires four post-restart throws (240/270/300/330 s);
the fresh counter starts at 0. No `recovered` is emitted for the old process at
restart. This is the identity boundary the old scaffold did not test.

Historical result: the committed harness as it stood before this correction was
**19/20** with E7 at `225000`; the `20/20` claim required an uncommitted patch.
That claim is not reused as evidence for the current instrument.

## 4. Corrected timestamps and latency scope

The earlier `105 s` / `15 s` figures were computed from phase observation
markers, not from actual fault changes. For E2, for example, the old code
recorded the fault start after the first 15 s observation step (`45000`) even
though the fault was injected at the end of the baseline phase (`30000`), and
recorded the clear at `315000` for an actual clear at `300000`. Thus:

- `105000 = 150000 − 45000` was **not** injection-to-failing.
- `15000 = 330000 − 315000` was **not** removal-to-recovered.

The corrected instrument records the phase switch when it happens, the scanner
settle time from the metrics, and the pino event time. The episode-level
results for representative scenarios are:

| scenario / episode | loop | injection→failing | first throw-settle→failing | removal→recovered | first no-throw settle→recovered |
| --- | --- | --- | --- | --- | --- |
| E1 (30→240 clean) | heartbeat | 120000 | 90000 | 30000 | 0 |
| E1 (30→240 clean) | deadline_scanner | 120000 | 90000 | 30000 | 0 |
| E2 (30→300 clean) | both | 120000 | 90000 | 30000 | 0 |
| E7 (30→210 restart) | both | 120000 | 90000 | null (restart) | null |
| E7 (210→420 clean) | both | 120000 | 120000 | 30000 | 0 |
| E8 (180→420 clean) | both | 120000 | 90000 | 30000 | 0 |
| E9 (30→180 cause change) | both | 120000 | 90000 | null (cause change) | null |
| E9 (180→360 clean) | both | null (alert carried in) | null | 30000 | 0 |
| E10 (210→420 clean) | both | 120000 | 90000 | 30000 | 0 |

These are fake-clock measurements of one deterministic schedule, not a
universal detection bound. The monitor read point is recorded by a read-only
getter probe in the research harness; it is not a product export. The product
tests independently cover the default variable-tick miss and the `S=1 s`,
`M=15 s` case.

## 5. Evidence integrity and negative control

- The expected table is a schedule-derived table, not a counterfactual produced
  by reusing the production classifier/tracker.
- Comparator checks preserve per-component order and compare exact
  `(scenario, component, event, state, elapsedMs)` tuples. It reports missing,
  extra, mismatched and duplicate tuples.
- Negative control: one event in a temporary copy was changed from
  `recovered` to `failing`; the comparator exited 1 with `19/20` and
  `diffCount=1`. The real receipt was not modified.
- Baseline control: the same 20 scenarios on the frozen SHA produced zero
  `tick_failure` events. This is the control for the original blind spot, not a
  post-fix pass rate.
- Instrument manifest: [`harness/instrument-manifest.json`](harness/instrument-manifest.json).
  It hashes the harness sources, expected table, comparator, baseline control,
  analyzer, runner and fingerprint generator; it does not hash itself.

## 6. What this does and does not prove

- **Proves (MEASURED):** the implemented event streams reproduce the independent
  expected tuples across the 20 retained scenarios, including the negative
  ones; the pre-existing facts are unchanged; E7's new process starts at zero;
  and the comparator detects a single mutated tuple.
- **Does not prove:** operator delivery (no watcher exists in the repository),
  real-PostgreSQL behaviour (the database is a fake reproducing drizzle chain
  shapes; E3's `42703` is simulated), statistical miss/false-positive rates
  (20 deterministic scenarios cannot support a percentage), or a universal
  wall-clock detection bound.
- **Does not cover:** E12 chronic intermittent `3 throws -> 1 clean` (documented
  threshold boundary) or a finite run that an actual monitor read misses
  entirely (documented sampling boundary; see product boundary tests).

## 7. Historical pre-correction replay (preserved)

The original `POSTFIX_VALIDATION.md` reported:

- **2 files / 2 tests passed** for the recorder harness. That is a recorder
  result, not a 20/20 comparison.
- **38 real `operability.tick_failure` lines** and a claimed 20/20 tuple match.
- **E7 at 225000** in the committed instrument, with 20/20 only after an
  uncommitted `resetAllMetrics` scaffold.
- **105 s / 15 s** detection and recovery, measured from phase observation
  markers.

Those statements are retained here as history because the old hashes and
receipts are part of the study record. The current committed instrument replaces
the scaffold, the clean-checkout run above produces 20/20 without it, and the
latency table uses actual injection/removal/settle/event times. See
[`REPRO.md`](REPRO.md) for the old→new artifact mapping.
