# Post-#649 `@exam/db` test-suite performance attribution

Status: **RESEARCH / MEASUREMENT-ONLY — no optimization performed** (2026-09-28)
Scope: where does the remaining post-#649 `@exam/db` wall time actually go (test + coverage regimes).
Baseline: master `a4a813fa` (PR #649 merged), worktree `/home/hoo/Source/exam`, WSL2 + Docker Desktop PostgreSQL 18.4.
Nature: attribution / falsification / candidate selection only. No production, test, config, or infra file was modified; all harnesses and raw artifacts live under `/tmp/exam-perf-20260928-162802/` (experiment-only).

```text
LIVE_MASTER = a4a813fa4c1866e951941eb5954e173426c3a11c (expected post-#649 head, verified)
PR #649     = MERGED (2026-09-28T07:37:02Z, merge commit = LIVE_MASTER)
BRANCH      = research/db-test-post-649-perf (from live master)
HEAD        = a4a813fa4c1866e951941eb5954e173426c3a11c + this report
REPORT      = docs/research/db-test-post-649-perf-attribution.md
RAW_ARTIFACT_DIR = /tmp/exam-perf-20260928-162802  (NOT durable; report is self-contained)
```

---

## 1. Environment

| item | value |
| --- | --- |
| kernel | 6.18.33.2-microsoft-standard-WSL2 |
| distro | Ubuntu 26.04.1 LTS |
| WSL | 2.7.14.0 (kernel 6.18.33.2-2) |
| cpu | AMD Ryzen 7 5800H, 8 logical CPUs exposed (4 cores × 2 threads), no P/E-core split exposed |
| memory | 15 GiB (WSL VM), swap 8 GiB |
| filesystem backing | WSL2 ext4 on `/` (sdd, 1 TB virtual disk); container volume inside Docker Desktop VM |
| docker | Docker Desktop 4.89.0, server 29.7.2, overlay2, cgroup v2, cgroupfs driver |
| node / pnpm | v24.15.0 / 11.1.2 |
| vitest | 4.1.7 (`@vitest/coverage-v8` 4.1.7) |
| postgres | `postgres:18.4-bookworm`, server 18.4 (Debian 18.4-1) |
| perf | 7.0.14 (matched; works against this WSL kernel) |
| bpftrace | v0.25.0 |
| cgroup | v2 in both the WSL distro and the Docker Desktop VM |

PostgreSQL server configuration (read-only snapshot, §21; unchanged): `synchronous_commit=on`, `fsync=on`, `full_page_writes=on`, `shared_buffers=128MB`, `max_connections=100`, `track_io_timing=off`, `wal_level=replica`, `checkpoint_timeout=5min`, `max_wal_size=1GB`, `default_transaction_isolation=repeatable read`.

## 2. Docker / PostgreSQL topology

```text
POSTGRES_CONTAINER_ID   = 80d0d237dde4eadf5cd69eb016e537490f7ae77f9aca8712f74c75d42c70deb0
POSTGRES_CONTAINER_NAME = exam-dev-db-1
POSTGRES_IMAGE          = postgres:18.4-bookworm
POSTGRES_PORT_MAPPING   = 0.0.0.0:5432->5432/tcp
POSTGRES_CONTAINER_PID  = 1204
pid_visible_from_profiler = NO   (Docker Desktop runs containers in a separate utility VM/namespace)
cgroup_visible          = NO     (no host-side path to the container cgroup from this distro)
postgres_cgroup         = UNAVAILABLE host-side; container-internal accounting READ via
                          `docker exec … cat /sys/fs/cgroup/{cpu.stat,io.stat,…}` (cgroup v2 namespaced root)
host_perf_can_see_postgres = perf: NO · eBPF: YES-by-comm (kernel-wide task visibility; PIDs namespaced, comm strings are not)
```

Two consequences that shaped the whole pass:

1. `perf -- pnpm …` cannot attribute PG server work, and host `perf stat -G/--cgroup` is impossible. PG container CPU/IO was measured by delta of the container's **own** cgroup counters read through `docker exec` (cross-checked with `docker stats`).
2. bpftrace/BCC programs run kernel-wide and **do** see the postgres tasks by `comm`. This made host-side eBPF far more useful than the PID-namespace view suggested: off-CPU and fsync/fdatasync syscall attribution for postgres was captured from the WSL distro. (BCC python tools fail to compile here — missing kernel headers (`/lib/modules/…/build` absent); bpftrace works via BTF. All eBPF measurement used bpftrace scripts.)

## 3. Tool capability matrix

| tool / event | state | note |
| --- | --- | --- |
| perf software events (`task-clock,page-faults`) | SUPPORTED | run unprivileged and as root |
| perf `context-switches,cpu-migrations` (:u) | NOT_COUNTED | count 0 under `paranoid=2` user-only measurement; kernel-side excluded — not used in conclusions |
| perf hw `cycles,instructions,branches,branch-misses` | SUPPORTED | `perf_event_paranoid=2`, `kptr_restrict=1`; PMU works under WSL2 |
| perf `cache-references,cache-misses` | COUNTED, UNRELIABLE | large noise on `sleep 1` probe; not used |
| perf DWARF callgraphs | SUPPORTED | node binary C++ symbols resolve via DWARF |
| JIT frames (V8 JS functions) | UNRESOLVED | node not run with `--perf-prof`; JS-level callers not attributable (limitation) |
| perf kernel symbols | PARTIAL | `kptr_restrict=1`; kernel frames appear as hex (does not affect user-space attribution) |
| bpftrace sched/syscall tracepoints | SUPPORTED | `sched:sched_switch/wakeup`, `syscalls:*futex*`, `:*fsync*` verified |
| bpftrace block tracepoints | LISTED, LOAD_DENIED | `block:block_rq_issue/complete` listed, program load returns `-13 (EACCES)` |
| BCC helpers (`runqlat-bpfcc`, `offcputime-bpfcc`, `biolatency-bpfcc`, `biosnoop-bpfcc`) | INSTALLED, PARTIALLY USABLE | offcputime ran; biolatency/biosnoop fail: no kernel headers for BCC compile |
| PG container perf | UNAVAILABLE | container not visible from this perf kernel |
| block-layer direct observation | UNAVAILABLE | container IO traverses the Docker Desktop VM, not this kernel; host block-program load denied |

`BLOCKED_BY_PERMISSION` items: none that materially constrained the attribution (block-layer IO replaced by cgroup `io.stat` + PG telemetry, per §29 fallback).

## 4. Methodology

Warm steady-state is primary: the persistent package worker slots (`exam_test_db_w1..w3`, exactly `DB_TEST_WORKER_CAP=3`) were verified present and were **not** deleted before measurement (§14). One warm-up run passed (59 files / 707 tests, 62.78s).

Separate canonical runs (observer discipline, §32), each a plain `pnpm --filter @exam/db test` (or `coverage`) with ONE probe attached:

```text
Run B  perf stat          Run D  runqlat (bpftrace)      Run H  PG telemetry + cgroup deltas + activity sampler
Run E  offcputime (BCC)   Run F  fsync/fdatasync bt      Run G  block IO (failed: see §3) → replaced by cgroup io.stat
Run I  TEST_INFRA_TRACE   Run W  futex (bpftrace)        Run H2 coverage + full PG telemetry (checkpointer/WAL/io)
```

Primary wall figures come only from `/usr/bin/time -v` and low-overhead `perf stat`. Instrumented runs are attribution-only. Reproduction commands are inline in §6–§12. Probe overhead classification: `perf stat` LOW · `runqlat/futex/sync bpftrace` LOW-MEDIUM · `offcputime` MEDIUM (986 lost stacks warning) · `pg_stat_activity` sampler (aggregate query @ ~275 ms) LOW · `docker stats --no-stream` LOW.

## 5. Plain baselines (N=5 each)

`/usr/bin/time -v pnpm --filter @exam/db test|coverage`, sequential, warm slots:

| run | wall s | user s | sys s | max RSS KB | vol cs | invol cs | minor ft | exit |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| test-1 | 66.13 | 72.03 | 21.46 | 413,524 | 117,664 | 3,927 | 4,357,096 | 0 |
| test-2 | 70.98 | 68.98 | 20.36 | 411,732 | 117,875 | 3,786 | 4,370,199 | 0 |
| test-3 | 70.29 | 71.39 | 19.96 | 409,868 | 117,371 | 4,150 | 4,362,075 | 0 |
| test-4 | 71.51 | 71.00 | 20.29 | 413,700 | 117,204 | 4,144 | 4,366,347 | 0 |
| test-5 | 70.17 | 70.16 | 20.57 | 411,828 | 117,628 | 3,806 | 4,364,144 | **1** |
| cov-1 | 69.11 | 71.84 | 19.87 | 520,504 | 121,828 | 4,055 | 4,478,235 | 0 |
| cov-2 | 71.78 | 73.22 | 20.18 | 495,900 | 121,481 | 3,745 | 4,479,323 | 0 |
| cov-3 | 72.58 | 72.66 | 19.89 | 473,988 | 121,886 | 3,471 | 4,465,230 | 0 |
| cov-4 | 70.71 | 72.64 | 19.97 | 508,332 | 121,472 | 3,762 | 4,466,479 | 0 |
| cov-5 | 69.74 | 72.17 | 19.95 | 510,548 | 120,964 | 3,760 | 4,489,953 | 0 |

```text
TEST      wall median 70.29  min 66.13  max 71.51  (range 5.38)   user 71.0   sys 20.5
COVERAGE  wall median 70.71  min 69.11  max 72.58  (range 3.47)   user 72.6   sys 20.0
```

test-5 exit=1: `src/testDbWorkerScoped.failurePath.test.ts` failed in `beforeAll` (`AssertionError: expected 1 to be +0` at `testDbWorkerScoped.failurePath.test.ts:120`, full stderr in `baseline/test-5.time`). The assertion checks that a **just-`close()`d** pool has zero remaining backends in `pg_stat_activity`; under 3-worker load the terminated backend's row was still listed (teardown visibility lag). This is a test-infra flake in a #648 regression test, **not** a measurement disturbance — the run's wall (70.17s) is within the passing distribution, and 705/707 tests passed. Run kept, exit recorded. (Follow-up candidate: re-check backends after a settle delay or exclude `pid`+`state` lag window. NOT fixed in this task.)

Major faults ≈ 0 in all runs; RSS max is per-tree peak (vitest main + workers).

## 6. TEST vs COVERAGE regime comparison (§16/§35)

| metric | test | coverage | delta |
|---|---:|---:|---|
| wall median | 70.29s | 70.71s | **+0.6%** |
| perf stat wall (r5) | 71.15s ±1.38% | 72.90s ±1.66% | +2.5% |
| task-clock (r5) | 92,691 ms ±0.62% | 99,768 ms ±0.46% | **+7.6% CPU** |
| cycles (r5) | 250.9 G | 266.0 G | +6.0% |
| instructions (r5) | 312.7 G | 341.3 G | +9.2% |
| IPC | 1.246 | 1.284 | — |
| branch-miss ratio | 1.95% | 1.93% | — |
| page faults | 4.353 M | 4.462 M | +2.5% |
| max RSS | ~413 MB | ~509 MB | **+23%** |
| PG container CPU | +63.6 s | +62.8 s | −1.3% (same) |
| PG physical writes | +502 MB | +500 MB | same |
| PG WAL bytes | +302 MB | +307 MB | same |

**Coverage does NOT change the bottleneck regime.** The extra ~7 s of client CPU (V8 coverage runtime: `Builtins_IncBlockCounter` 1.16%, `Debug::TryGetDebugInfo` 2.47%, `DebugGetCoverageInfo`/`HasCoverageInfo` ~0.8% in the coverage profile) is absorbed by workers that are already part-idle waiting on the database; PG-side work is statistically identical between regimes. Coverage overhead is classified **client-side** (Q2: no regime change).

## 7. Client-side profile (§17/§18 — `CLIENT_SIDE_PROFILE`)

`perf record -F 99 -g --call-graph dwarf` on plain test (and coverage):

Top self-overhead (test): V8 JSON parsing `JsonParser::ScanJsonString` 5.42% + `SkipWhitespace` 2.16% + `ParseJsonObject` 1.75% + `MakeString` 0.70% ≈ **10%**; string internalization `StringTable::LookupKey` 3.96% + `InternalizeSubString` 1.88% ≈ **6%**; GC (`Scavenger::ScavengeObject` 4.49+1.75%, `ConcurrentMarking` 1.20+0.70%, `EvacuateInPlaceInternalizableString` 1.71%) ≈ **10%**; `Builtins_LoadIC` 2.00%; JS scanner `Scanner::Next` 1.29% (source compilation).

Interpretation: the client CPU is dominated by **JSON.parse-heavy workload + string internalization + GC** — characteristic of the vitest/Vite transform/sourcemap/module-cache pipeline — not by test-body JS or postgres client crypto/serialization. `postgres-js` client stacks are NOT material in the profile. The JS-level caller of `JSON.parse` cannot be resolved without JIT symbol export (`node --perf-prof`); recorded as limitation. pnpm/turbo process startup is visible but small (~1.5s wall of 71s; `pnpm`/`sh`/`turbo` frames < 1%).

Worker occupancy vs CPU: vitest reports cumulative `tests 158–164s` + `import 35–38s` + `transform 1.7s` across 3 workers ≈ 195–200 worker-seconds over ~70s wall → workers "busy" ≈ 2.8/3, while actual client CPU is only 92.7s (1.30 cores). **≈ 56% of worker busy-time is off-CPU waiting** — the DB round-trip/lock wait, not compute. Sum of per-file durations (test-2) = 161.2s → 53.7s average chain per worker; wall is set by the heaviest worker chain.

## 8. PostgreSQL container accounting (§19/§20)

Host perf/eBPF cannot profile the container cgroup (`POSTGRES_PERF_PROFILE = UNAVAILABLE` for perf; eBPF comm-level evidence below). Container-internal cgroup v2 deltas across one canonical run each:

```text
RUN H (test)      usage_usec +63.6s (user +40.5s, sys +23.1s)   nr_throttled 0   docker stats 5.69% → 5.47% instant
RUN H2 (coverage) usage_usec +62.8s (user +39.7s, sys +23.0s)   nr_throttled 0
cgroup io.stat (dev 8:80)  test: wbytes +502MB / wios +37,984 / rbytes +0.8MB
                           coverage: wbytes +500MB / wios +38,399 / rbytes +3.1MB
```

PG container CPU ≈ **0.91 cores over ~70s wall** — continuously busy but far from the 8-CPU ceiling, zero throttling. `POSTGRES_CONTAINER_CPU saturation = NO`.

## 9. PostgreSQL telemetry (§22/§23/§40)

Per-run deltas from `pg_stat_database` / `pg_stat_io` / `pg_stat_wal` / `pg_stat_checkpointer` (columns verified against PG 18.4 schema):

```text
pg_stat_database (all exam* DBs)     test run H
  xact_commit          +6,394        (exam_test +4,357 · slot w1/w2/w3 +335/+507/+1,147 · coordination exam +38)
  tup_inserted         +364,816      tup_deleted +361,270      tup_updated +38,668
  blks_hit             +11.67M       (hit ratio ≈ 99.9%; blks_read +12.6k pages ≈ 100MB logical, 0.8MB physical)
  sessions             +587
pg_stat_wal
  wal_records          +1,895,767    wal_fpi +38,605    wal_bytes +302MB    wal_buffers_full +909
pg_stat_io
  client backend/wal        writes 3,497 (237.5MB)   fsyncs 3,305   ← per-commit WAL durability
  checkpointer/relation     writes 16,437 pages (134.7MB)  writebacks 16,437  fsyncs 25,003 files
  walwriter/wal             writes 213 (93MB)        fsyncs 211
  client backend/relation   reads 10,017 (82MB)      hits 12.5M     extends 9,246 (75.8MB)  evictions 727
pg_stat_checkpointer (H2 coverage run)      [view columns: num_timed/num_requested/num_done/write_time/sync_time]
  num_requested +11    num_done +12    write_time +63.9s    sync_time +12.1s    buffers_written +15,594 (~122MB)
pg_stat_bgwriter  buffers_clean +4   maxwritten_clean 0   (bgwriter inactive)
```

`pg_stat_activity` sampling (aggregate @ ~275 ms, run H: 247 samples / H2: 264 samples):

```text
avg_total backends 5.36   avg_active 2.71   avg_idle(ClientRead) 2.35   avg Lock-wait 0.94   avg IO-wait 0.08
wait_event combos present in samples (test run):
  Client:ClientRead   238/247   (idle pool connections — expected)
  Lock:advisory       141/247   (57% of samples have a backend queued on the lifecycle advisory lock)
  IPC:CheckpointDone   41/247   (17% — backends waiting for a requested checkpoint to finish)
  IO:WalSync           12/247    IO:DataFileExtend 4    LWLock:WALWrite 2    IO:WalWrite 2    Lock:relation 1    IO:DataFileRead 1
```

PG wait regime (Q6/Q7): backends are predominantly **executing** (avg 2.71 active of 3 worker connections); real waits are dominated by `Lock:advisory` (the lifecycle lane queue) and `IPC:CheckpointDone` (checkpoint-bound DDL), with WAL-sync waits present but minor at sampler granularity. Classification: **MIXED, execution-dominant with material lock/checkpoint waits** — not storage-IO-bound (99.9% cache hit) and not client-wait-dominant.

## 10. eBPF: scheduler, off-CPU, futex, durability syscalls (§24–§27)

**Runqueue latency (runqlat)** — one canonical test run:

```text
global: 619,652 wakeups, estimated total runqueue delay ≈ 3.75s over ~70s (≈ 0.05 cores equivalent)
node:   1,320 wakeups, 99% < 128µs, longest single delays 1–16ms (3 events ≥ 1ms)
vitest: 12 wakeups (workers mostly CPU-run, wakeups from idle parks)
SCHEDULER PRESSURE = NO_MATERIAL_RUNQUEUE_PRESSURE  (cap=3 does NOT oversubscribe 8 CPUs)
```

**Off-CPU (offcputime-bpfcc -u -f, 95s window)** — kernel-stack classification only (node user stacks `[unknown]`: no frame pointers; 986 lost stacks):

```text
postgres    906.5s off-CPU  — 885.6s epoll_wait  (= ClientRead idle of backends + postmaster aux; matches §9)
node        1,182.6s — 1,088.5s futex_wait
V8Worker / libuv-worker / rolldown-worker   1,051.7s / 1,008.7s / 956.0s — ~all futex_wait
caveat: node-family totals include idle agent-harness node processes (~2–3 tasks ≈ 200–300s)
```

Node/Vitest off-CPU is overwhelmingly **futex** — V8 platform/worker-thread and libuv thread-pool parking (attribution, not pathology); socket waits (epoll) are a small share for node (`epoll_pwait` ≈ 94s) because postgres.js hands waiting to the main event loop only around in-flight queries.

**futex latency (bpftrace, node only)** — 3,366 syscalls: majority 1–8µs; a long-park cluster of 268 × 0.5–1s, 44 × 4–8s, 15 × 8–16s = idle thread parks accumulating ≈ 640s across the run's threads. **Not a coordination bottleneck** — parks are idle capacity, not blocking chains (worker busy-time is already only 56% off-CPU, mostly awaiting PG).

**fsync / fdatasync (bpftrace, kernel-wide — postgres visible by comm)** — one canonical test run:

```text
postgres fsync     15,750 calls   mode 256–512µs   est. accumulated ≈ 7.1s   max < 8ms
postgres fdatasync  3,558 calls   mode 1–2ms       est. accumulated ≈ 4.6s   max < 8ms   (WAL commit sync, synchronous_commit=on)
cross-check: 3,558 fdatasync ≈ pg_stat_io client-backend WAL fsyncs 3,305 ✓  (15,750 fsync ≈ checkpointer 25,003-file accounting window difference)
```

Durability syscall costs are **material but not dominant**: ≈ 12s of accumulated per-process sync latency, overlapped across 3 backends + checkpointer, no pathological tails (nothing > 8ms). Block-I/O direct observation was unavailable (§3); the fallback chain (cgroup `io.stat` + `pg_stat_io` + `pg_stat_wal`) is internally consistent: 302MB WAL + 76MB extends + 135MB checkpoint writes ⇒ ~500MB physical writes, reads negligible (fully cached).

## 11. TEST_INFRA_TRACE correlation (§31)

`TEST_INFRA_TRACE=1 pnpm --filter @exam/db test` — 59 files / 707 tests PASS, wall 61.32s (vitest Duration; faster than baseline median — normal variance):

```text
acquisitions 219        wait: p50 128ms  p95 867ms  p99 2,463ms  max 4,479ms   (wait sum 64.9s)
                        hold: p50  88ms  p95 533ms  p99   768ms  max 4,407ms   (hold sum 47.5s)
lane utilization = 47.5s / 61.3s = 77.5%        (pre-#649 @65d56777: 252 acq, hold sum 62–70s, 91%)
```

Hold by caller (remaining lifecycle work):

| caller | op | acquisitions | hold sum |
|---|---|---:|---:|
| `getIsolatedTestDb` | CREATE SCHEMA + full migrate (fresh-schema path) | 26 | 12.1s |
| `dropDatabaseIfExists` | pg_terminate_backend + DROP DATABASE (fixture DBs) | 13 | 9.6s |
| `applyAllMigrations` | raw replay of all 44 migrations (test bodies) | 18 | 8.7s |
| `dropTestSchema` | DROP SCHEMA CASCADE | 75 | 6.4s |
| `makeEnv` (0027-convergence) | per-env drizzle migrate (test bodies) | 12 | 5.7s |
| worker-slot bootstrap (`testWorkerDatabase.ts:423`) | ensure + migrate slot | 6 | 3.0s |
| `createTestSchema` | CREATE SCHEMA | 48 | 1.5s |
| `ensureDatabaseExists` | catalog check + CREATE DATABASE | 11 | 0.4s |

Correlation with §9/§10: `dropDatabaseIfExists` holds (avg 740ms, max 4.4s) line up with the **11–12 requested checkpoints per run** (num_requested +11, sync_time +12.1s accumulated) and the 17%-of-samples `IPC:CheckpointDone` waits — fixture-DB drops block on forced checkpoints. The lifecycle lane is still 77.5% busy, but its hold content is now mostly **test-inherent DDL** (migration replays 14.4s, fresh-schema migrate 12.1s, fixture-DB lifecycle ~13s) rather than avoidable per-file overhead.

## 12. Bottleneck decomposition (§43/§34)

EXCLUSIVE wall attribution to 100% is impossible (client waits, PG CPU, PG waits, and fsyncs overlap; per §34). The table below is CORRELATED RESOURCE CONSUMPTION with the wall-relevant classification:

| cost / wait bucket | subject | evidence | magnitude (per ~70s run) | confidence | optimization relevance |
|---|---|---|---|---|---|
| worker off-CPU DB/lock wait | client | vitest busy 2.8/3 vs CPU 1.3 cores; offcputime; Lock:advisory 57% samples | ≈ 56% of worker busy-time | high | high — the binding regime |
| lifecycle lane holds | test infra | TEST_INFRA_TRACE | 47.5s serialized (77.5% lane util.) | high | high |
| — of which test-inherent DDL | test bodies | trace callers (migrate replay, fresh-schema, fixture DBs) | ≈ 39s of the 47.5s | med-high | medium (semantic constraints) |
| — of which checkpoint-inflated drop/create | test infra + PG | checkpointer +11 req/run, IPC:CheckpointDone 17% | ≈ 10–13s of holds | med-high | high |
| PostgreSQL CPU | PG container | cgroup cpu.stat | 63.6s (0.91 cores, unsat.) | high | medium |
| WAL / durability | PG | pg_stat_wal, io | 302MB WAL, 38.6k FPI, 3.3k commit fdatasync (≈4.6s acc.), 25k ckpt fsyncs (≈7.1s acc.) | high | medium-high |
| checkpoint background write | PG | pg_stat_checkpointer | write_time +63.9s acc. (overlapped), 122MB/run | med-high | medium |
| client CPU (JSON parse/GC/import) | client | perf record, vitest phase timers | 92.7s CPU; import ≈ 12s/worker chain | high | medium |
| V8 coverage runtime | client | test vs coverage profiles | +7.1s CPU, +2.5% wall, PG unchanged | high | low |
| scheduler / runqueue | client | runqlat | ≈ 3.75s total delay, node tail < 16ms | high | none (falsified lever) |
| physical block I/O tails | Docker VM | cgroup io.stat (direct block obs. UNAVAILABLE) | 500MB writes, 38k wios, no tail evidence | medium | low |
| process orchestration (pnpm/turbo) | client | timing, perf | ≈ 1.5s wall | high | none |
| Docker overhead | both | cpu.stat throttle 0; net ~20MB/run | NOT_DEMONSTRATED | med-high | none |
| unexplained remainder | — | — | small; wall ≈ heaviest worker chain (53.7s avg chain + imbalance + startup) | medium | — |

## 13. Hypothesis falsification (§45)

| hypothesis | verdict | evidence |
|---|---|---|
| H1 cap=3 scheduler oversubscription is the main problem | **FALSIFIED** | runqlat: global delay ≈ 3.75s/70s (0.05 cores), node tail < 16ms; total system CPU (client 92.7s + PG 63.6s) ≈ 2.2 of 8 cores |
| H2 remaining lifecycle lock contention is still the main wall-time bottleneck | **SUPPORTED (with nuance)** | lane utilization 77.5%, Lock:advisory in 57% of PG samples, wait p95 867ms/max 4.5s; but ~80% of hold content is test-inherent DDL, so the lever is lane-operation latency/volume, not lock protocol redesign |
| H3 PostgreSQL storage fsync dominates | **FALSIFIED** (as dominant) | ≈ 12s accumulated sync latency, overlapped, max < 8ms; WalSync in 5% of samples; cache hit 99.9% |
| H4 coverage overhead is the dominant cost | **FALSIFIED** | +0.6–2.5% wall, +7.6% client CPU, PG work identical |
| H5 PostgreSQL CPU dominates | **PARTIALLY SUPPORTED** | PG is the busiest single executor (63.6s ≈ 0.91 cores) and the shared serialization point, but it is not saturated and is itself ~56% blocked behind lane/checkpoint waits |
| H6 ordinary repository tests now dominate | **FALSIFIED** | top-3 files are migration/DB-lifecycle proofs (28.1s, 19.7s, 19.0s); repo bodies are 200–500ms each |
| H7 Vitest process startup/orchestration dominates | **FALSIFIED** | pnpm/turbo ≈ 1.5s; module import ≈ 12s per worker chain (~17% of chain, secondary) |
| H8 Docker itself is the main cost | **FALSIFIED / NOT_DEMONSTRATED** | zero throttling, ~20MB/run network through the proxy, no measurable containerization signature |

## 14. Explicit answers (§44)

```text
Q1  regime                = DB_WAIT_BOUND (workers ≈ 56% off-CPU waiting on PG round-trips/lane;
                            mixed with lifecycle serialization; NOT cpu/scheduler/coverage/IO-bound)
Q2  coverage regime change = NO (pure client-side +2.5% wall; PG identical)
Q3  cap=3 runqueue pressure = NO_MATERIAL_RUNQUEUE_PRESSURE
Q4  client CPU saturated   = NO (1.30–1.37 of 8 cores)
Q5  PG container CPU saturated = NO (0.91 cores, nr_throttled 0)
Q6  PG executing or waiting = executing-dominant (2.71 active avg) with material advisory-lock + checkpoint waits
Q7  dominant PG waits      = Lock:advisory (57% of samples) · IPC:CheckpointDone (17%) · IO:WalSync (5%)
Q8  fsync/WAL durability material = material but secondary (≈12s accumulated sync latency, no >8ms tails;
                            302MB WAL + 38.6k FPI per run amplify lane holds)
Q9  physical block-IO tails material = NOT DEMONSTRATED (direct block observation unavailable; cgroup io.stat
                            shows steady 500MB writes, no tail signature)
Q10 remaining lifecycle major wall owner = YES as the serialization structure (77.5% lane busy) —
                            LIFECYCLE_MATERIAL_BUT_NOT_DOMINANT in the #478 sense: the hold content is now
                            test-inherent DDL, so a second architecture redesign is NOT justified
Q11 ordinary test bodies dominant = NO (they are the majority of count, not of wall; tails are DDL files)
Q12 Vitest/pnpm orchestration material = NO (≈1.5s pnpm; import ≈12s/worker secondary)
Q13 Docker overhead demonstrated = NO (NOT_DEMONSTRATED)
Q14 top three cost centers      = (1) lifecycle-lane serialized DDL work (47.5s holds, checkpoint-inflated
                            drop/create ≈10–13s) · (2) PG durability/WAL churn (302MB WAL, 12 requested
                            checkpoints, 63.9s ckpt write + 12.1s ckpt sync accumulated) · (3) client-side
                            JSON.parse/internalization/GC CPU + module import (92.7s CPU, unsaturated)
Q15 single highest-prize next optimization = see §15
Q16 falsified temptations       = worker-cap changes, coverage execution optimization, lock-protocol redesign,
                            fsync/durability disabling as a "quick win", Docker tuning
```

## 15. Optimization candidates (§46 — selection only, NOT implemented)

**Candidate 1 — remaining lifecycle-operation latency: checkpoint-inflated fixture-DB lifecycle + fresh-schema lane volume**

```text
prize          ≈ 8–15s of ~70s wall (12–20%), bounded by the slowest-worker-chain structure
evidence       dropDatabaseIfExists 13× = 9.6s lane holds (avg 740ms, max 4.4s) ≈ forced-checkpoint waits;
               pg_stat_checkpointer num_requested +11/run, sync_time +12.1s, write_time +63.9s;
               IPC:CheckpointDone in 17% of pg_stat_activity samples; getIsolatedTestDb 26 acq = 12.1s holds
               + create/dropTestSchema ≈ 8s across 10 files (only 6 look genuinely isolation-bound)
risk           medium — checkpoint/DDL timing is semantics-adjacent; slot-conversion must respect the
               getWorkerScopedTestDb contract (files needing mutually isolated fixtures stay on fresh schemas)
proof burden   ADR-007 rule-compliance + flake bounds (lane waits p99 2.5s today)
next experiment (static) classify the 10 getIsolatedTestDb files / 26 acquisitions by genuine isolation need;
next experiment (dynamic, SEPARATE falsification phase per §48) controlled checkpoint-behavior sweep
               (checkpoint_timeout / max_wal_size / deferred drop strategy) with N≥5, readouts = wall,
               lane hold sum, CheckpointDone sample rate, dropDatabaseIfExists hold distribution
```

**Candidate 2 — client-side module-import/JSON cost (secondary)**

```text
prize          ≈ 5–8s wall (import 35–38s cumulative ≈ 12s per worker chain; JSON.parse+internalization+GC ≈ 25% of client CPU)
evidence       perf record profiles (both regimes); vitest phase timers
risk           medium — touches the vitest/Vite pipeline, not test semantics
proof burden   transform-cache behavior must not mask real failures; per-file import budget
next experiment  measure import-time attribution with node --cpu-prof / --perf-prof on one file cohort
```

**Falsified levers (do not pursue):** worker-cap sweep (no scheduler pressure — though a cap=2/3/4 sweep remains cheap if ever needed, evidence says the knee is not scheduling), coverage-specific execution optimization, lifecycle lock redesign (#478 already falsified), Docker tuning, `fsync=off`-style quick wins (would need the §48 protocol and buys only the non-dominant 12s).

```text
PRIMARY_NEXT_CANDIDATE = Candidate 1: reduce remaining lifecycle-lane latency
                         (checkpoint-inflated fixture-DB CREATE/DROP + fresh-schema path volume)
ESTIMATED_PRIZE = 8–15s of ~70s wall (12–20%)
WHY = the lifecycle advisory lane is still 77.5% busy and its two largest REMOVABLE components are
      checkpoint-bound fixture-DB drops (mechanism proven by three independent probes) and the
      fresh-schema migrate path still serving files that may not need it
NEXT_EXPERIMENT = static eligibility audit of the 10 getIsolatedTestDb files, then a SEPARATE controlled
      checkpoint-behavior falsification phase (deferred per §48; PG config untouched in this pass)
```

## 16. Firewall compliance (§3/§49–§53)

```text
CODE_OPTIMIZATION_PERFORMED = NO
WORKER_CAP_CHANGED = NO          LOCKING_CHANGED = NO
TIMEOUTS_CHANGED = NO            POSTGRES_CONFIG_CHANGED = NO
DOCKER_CONFIG_CHANGED = NO       KERNEL/sysctl CHANGED = NO   (sudo used only for probe execution)
```

Limitations: PG server-side perf unavailable (container in Docker Desktop VM; compensated by container-internal cgroup accounting + kernel-wide eBPF comm attribution + full PG telemetry); BCC python tools unusable (no kernel headers); host block-layer program load denied and container IO bypasses the host kernel regardless; V8 JS-level frames unresolved (no `--perf-prof`); TEST and COVERAGE PG deltas measured on one canonical run each (cross-regime consistency shown, not N=5); offcputime node-family totals include agent-harness node processes (directionally robust, magnitudes approximate); exclusive wall attribution impossible by nature (§34) — the decomposition is correlated-consumption, not an additive pie.

Stop conditions: none triggered (perf usable, eBPF usable, variance ±1.4–3.9%, PG isolated on this dev container).
