# #586 — 08 Resource & PostgreSQL Evidence

Status: FINAL. Sources: per-cell `docker-stats.txt` (1 s), `pg-before/after.json`
(cumulative `pg_stat_database` deltas across the burst window),
`pg-settings.txt`, `pg-activity.jsonl` occupancy samples, host baseline in
00-environment.md.

## Host & containers

- Fedora 44, kernel 7.2.5-200.fc44.x86_64, Xeon E5-2666 v3 (10C/20T),
  62 GiB RAM, schedutil governor (unchanged during campaign), host idle
  apart from the experiment (measured before every cell).
- All three services in one Compose project `exam-586` on the pinned
  bridge `exam-net` (172.31.0.0/16); PostgreSQL never published to a
  host port; driver ran on the same bridge with 200 secondary source IPs
  (oracle: distinct candidate IPs = N in every cell).
- db CPU stayed far from saturation in every cell (docker stats peak
  ≈ 106% of one core — main-03 — out of 20 threads; pool-20/N=200 peaked
  ≈ 97%, pool-10/N=200 ≈ 89%); app and web containers lower still. Load
  average returned to the idle baseline after each cell.

## PostgreSQL

- Dockerized PostgreSQL (per-cell `pg-version.txt`); `max_connections`
  and all tuning flags identical across cells — the ONLY varied factor
  was the app pool cap (protocol §4/§5).
- Occupancy (200 ms samples, application_name-filtered): pg active max
  tracked the pool cap exactly (10/20/30) in every cell — the pool, not
  PG, is the admission boundary.
- Saturation fraction (fraction of sampled instants with active ≥ pool
  cap): 0.19–0.25 (N=50), 0.31–0.38 (N=100), 0.40–0.61 (N=200),
  rising with both scale and pool size. Interpreted together with 07:
  "active" at high pool sizes is mostly tuple-lock waiters, i.e. the
  convoy itself, not useful parallelism.
- Wait-event profile (S200 cells): Lock/tuple 72–88% of active backend
  time; Lock/transactionid 4–11%; LWLock/WALWrite and IO/WalSync
  low single digits — I/O and WAL are not limiting on this host.
- `pg_stat_database` deltas: no deadlocks detected in any cell
  (consistent with retries = 0); blks_read negligible (warm cache);
  xact_commit counts match expected per-candidate transaction volumes.
- main-03 sampled one instant with 31 active backends — a non-app
  backend (autovacuum family) momentarily active; app occupancy stayed
  ≤ 30. Recorded for transparency; no protocol impact.

## Correctness-adjacent resource facts

- Distinct candidate source IPs = N in every cell (identity preserved
  through nginx `$remote_addr` + TRUSTED_PROXY_CIDRS=172.31.0.0/16, the
  #550 NAT finding applied).
- 429 count = 0 in every cell: production rate limiter (global
  100/min/IP) was never a factor at these scales; it was never weakened
  or bypassed.
- Redis off = compose default (P6-010, profile-optional; runbook default
  REDIS_URL unset → in-process limiter store) — documented in
  00-environment.md.

## Conclusion

No tested pool size approached a host or PostgreSQL compute/IO ceiling.
The measured saturation is lock-queue occupancy on one tuple. Resource
explanations for the tail are excluded; the structural explanation in
06/07 stands.
