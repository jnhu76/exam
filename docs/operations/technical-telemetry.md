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

Two opt-in overlays add observability services to the production stack
under Compose profiles. The verified overlay carries the VALIDATED
traces/metrics leg; the logs overlay carries the file-log ingestion leg,
which is **PENDING VERIFICATION** and disabled by default (§2.1):

| Service | Image (pinned, W6-validated) | Role | Overlay |
| --- | --- | --- | --- |
| otelcol | `otel/opentelemetry-collector-contrib:0.165.0` | OTLP receiver (HTTP :4318, internal only) for traces/metrics, batch + bounded queues | `docker-compose.observability.yml` (`observability`, validated) |
| tempo | `grafana/tempo:3.1.1` | Trace backend (local filesystem storage) | same |
| loki | `grafana/loki:3.7.9` | Log backend (native OTLP ingestion; idle until the logs leg is enabled) | same |
| prometheus | `prom/prometheus:v3.16.0` | Metric backend (scrapes the collector's :8889 exposition) | same |
| grafana | `grafana/grafana:13.3.1` | Visualization (datasources auto-provisioned: Tempo/Prometheus/Loki) | same |
| otelcol-logs | `otel/opentelemetry-collector-contrib:0.165.0` | **File-log ingestion leg — PENDING VERIFICATION** | `docker-compose.observability.logs.yml` (`observability-logs`, §2.1) |

**Port bindings.** Everything stays internal to `exam-net` EXCEPT
Grafana, which publishes exactly one host port, loopback-bound by
default: `${OBS_GRAFANA_HOST_BIND:-127.0.0.1}:${OBS_GRAFANA_PORT:-13000}:3000`.
Technical telemetry is never exposed through an Exam-managed API
(ADR-018 D6). To open it to the LAN, set `OBS_GRAFANA_HOST_BIND=0.0.0.0`
and provide an authenticated ingress — the host operator owns that
decision and its exposure.

**Log ingestion is single-path and GATED** (ADR-028 D3, #979 P1): the
only remote log path for this deployment mode is stdout collection —
pino JSON → Docker json-file driver → collector `file_log` receiver →
Loki. After the #979 P1 split this leg ships in its own overlay
(`docker-compose.observability.logs.yml`, `observability-logs` profile,
config `otelcol.logs.yaml`) with STATUS **PENDING VERIFICATION**: it
reads the Docker daemon's json-file storage directly, which Docker does
not support for external tools, and it could not be host-verified in the
W6 lab — so it MUST stay disabled until the §2.1 acceptance criteria
pass on a real Linux Docker host. The verified overlay mounts no host
Docker state. Selection is deployment-distinguishable: the app container
stamps its compose container name (`tag: "{{.Name}}"`, e.g.
`/exam-prod-app-1`) into every json-file line, and the logs collector
keeps only entries whose tag matches `OBS_LOGS_TAG_PATTERN` (injected by
the logs overlay, default `^/?exam-prod-app-1$`), so other containers
and a second same-host Exam deployment are not ingested. The same stdout
stays consumable via `docker compose logs app` — the stdout operations
contract is unchanged.

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
# the _total suffix to counters). Loki has data ONLY with the logs leg
# enabled (§2.1, PENDING VERIFICATION): then {service_name="exam-app"}.
```

**Config validation** (no start required, target version):

```bash
docker run --rm -v "$(pwd)/deploy/observability/otelcol.yaml:/etc/otelcol/config.yaml:ro" \
  otel/opentelemetry-collector-contrib:0.165.0 validate --config=/etc/otelcol/config.yaml
# exit 0 = valid; a bad config prints the failing component and exits 1
```

### 2.1 File-log ingestion leg — PENDING VERIFICATION (#979 P1)

> **Status:** this leg is NOT verified end-to-end and MUST stay
> disabled until the acceptance criteria below pass on a real Linux
> Docker host. It was split out of the validated collector (#979 P1)
> because it reads the Docker daemon's json-file storage
> (`/var/lib/docker/containers`) directly — Docker does not support
> external tools reading that storage (directory layout, file naming,
> and root-only permissions are not a stable interface across Docker
> versions) — and the W6 WSL2 lab host could not read it at all. The
> validated traces/metrics acceptance in §2 above is unaffected.

**Prerequisites (all required before enabling):**

- A real Linux Docker host whose daemon data directory is readable
  root-side (not a WSL2/Docker Desktop lab where it is not), running
  the production Docker version.
- The verified stack is already up per §2 (steps 0–2) and healthy.
- The deployment's log selector is DERIVED from its own compose project
  name at interpolation time: `OBS_LOGS_TAG_PATTERN` defaults to
  `^/?${COMPOSE_PROJECT_NAME}-app-1$$`, so the canonical deployment
  (`name: exam-prod` in the base file) derives `^/?exam-prod-app-1$`
  and a second same-host deployment under a different project name
  derives its own pattern — neither collector can select the other's
  containers (verified by rendering two projects through Compose).
  `OBS_LOGS_TAG_PATTERN` remains an explicit override for non-standard
  tag shapes only.

**Enable** (both profiles explicit; the file alone changes nothing —
the service is behind the `observability-logs` profile):

```bash
docker compose --env-file .env.production \
  -f docker-compose.yml \
  -f deploy/observability/docker-compose.observability.yml \
  -f deploy/observability/docker-compose.observability.logs.yml \
  --profile observability --profile observability-logs up -d
```

**Config validation** (no start required; the deployment default —
`^/?<project>-app-1$`, derived from the compose project name — is owned
by the logs overlay. The collector-side config itself has a
match-nothing env fallback `^$`, so a bare run without the env validates
but collects nothing — never permissive):

```bash
docker run --rm -e OBS_LOGS_TAG_PATTERN='^/?exam-prod-app-1$' \
  -v "$(pwd)/deploy/observability/otelcol.logs.yaml:/etc/otelcol/config.yaml:ro" \
  otel/opentelemetry-collector-contrib:0.165.0 validate --config=/etc/otelcol/config.yaml
```

**Acceptance criteria (record the evidence in the deployment's ops
notes; all must pass before the leg is considered enabled):**

1. **Exactly-once ingestion.** Every line the Exam app writes to stdout
   appears in Loki exactly once, over a window that includes container
   restart and log rotation (json-file `max-size: 50m`, `max-file: 5`).
   The exporter's bounded queue + retry may delay delivery; it must not
   duplicate or silently drop lines short of the documented overflow.
2. **No foreign containers.** With unrelated containers running on the
   same host (differently tagged or untagged), none of their entries
   appear in Loki — the filter drops every non-matching tag, and a
   missing `attrs.tag` never matches (fail-closed).
3. **Same-host deployment isolation.** With a second Exam deployment
   (different compose project) running on the same host, its logs do
   not appear in this deployment's Loki and vice versa — the per-project
   derived defaults (or explicit overrides) keep the two collectors
   disjoint.
4. **Docker direct-read caveat acknowledged.** The ops notes record
   that the leg reads json-file storage against Docker's
   recommendation for external tools, the Docker version it was
   verified on, and Docker upgrades as a re-verification trigger.

**Startup guard.** `TELEMETRY_EXPORTER=otlp` without
`TELEMETRY_OTLP_ENDPOINT` (or an endpoint left over after switching the
exporter back) fails fast at app startup with a `RuntimeConfigError` —
an explicit operator error, never a silent Off or silent export target.
The endpoint must also be an ABSOLUTE credential-free http(s) URL: a
bare hostname or an `ftp://` value fails fast the same way (previously
the first degraded to `telemetry.init_failed` at SDK construction while
the second even reported telemetry active, both silently exporting
nowhere), and the init-failure diagnostic never echoes the endpoint
value itself.

## 3. Rollback / disable

Telemetry rollback is configuration-only, in two independent steps:

```bash
# App export off (the app returns to the On/no-export posture; the
# offline contract is fully restored when TELEMETRY_ENABLED is cleared):
#   .env.production: remove/comment TELEMETRY_ENABLED, TELEMETRY_EXPORTER,
#   TELEMETRY_OTLP_ENDPOINT — then recreate the app container.

# Observability stack down (scoped: stops ONLY the observability
# containers — the app/web/db/redis services and the shared compose
# network keep running, and the observability data volumes are retained
# for re-enable; verified against compose down [SERVICES] semantics):
docker compose --env-file .env.production \
  -f docker-compose.yml \
  -f deploy/observability/docker-compose.observability.yml \
  down otelcol tempo prometheus loki grafana

# With the file-log ingestion leg (§2.1) enabled, also stop its
# collector in the same scoped way:
docker compose --env-file .env.production \
  -f docker-compose.yml \
  -f deploy/observability/docker-compose.observability.yml \
  -f deploy/observability/docker-compose.observability.logs.yml \
  down otelcol-logs
```

Disabling only the file-log ingestion leg (§2.1, PENDING VERIFICATION)
is equally independent: run the scoped `down otelcol-logs` command
above (never a whole-project `down`, which would also stop the
business services) — nothing app-facing changes. Re-enable with §2's
`up` command.

A whole-project `down` (the same `-f` list WITHOUT the trailing
service names) is the FULL deployment teardown, not a telemetry
rollback — use it only when the business stack should stop too.

**Credential precondition.** Both scoped `down` commands interpolate
the SAME merged compose files as `up`, so they require the same
`.env.production` — including `OBS_GRAFANA_ADMIN_PASSWORD` (verified:
without it, compose fails at the interpolation stage with `required
variable OBS_GRAFANA_ADMIN_PASSWORD is required when the observability
profile is enabled` before touching any container, because the overlay
declares it with `:?`). `down` never uses the credential itself; if the
password was removed from the env file, temporarily restore any
placeholder value before running the rollback.

**Verify the rollback actually removed the collectors** (plain docker —
no compose interpolation involved). The checks are scoped by THIS
deployment's compose project label, so a neighbouring deployment's
containers on the same host never satisfy or fail the check, and the
removal check includes STOPPED containers — a stopped-but-present
collector is not "removed". `exam-prod` is the canonical project name
(the base file's `name:`); a deployment started under a different
project name (`-p` / `COMPOSE_PROJECT_NAME`, the same authority the §2.1
logs selector derives from) substitutes its own value:

```bash
PROJECT=exam-prod
# expect the "all removed" branch: no observability container — running
# OR stopped — remains under this deployment's project label:
docker ps -a \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --format '{{.Label "com.docker.compose.service"}}' \
  | grep -E '^(otelcol|otelcol-logs|tempo|prometheus|loki|grafana)$' \
  && echo "observability containers still present" \
  || echo "observability containers: all removed (including stopped)"
# expect one line per business service naming a running container — a
# service with no line is NOT running and must be investigated:
for svc in app web db redis; do
  printf '%s: ' "$svc"
  docker ps \
    --filter "label=com.docker.compose.project=${PROJECT}" \
    --filter "label=com.docker.compose.service=${svc}" \
    --format '{{.Names}} {{.Status}}'
done
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
- **Shutdown**: telemetry shutdown is a bounded term appended to the
  #351 shutdown budget — ONE 3 s deadline shared by every provider face
  from the moment shutdown starts (pinned by
  `apps/api/src/telemetry/telemetryShutdownSlowReceiver.test.ts`:
  against a collector that accepts but never answers, both faces export
  immediately and the whole composition returns at ≈3 s, never two
  serial 3 s bounds); never extends exit, never changes the exit code.
  `stop_grace_period: 45s` is untouched.
- Readiness/alerting authority stays with `probeApplicationReadiness`
  and the `operability.*` stdout events — stopping every observability
  container does not change `/api/ready` or alert transitions.
- **File-log leg (PENDING VERIFICATION, §2.1)**: the logs pipeline's
  exporter queue + retry bounds match the validated semantics above,
  but the host-read path itself (json-file tailing under rotation,
  root-only permissions, Docker upgrades) is NOT validated — that is
  precisely why the leg is gated behind its own overlay.

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

Resource bounds: each collector (otelcol, and otelcol-logs when the
§2.1 overlay is enabled) is capped at 768 MiB (`memory_limiter` 500 MiB
hard limit + spike margin; compose memory limit 768M).
Tempo/Loki/Prometheus/Grafana run with image defaults — profile them
before raising.

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
| No logs in Loki | Expected with the logs leg disabled (§2.1, PENDING VERIFICATION). When the `observability-logs` overlay is enabled: host path `/var/lib/docker/containers` must be mounted read-only into `otelcol-logs` (real Linux Docker host); entries whose `attrs.tag` does not match `OBS_LOGS_TAG_PATTERN` are dropped by design — each deployment's pattern is derived from its own compose project name (§2.1) |
| No metrics in Prometheus | `http://otelcol:8889/metrics` (network-internal) should list `exam_loop_*` / `db_client_operation_duration_seconds_*`; check the `otelcol-exam-metrics` target at Prometheus `/targets` |
| Grafana 403/locked out | `OBS_GRAFANA_ADMIN_PASSWORD` is required when the profile runs (compose fails fast without it); reset by clearing `data/observability/grafana` (loses dashboards) |

## 8. Signal ownership (single owner per fact, W7.1)

The opt-in stack adds carriers; it does not replace the existing
authorities. Every technical fact has exactly one implementation owner:

| Fact | Single owner | Consumer | Explicitly not duplicated by |
| --- | --- | --- | --- |
| HTTP SERVER span | `@fastify/otel` (`sdkBundle.createFastifyInstrumentation`, registered before every other plugin/route) | Tempo | `HttpInstrumentation` incoming requests are disabled (outbound/client spans only) |
| Technical logs | Pino → stdout; `instrumentation-pino` is correlation-only (`disableLogSending: true`), `OTEL_LOGS_EXPORTER=none` | Docker json-file → collector filelog → Loki; `docker compose logs app` | No application-side OTLP log exporter |
| DB statements / logical transactions | `@exam/otel-drizzle-postgresjs`: one `db.statement` span per submitted statement, one `db.transaction` span per `executeInTransaction`, plus `db.client.operation.duration` | Tempo / Prometheus | Drizzle's built-in tracing is dead code (W2.1 F1); no second driver patch |
| Transaction retries | `transactionRetryLogger` retained (#800 PR-B, process-level warn); the plugin only adds correlated `db.transaction.attempt` spans | stdout grep + traces | Different carriers: the retry warning has no HTTP correlation, the span is not a log-line authority |
| Background loop health | W4 `exam.loop.{cycle.duration,cycle.count,work.count}`; the in-memory `*Metrics`, `/system/diagnostics`, and `operability.*` stdout events remain the stall/alert authority | Prometheus / Admin diagnostics / on-call | Loop metrics do not decide readiness and are not a second stall projection |
| Readiness / alerts | `probeApplicationReadiness` + `operability.*` stdout events | orchestrator / on-call | Collector or backend outage never changes readiness or alert transitions |
| Business facts | `audit_logs`, receipts / attempt version, `client_events` (ADR-025 / ADR-026) | Audit, recovery, proctor surfaces | Traces and spans are diagnostic only |
| Browser | No OTel facade in `apps/web`; client evidence uses the existing `client_events` path | Admin / proctor timeline | No browser → collector connection |
| `CAPACITY_RESEARCH` (#550) | `apps/api/src/lib/capacityResearch.ts`, inert unless `CAPACITY_RESEARCH=1`; `/research/capacity` is registered only then | #550 research harness and frozen evidence docs | Not a duplicate of the DB plugin: it counts statement ARRIVALS (lazy Query creation) and carries event-loop / CPU / pool projections with no OTel equivalent; execution-side timing is explicitly `NOT_DIRECTLY_OBSERVABLE` |

W7.1 also removed the only cross-signal contamination between these
retained mechanisms: telemetry root-pool tagging now runs before the
research wrapper, so its one lazy, never-executed marker query no longer
increments the research arrival counter when both switches are On
(`apps/api/src/plugins/db.ts`; regression
`apps/api/src/plugins/db.capacityResearch.test.ts`). The research fixture
itself is retained — #550 is an independent owner and its snapshot facts
are not reproduced by OTel.
