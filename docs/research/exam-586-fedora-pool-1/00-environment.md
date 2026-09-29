# #586 Fedora pool-occupancy experiment — 00 Environment freeze

Status: FROZEN at campaign start (before any treatment run). Raw capture
commands are quoted; every number below was produced by them on the
experiment host. No host tuning was performed for this experiment.

## Capture time and host identity

```text
date --iso-8601=seconds → 2026-09-29T19:15:06+08:00
hostname → E5 (LAN 192.168.31.75)
```

## OS / kernel / hardware

```text
uname -a → Linux E5 7.2.5-200.fc44.x86_64 #1 SMP PREEMPT_DYNAMIC Fri Sep 11
           15:11:05 UTC 2026 x86_64 GNU/Linux
/etc/fedora-release → Fedora release 44 (Forty Four)
Docker info Operating System → Fedora Linux 44 (KDE Plasma Desktop Edition)
lscpu:
  Model name: Intel(R) Xeon(R) CPU E5-2666 v3 @ 2.90GHz
  Socket(s): 1   Core(s) per socket: 10   Thread(s) per core: 2
  → 20 logical CPUs
free -h → Mem: 62Gi total, 57Gi available at freeze time
/proc/meminfo → MemTotal 65676220 kB, MemAvailable 59954836 kB, HugePages 0
uptime at freeze → up 1 day, load average 0.14 0.11 0.07 (host idle)
```

## Docker / Compose

```text
docker version → Docker 29.7.2 (server)
docker compose version → Docker Compose version v5.5.0
docker info → Storage Driver: overlayfs; Cgroup Driver: systemd;
              Cgroup Version: 2; CPUs: 20; Total Memory: 62.63GiB
cgroup v2 unified (stat -fc %T /sys/fs/cgroup → cgroup2fs)
Root/host filesystem: /dev/sda3 btrfs, 445G, 410G avail (8% used)
```

## CPU frequency governor (pre-existing host state, NOT changed)

```text
cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor (all 20 CPUs)
→ schedutil (20/20)
```

Per protocol §3 this governor is recorded as found; it was not modified.

## Pre-existing deployment isolation check (protocol §2)

At campaign start, before any experiment stack existed:

```text
docker ps -a → only "gracious_taussig" (hello-world, Exited (0) 2 months ago)
docker compose ls -a → empty (no compose projects)
docker network ls → bridge, host, none (defaults only)
docker volume ls → empty
docker images → redis:7-alpine, postgres:18.4-bookworm, hello-world only
```

There is NO pre-existing Exam production deployment, database, network, or
data directory on this host. The experiment still runs in a fully isolated
namespace (`COMPOSE_PROJECT_NAME=exam-586`, `-p exam-586`), its own
`EXAM_DATA_ROOT` under `/home/jnhu/exam-586/runs/<run-id>/data`, its own
secrets, and the non-production port `EXAM_PORT=18080` (verified free).
Nothing named `exam-prod` and no `./data` / `/srv/exam` path is used.

## Topology under test (production Compose, docker-compose.yml @ research head)

```text
load driver (Fedora host → driver container on exam-net bridge)
        |
        v
web  (nginx:1.30.5-alpine3.24, deploy/nginx/web.conf baked into image,
      sole public ingress, published ${EXAM_PORT:-80} → 18080)
        |  /api/** proxied, X-Forwarded-For REPLACED with $remote_addr
        v
app  (EXAM_IMAGE, target=runner, node:24.15.0-bookworm-slim, :3000,
      APP_MODE=production, sole migration owner via docker-entrypoint.sh)
        |  Docker bridge network exam-net (pinned 172.31.0.0/16)
        v
db   (postgres:18.4-bookworm, data in per-run EXAM_DATA_ROOT, NOT published)
```

- Redis: NOT RUN. The current production compose ships Redis as an optional
  profile (`profiles: ["redis"]`, P6-010: "a bare `docker compose up` starts
  no Redis"); the deployment runbook default `.env.production` leaves
  `REDIS_URL` unset → `REDIS_MODE=off` → the rate limiter uses its in-process
  store. The protocol requires Redis only "if the current production topology
  also requires Redis for the accepted production rate-limiter topology"; the
  documented default production topology does not start Redis. Identical in
  every cell (including A/A). (#550's WSL rig used dev-compose Redis; that is
  a rig difference recorded in 03-method.md, not a treatment variable.)
- `TRUSTED_PROXY_CIDRS=172.31.0.0/16` (the pinned exam-net subnet): the
  documented production configuration for the bundled nginx edge (deployment
  runbook: "set this to the Compose bridge subnet"); without it every client
  collapses onto the edge IP and the production per-IP limiter would 429 the
  whole burst.
- App-side resource limits: none declared in compose → `UNBOUNDED_BY_COMPOSE`
  (recorded per container in each run's meta.json via docker inspect).

## Host load discipline

No other significant host workload is run during the campaign. Load average
is sampled per run (host sample lines in each run's docker-stats.jsonl) and
runs contaminated by material external load are INVALID per §28.
