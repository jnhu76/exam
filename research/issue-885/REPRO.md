# EXAM #885 — REPRO (reproduction and evidence integrity)

This file is the current clean-room recipe and the historical receipt mapping.
The study is **in-process, fake-clock, fake-`db`**: no PostgreSQL was opened and
no developer/production data was touched. The product source under test is
identified by `subjectSha`; the frozen research baseline is identified
separately by `baselineSha`.

Current subject receipt: `40b859d12e6ce991cbe80f099a4cfd845e23414a` (clean
worktree, no scaffold). The post-fix comparison is **20/20 scenarios, 38/38
tuple matches, diff count 0**; the baseline control is **20 scenarios, 0
`operability.tick_failure` events**. Full result: [`POSTFIX_VALIDATION.md`](POSTFIX_VALIDATION.md).

## 1. Environment (current replay)

| Item | Value |
| --- | --- |
| Frozen baseline | `f2d44b78136cda1358148dbce891590975d4c88f` |
| Subject | `40b859d12e6ce991cbe80f099a4cfd845e23414a` |
| Instrument | `issue-885-instrument-v2` |
| Instrument manifest | [`harness/instrument-manifest.json`](harness/instrument-manifest.json) |
| Manifest SHA256 | `90ad4186a28902791351966cec41ec404c8e78cc33970b5a82908d37dfa4957a` |
| Node / Vitest | recorded inside `results/experiments.json` (`runtime.node`, `runtime.vitest`) |
| Clock | `vi.useFakeTimers({now:T0})`, `T0=2026-09-17T08:00:00Z`; pino and `fastify.now()` share it |
| DB | none — injected fake `fastify.db`; no `globalSetup`, no PostgreSQL |

The replay records these provenance fields in `results/experiments.json`:
`baselineSha`, `subjectSha`, `subjectDirty`, `subjectDirtyFiles`,
`productModules[].path`, `productModules[].sha256`, `instrument.version`,
`instrument.manifest.manifestSha256`, `runtime`, `command`, `scenarioCount`,
`generatedAt`, and the clock description. `subjectDirty` is **false** for the
receipt above; a dirty worktree is never represented as a precise subject.

The three product-module hashes for the current subject are:

| module | SHA256 |
| --- | --- |
| `apps/api/src/plugins/heartbeat.ts` | `d2430fd2d302d2f5b1ca052f0d8554d0b83cfb2fd1af21a206ab822ba2073265` |
| `apps/api/src/plugins/deadlineScanner.ts` | `3aa2cd377bbde8fe5ef81370411d7ae788f571f320b28fe930513728ed222edb` |
| `apps/api/src/plugins/operabilityMonitor.ts` | `61358d1975d6cf7944082aaf21e1760f13e41a1adb7db5fa0069e2a7808609ad` |

## 2. Historical receipts (2026-11-05, preserved)

These are the commands and hashes of the original study. They are not silently
rewritten; several artifacts have since changed for the reasons in §4.

```text
BASE_SHA=f2d44b78136cda1358148dbce891590975d4c88f
Research worktree=/home/hoo/Source/exam-885 (historical path)
CMD1 full matrix   exit 0, 2 tests passed (recorder)
CMD2 analysis      exit 0
CMD3 regression    exit 0, 67 passed
generatedAt        2026-11-05T13:49:21.293Z
scenarios          20
steps              556
```

Historical SHA256 receipts (as run, before the 2026-11-06 corrections):

