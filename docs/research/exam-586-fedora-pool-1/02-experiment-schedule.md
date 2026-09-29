# #586 — 02 Experiment schedule (frozen before any treatment run)

Status: FROZEN. This file was written and committed before the first A/A or
treatment burst was collected. Run order is never reordered after seeing
results (§17); an infrastructure-invalid run is marked INVALID, kept, and its
replacement is APPENDED (§28).

## Cell naming

```text
<phase>-p<pool>-S<scale>-r<replicate>[-<suffix>]
phase: aa | main | smoke   (smoke runs are rig shakedowns, never treatment)
pool: mode unset → "unset" (canonical implicit default); else explicit 10/20/30
```

## A/A gate (protocol §15) — 8 bursts

Compares canonical implicit default (A, `EXAM_586_RESEARCH_POOL_MAX` unset)
vs explicit `{max: 10}` (A') under identical conditions, interleaved,
S100 + S200, two replicates each, reversed order in the second half:

```text
aa-01  A  S100
aa-02  A' S100
aa-03  A' S200
aa-04  A  S200
aa-05  A  S200   (reversed ordering begins)
aa-06  A' S200
aa-07  A' S100
aa-08  A  S100
```

Gate: explicit-10 must fall within ordinary run-to-run variance of implicit
canonical behavior across HTTP p50/p95/p99/max, TX_ACQUIRE_PROXY, TX_HOLD,
PG active/total connections, lock waits, PG CPU, app CPU, errors, retries.
Tolerance is derived from the observed replicate variance of this very
sequence (not imposed after the fact). FAIL ⇒ STOP before 20/30 (§15, §29).

## Main matrix (protocol §16/§17) — 27 measured bursts, counterbalanced

Three replicate blocks; each block contains each pool once; scales rotate
across blocks; every (pool, scale) pair appears exactly once per full cycle:

```text
replicate block 1:  main-01 p10-S50   main-02 p20-S100  main-03 p30-S200
replicate block 2:  main-04 p20-S200  main-05 p30-S50   main-06 p10-S100
replicate block 3:  main-07 p30-S100  main-08 p10-S200  main-09 p20-S50
```

(Each row above is executed with rep = block number: 3 blocks × 3 pools ×
3 scales = 27 cells. Within a block the runs execute in the listed order.)

## Rig shakedown (non-treatment)

Before aa-01: one `smoke-S20` cell validates the full pipeline (fresh data
root, image identity, ingress, identities/limiter, instrumentation output,
samplers, oracles, checksums). Smoke evidence is retained but excluded from
all treatment statistics.

## Replacement policy

A replacement for an INVALID run is appended to this schedule as
`main-XXb` / `aa-XXb` in the same (pool, scale, rep) cell, and the appended
entry is recorded in `results/INVALIDATIONS.md` with the original run id and
`INVALID_REASON.txt`. Failed raw evidence is never deleted (§17, §28).
