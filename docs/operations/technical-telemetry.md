# Technical Telemetry — Opt-in Observability Stack (ADR-028, #964 W6)

> **Authority:** operational runbook for the opt-in OpenTelemetry
> observability profile. The default deployment is **Off** — a bare
> `docker compose --env-file .env.production up -d` starts none of the
> services in this document and keeps the offline LAN contract (no SDK,
> no exporter task, no telemetry network). Architecture boundaries:
> [ADR-028](../adr/ADR-028-opentelemetry-technical-telemetry.md)
> (PROPOSED). Signal vocabulary owners: W2 (DB metrics), W3 (business
> operation spans), W4 (background loop metrics).

## 1. What the profile is

`deploy/observability/docker-compose.observability.yml` adds an isolated
`observability` Compose profile to the production stack:

| Service | Image (pinned, W6-validated) | Role |
| --- | --- | --- |
| otelcol | `otel/opentelemetry-collector-contrib:0.165.0` | OTLP receiver (HTTP :4318, internal only), scrubbed pipeline, batch + bounded queues |
| tempo | `grafana/tempo:3.1.1` | Trace backend (local filesystem storage) |
| loki | `grafana/loki:3.7.9` | Log backend (native OTLP ingestion) |
| prometheus | `prom/prometheus:v3.16.0` | Metric backend (scrapes the collector's :8889 exposition) |
| grafana | `grafana/grafana:13.3.1` | Visualization (datasources auto-provisioned: Tempo/Prometheus/Loki) |

**Port bindings.** Everything stays internal to `exam-net` EXCEPT
Grafana, which publishes exactly one host port, loopback-bound by
default: `${OBS_GRAFANA_HOST_BIND:-127.0.0.1}:${OBS_GRAFANA_PORT:-13000}:3000`.
Technical telemetry is never exposed through an Exam-managed API
(ADR-018 D6). To open it to the LAN, set `OBS_GRAFANA_HOST_BIND=0.0.0.0`
and provide an authenticated ingress — the host operator owns that
decision and its exposure.

**Log ingestion is single-path** (ADR-028 D3): the app keeps writing
pino JSON to stdout; Docker's json-file driver serializes it and the
collector's filelog receiver tails `/var/lib/docker/containers` on the
host, selecting ONLY the app container via the `tag=exam-app` log-opt
(the compose file stamps it). The same stdout stays consumable via
`docker compose logs app` — the stdout operations contract is unchanged.

**Field-cleaning split.** The application owns redaction BEFORE export
(`logRedaction.ts` secrets/URL policy, `UrlScrubSpanProcessor`, closed
metric label sets — W1–W4 evidence). The collector adds only the
deployment-level `service.name` identity for filelog logs and never
rewrites bodies. No second redaction layer is configured: a raw-SQL or
credential leak would be a W1–W4 application defect, not something the
collector can fix after the fact.

## 2. Enable

```bash
# 0. One-time data-directory ownership (bind mounts; container UIDs):
sudo mkdir -p data/observability/{tempo,loki,prometheus,grafana}
sudo chown -R 10001:10001 data/observability/{tempo,loki}
sudo chown -R 472:472 data/observability/grafana
sudo chown -R 65534:65534 data/observability/prometheus

# 1. Grafana access + admin password in .env.production:
#    OBS_GRAFANA_ADMIN_PASSWORD=<secret>          # required when profile runs
#    OBS_GRAFANA_HOST_BIND=127.0.0.1              # loopback default
#    OBS_GRAFANA_PORT=13000

# 2. Start the profile (same project, same env file, base + overlay):
docker compose --env-file .env.production \
  -f docker-compose.yml \
  -f deploy/observability/docker-compose.observability.yml \
  --profile observability up -d

# 3. Turn the app's export ON (requires app restart to take effect):
#    in .env.production:
#    TELEMETRY_ENABLED=true
#    TELEMETRY_EXPORTER=otlp
#    TELEMETRY_OTLP_ENDPOINT=http://otelcol:4318
docker compose --env-file .env.production \
  -f docker-compose.yml \
  -f deploy/observability/docker-compose.observability.yml \
  --profile observability up -d   # recreates app with the new env

# 4. Verify:
docker compose --env-file .env.production logs otelcol | tail   # "Everything is ready"
curl -s http://localhost:${OBS_GRAFANA_PORT:-13000}/api/health   # Grafana up
# In Grafana: Explore → Tempo (service.name=exam-api), Prometheus
# (exam_loop_cycle_count_total — the collector's Prometheus exporter adds
# the _total suffix to counters), Loki ({service_name="exam-app"}).
```

**Config validation** (no start required, target version):

```bash
docker run --rm -v "$(pwd)/deploy/observability/otelcol.yaml:/etc/otelcol/config.yaml:ro" \
  otel/opentelemetry-collector-contrib:0.165.0 validate --config=/etc/otelcol/config.yaml
# exit 0 = valid; a bad config prints the failing component and exits 1
```

**Startup guard.** `TELEMETRY_EXPORTER=otlp` without
`TELEMETRY_OTLP_ENDPOINT` (or an endpoint left over after switching the
exporter back) fails fast at app startup with a `RuntimeConfigError` —
an explicit operator error, never a silent Off or silent export target.

## 3. Rollback / disable

Telemetry rollback is configuration-only, in two independent steps:

```bash
# App export off (the app returns to the On/no-export posture; the
# offline contract is fully restored when TELEMETRY_ENABLED is cleared):
#   .env.production: remove/comment TELEMETRY_ENABLED, TELEMETRY_EXPORTER,
#   TELEMETRY_OTLP_ENDPOINT — then recreate the app container.

# Observability stack down (independent of the app):
docker compose --env-file .env.production \
  -f docker-compose.yml \
  -f deploy/observability/docker-compose.observability.yml \
  --profile observability down
```

No business schema or data is touched by either step. A bare
`docker compose --env-file .env.production -f docker-compose.yml up -d`
(base file only) never starts the profile.

## 4. Failure boundaries (validated in W6)

- **Collector unreachable** (`docker stop otelcol`): app requests,
  readiness, and shutdown are unchanged — the app's own export queue is
  bounded (`maxQueueSize 2048`, 5 s flush, 30 s export timeout, 3 s
  shutdown-flush race); lost telemetry is UNKNOWN, never a business fact.
- **Backend (tempo/loki) unreachable**: the collector's
  `sending_queue` (queue_size 2000, 4 consumers) + `retry_on_failure`
  (1 s→10 s backoff, 60 s max elapsed) bound the outage; on queue
  overflow data is dropped, never does the collector block the app (its
  OTLP receiver is fire-and-forget from the app's perspective).
- **Shutdown**: telemetry flush is a bounded term appended to the #351
  shutdown budget (3 s race, never extends exit, never changes the exit
  code). `stop_grace_period: 45s` is untouched.
- Readiness/alerting authority stays with `probeApplicationReadiness`
  and the `operability.*` stdout events — stopping every observability
  container does not change `/api/ready` or alert transitions.

## 5. Retention, storage, and resources

All backends use LOCAL filesystem storage under
`${EXAM_DATA_ROOT:-./data}/observability/` (bind mounts — see §2 step 0
for one-time ownership). No object storage, no cloud dependency.

| Backend | Default retention | Knob |
| --- | --- | --- |
| Tempo | 14 days | compose command flag `-backend-scheduler.provider.work.compaction.block-retention=336h` (flag-addressable only in 3.1.1) |
| Loki | 14 days | `limits_config.retention_period` in `loki-config.yaml` + compactor `retention_enabled` via `delete_request_store` |
| Prometheus | 14 days | `--storage.tsdb.retention.time=14d` in the compose command |

Retention horizons are operator decisions — adjust per deployment
policy. Disk sizing: telemetry volume is dominated by traces; with the
default full sampling it is on the order of the request rate × a few
KB. Bound first via `TELEMETRY_SAMPLE_RATIO` if disk-constrained.

Resource bounds: the collector is capped at 768 MiB
(`memory_limiter` 500 MiB hard limit + spike margin; compose memory
limit 768M). Tempo/Loki/Prometheus/Grafana run with image defaults —
profile them before raising.

## 6. What is NOT here

- **On-call delivery / human ACK of alerts** (#870): the `operability.*`
  stdout events remain the alert contract (see
  [active-alerting.md](./active-alerting.md)); this stack only stores
  and visualizes technical signals. No alertmanager is deployed.
- **Production capacity evidence**: W6 validated single-signal end-to-end
  flow and failure boundaries on a lab stack. CPU/p99 overhead budgets
  (≤5% each) and full-capacity soak are W7.2 scope on the final
  candidate.
- **Application-side OTLP log export**: deliberately absent — stdout
  collection is the single remote log path (ADR-028 D3). Pino
  correlation fields (`trace_id`/`span_id` in stdout lines) bridge logs
  to traces in Loki (the Grafana Loki datasource configures the
  TraceID derived-field link).

## 7. Troubleshooting

| Symptom | Check |
| --- | --- |
| `telemetry.init_failed` in app stderr at boot | The guard pair: `TELEMETRY_EXPORTER=otlp` requires `TELEMETRY_OTLP_ENDPOINT` (and vice versa); also `exportIntervalMillis ≥ exportTimeoutMillis` reader bounds are code-owned |
| No traces in Tempo | `docker logs otelcol` for exporter errors; confirm app env reached the container (`docker compose exec app printenv TELEMETRY_OTLP_ENDPOINT`) |
| No logs in Loki | Host path `/var/lib/docker/containers` must be mounted read-only into otelcol (in the compose file); entries without `attrs.tag == "exam-app"` are dropped by design |
| No metrics in Prometheus | `http://otelcol:8889/metrics` (network-internal) should list `exam_loop_*` / `db_client_operation_duration_seconds_*`; check the `otelcol-exam-metrics` target at Prometheus `/targets` |
| Grafana 403/locked out | `OBS_GRAFANA_ADMIN_PASSWORD` is required when the profile runs (compose fails fast without it); reset by clearing `data/observability/grafana` (loses dashboards) |