```text
077f44a76a06a3c9a35fe54dfe21363ffaff65a11a2971e5c30761c919b57be6  RESULTS.md
48f774c5cb09e3b35cb05e45ac7eddd699eca7c0e731de9aa606b657089c14b2  SOURCE_MAP.md
f087ec64ca04a5330a1b9c4c67fc2e851c9d3817fb1868dae8555effb9646cef  EXPERIMENTS.md
e7eb5fb78a299436944972586a3c853d20ece2a0dc87b911310b850f90aa17db  ALERT_SEMANTICS.md
7a18186237fb495bc53754a346cf524d966be3f8dc86d8d74d7f9112cef74055  DECISION.md
fc8b4596ac0d18406db93cda5690b4ac2164cce80b7588709298dee38bd76009  harness/experiments.test.ts
cd230e7d35ad328d54cd074e7caec8954dff3c220174b059eab5f218bf2df08f  harness/smoke.test.ts
ab151ea8cd1ad1d6335afdf556ca4d1357ad9043126d76b8fd4fe6714f0a82e4  harness/analyze.mjs
3f0045836f2ed0e28019afc6f8b0caff6b01eed4e25bf4c799a9a59284037aec  results/experiments.json
99ee001857f8ad6b768640d819fc24c486f8686af612c3ccb1851c5c246476a8  results/analysis.json
725e1de34b6ef12a6c83e35bdfa5653c1779f68e08c97ac9499e425c7efcdcb0  results/final-run.txt
a0f9494f4f0103d5202445d7b99483c24f957394bd6fd5c986e3bea82ad9f185  results/run-transcript.txt
ef2351177147c4acbb24d53195be91acae0813a8661b4e837c92d8e99864a574  results/regression-transcript.txt
6a49f85d65232e11abc8dfcdb61f1965ebab487e27798c71315e649877c31ca2  results/analysis-transcript.txt
4d2ca4360f834e5b4c509f020438c9b8fce6f9ef2a8683d25df4ba11f60f843f  results/_matrix_rows.md
```

The historical runner configs were `apps/api/vitest.885.config.ts`
(`5b07d022…` → `78ab922d…` after `envDir:false`) and
`apps/api/vitest.885.regression.config.ts` (`9f42d722…` → `8f0e94be…`). They
were later removed from `apps/api/` and merged into
`research/issue-885/harness/vitest.config.ts` (`4f41c671…`).

## 3. Evidence-class discipline

- **MEASURED**: real plugin stdout/metrics/transitions and their actual
  pino/fake-clock timestamps. The default 30s/15s variable-tick miss and the
  `S=1s/M=15s` miss are product characterization tests, not study claims.
- **SOURCE_VERIFIED**: facts read from the source (probe path, freeze semantics,
  monitor reader, transition tracker).
- **COUNTERFACTUAL / HISTORICAL**: A/B/C/D candidate streams in the original
  study. They are not the post-fix oracle.
- **UNKNOWN / NOT CLAIMED**: operator delivery; real-PostgreSQL fault; heap
  allocation; statistical miss/false-positive rates; multi-instance notification
  behavior; stdout loss.

The E3 `42703` observation is a **simulated PostgreSQL-shaped error injected
through the fake db**. It is not a real database fault. The logical conclusion
that a healthy `organizations LIMIT 1` probe cannot exclude a scanner query-path
cause is source-verified.

## 4. Revision mapping (old → new)

The historical receipt hashes above remain the hashes of the files as they were.
Current files differ where noted. The authoritative current instrument hashes
are in `harness/instrument-manifest.json`; that manifest deliberately does not
hash itself.

| Artifact | Historical | Current / reason |
| --- | --- | --- |
| `harness/experiments.test.ts` | `fc8b4596…` | current manifest entry; E7 reset, actual read/settle/event timestamps, subject provenance, `.gitignore` output path |
| `harness/analyze.mjs` | `ab151ea8…` | current manifest entry; episode-keyed injection/removal/settle/event latencies |
| `harness/compare.mjs` | none (new) | current manifest entry; independent expected-event comparator |
| `harness/baseline-control.mjs` | none (new) | current manifest entry; frozen-baseline zero-event control |
| `harness/expected-events.json` | none (new) | current manifest entry; schedule-derived oracle table |
| `harness/instrument-manifest.json` | none (new) | hashes the instrument; not self-hashed |
| `harness/vitest.config.ts` | runner merge `4f41c671…` | unchanged bundle-owned runner |
| `results/*` | historical hashes above | deliberately not committed; regenerable, ignored under `research/issue-885/results/` |
| `POSTFIX_VALIDATION.md` | old replay narrative | rewritten with the committed E7 correction, corrected timestamps, and the clean-checkout receipt |

The old 19/20 (E7 `225000`) and the old 20/20-with-uncommitted-scaffold claims
are historical. The current committed instrument produces 20/20 without a
scaffold; see [`POSTFIX_VALIDATION.md`](POSTFIX_VALIDATION.md) §3 and §7.

Current document hashes (computed from this revision; `REPRO.md` cannot contain
its own hash):

```text
7aecfa6acbaffffc25b15b06e87486228c39ea3fe050163e5a97207749882fac  RESULTS.md
48f774c5cb09e3b35cb05e45ac7eddd699eca7c0e731de9aa606b657089c14b2  SOURCE_MAP.md
0e311e201518b49c88fdd1322f412ad45416d97ae8cce094a2f3a8b7ddd17dcc  EXPERIMENTS.md
7e592db8534e841092aa736524189d0b14d4b65c288e2ca94abb7ac3cb92e646  ALERT_SEMANTICS.md
91e93216be068ccbdd3dbb5eaf05ad8e43be0b373f0635b987821f1215ce2f12  DECISION.md
37ebc91c6766e8036a89cf1403e1f15ef27de1f2c165e5c0534e6219c745b774  README.md
b9a620e9201fd6e0715b5a4ebc6f1a39027055a2d98353a8cf4c3718220b495e  POSTFIX_VALIDATION.md
90ad4186a28902791351966cec41ec404c8e78cc33970b5a82908d37dfa4957a  harness/instrument-manifest.json
```

`SOURCE_MAP.md` is unchanged from the historical receipt. The other document
hashes map the intentional 2026-11-06 edits (errata, E7 correction, current
replay).

## 5. Clean-room recipe

The recipe is path-independent. Run it from a checkout you are willing to leave
dirty only in ignored paths; never run it in the main working tree. The research
bundle must be present **before** dependency links are created, because the
bundle-owned runner and harness resolve `vitest`/`fastify` by walking up from
`research/issue-885/harness/`.

```bash
set -eu
REPO_ROOT=$(git rev-parse --show-toplevel)
BASE=f2d44b78136cda1358148dbce891590975d4c88f
SUBJECT=40b859d12e6ce991cbe80f099a4cfd845e23414a
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/exam-885-replay.XXXXXX")

# 1) Obtain the bundle from the subject checkout first.
git -C "$REPO_ROOT" worktree add --detach "$SCRATCH/subject" "$SUBJECT"
cp -a "$REPO_ROOT/research/issue-885" "$SCRATCH/subject/research/"

# 2) Then link dependencies. Adjust only if your install is not at REPO_ROOT.
ln -s "$REPO_ROOT/node_modules" "$SCRATCH/subject/node_modules"
for d in apps/api packages/*; do
  [ -d "$SCRATCH/subject/$d" ] || continue
  ln -s "$REPO_ROOT/$d/node_modules" "$SCRATCH/subject/$d/node_modules" 2>/dev/null || true
done
ln -sfn "$SCRATCH/subject/apps/api/node_modules" \
  "$SCRATCH/subject/research/issue-885/harness/node_modules"

# 3) Subject replay.
cd "$SCRATCH/subject"
apps/api/node_modules/.bin/vitest run \
  --config research/issue-885/harness/vitest.config.ts research/issue-885/harness/
node research/issue-885/harness/analyze.mjs
node research/issue-885/harness/compare.mjs
apps/api/node_modules/.bin/vitest run \
  --config research/issue-885/harness/vitest.config.ts \
  apps/api/src/plugins/heartbeat.test.ts \
  apps/api/src/plugins/deadlineScanner.test.ts \
  apps/api/src/plugins/operabilityMonitor.test.ts

# 4) Baseline control. The frozen tree does not contain the bundle; copy the
#    same instrument into it after creating the worktree, then link deps.
git -C "$REPO_ROOT" worktree add --detach "$SCRATCH/base" "$BASE"
cp -a "$REPO_ROOT/research/issue-885" "$SCRATCH/base/research/"
ln -s "$REPO_ROOT/node_modules" "$SCRATCH/base/node_modules"
for d in apps/api packages/*; do
  [ -d "$SCRATCH/base/$d" ] || continue
  ln -s "$REPO_ROOT/$d/node_modules" "$SCRATCH/base/$d/node_modules" 2>/dev/null || true
done
ln -sfn "$SCRATCH/base/apps/api/node_modules" \
  "$SCRATCH/base/research/issue-885/harness/node_modules"
cd "$SCRATCH/base"
apps/api/node_modules/.bin/vitest run \
  --config research/issue-885/harness/vitest.config.ts research/issue-885/harness/
node research/issue-885/harness/baseline-control.mjs

# 5) Comparator negative control: mutate ONE tuple in a temporary copy.
TMPCASE=$(mktemp -d)
node - "$TMPCASE/experiments.json" <<'NODE'
const fs = require("node:fs");
const src = require("./research/issue-885/results/experiments.json");
const event = src.results
  .find((r) => r.scenario.id === "E1-db-down-throws")
  .asBuilt.operabilityEvents.find((e) => e.event === "operability.tick_failure");
event.state = event.state === "failing" ? "recovered" : "failing";
fs.writeFileSync(process.argv[2], JSON.stringify(src));
NODE
if node research/issue-885/harness/compare.mjs \
  --actual "$TMPCASE/experiments.json" --out "$TMPCASE/comparison.json"; then
  echo "NEGATIVE CONTROL FAILED: comparator accepted a mutated tuple" >&2
  exit 1
else
  echo "NEGATIVE CONTROL PASS"
fi

# 6) Cleanup. Remove only the scratch worktrees created above.
git -C "$REPO_ROOT" worktree remove --force "$SCRATCH/subject"
git -C "$REPO_ROOT" worktree remove --force "$SCRATCH/base"
rm -rf "$SCRATCH" "$TMPCASE"
```

Expected current values: subject `20/20`, `38/38`, diff 0; baseline 20 scenarios
and 0 `tick_failure`; subject product suites 78; comparator negative control exit
1; baseline product suites 67. The recorder's `2/2` test count is not a substitute
for the per-tuple comparison.

## 6. Determinism and limitations

- Fake timers, fixed 15 s steps, a fake drizzle-shaped db, `fileParallelism:
  false`; no sleeps, retries, network, or PostgreSQL.
- The 20 scenarios are deterministic evidence, not a statistical sample. No
  miss/false-positive percentage is claimed.
- The default 30s/15s counterexample and the `S=1s/M=15s` case are pinned by
  product tests; they demonstrate boundaries, not a universal detection SLA.
- No watcher exists in the repository. Only stdout event production is measured;
  delivery, notification correlation, multi-instance behavior, and stdout loss
  remain UNKNOWN.
- No real PostgreSQL fault was injected. E3 is a simulated PostgreSQL-shaped
  error.
- Heap allocation was not measured. The monitor adds a closure per tick and
  alert objects on transitions; the evidence does not claim zero allocations.

## 7. Boundaries honored

No product runtime behavior was changed for this research correction. The only
product source change is an inaccurate comment; the counters, classifier,
tracker, scheduler, thresholds, recovery conditions, and production messages
are unchanged. ADR-024 remains `PROPOSED`; this package does not accept it,
merge the PR, close an Issue, or authorize a release.
