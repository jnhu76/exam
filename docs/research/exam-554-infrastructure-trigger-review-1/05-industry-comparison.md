# #554 Industry comparison

**COMPARATIVE ONLY — NOT AUTHORITY.** Sources are current official docs / official repos only
(fetched 2026-09-17). The question is never "do they run Redis/MQ" but "**which responsibility
does each product OWN there?**"

## Method note

docs.moodle.org (user wiki) was unreachable from this environment (CAPTCHA); Moodle evidence
uses Moodle HQ's official developer docs (moodledev.io, built from `moodle/devdocs`) and the
official `moodle/moodle` source. Open edX evidence uses edx-platform sources plus Tutor (the
official reference distribution referenced from docs.openedx.org). Every claim is URL-cited.

| System | Durable truth | Redis OWNS | Job queue | MQ / event bus | Fanout |
| --- | --- | --- | --- | --- | --- |
| Moodle | MariaDB/MySQL/PostgreSQL/MSSQL — all business data; sessions pluggable, DB store supported (`config-dist.php` dbtype + session handlers: database/file/memcached/redis) — <https://github.com/moodle/moodle/blob/main/config-dist.php> | Nothing mandatory — optional MUC cache store only (core stores: apcu/file/redis/session/static) — <https://github.com/moodle/moodle/tree/main/public/cache/stores> , <https://moodledev.io/docs/apis/subsystems/muc> | Cron-driven scheduled + ad hoc tasks, DB-queued, retry/backoff, separate task nodes supported — <https://moodledev.io/docs/apis/subsystems/task> | None in core | None in core |
| Open edX | MySQL (LMS relational) + MongoDB (course content/doc store) — Tutor defaults + `edx-platform/lms/envs/common.py` — <https://github.com/overhangio/tutor/blob/release/tutor/templates/config/defaults.yml> , <https://github.com/openedx/edx-platform/blob/master/lms/envs/common.py> | (1) default Django cache (django_redis, db1); (2) Celery broker (db0); (3) celery results backend. NOT sessions (Django sessions default to DB) — <https://github.com/overhangio/tutor/blob/release/tutor/templates/apps/openedx/settings/partials/common_all.py> , …/config/lms.env.yml | Celery workers + beat, dedicated jobs service — <https://github.com/openedx/edx-platform/blob/master/lms/envs/common.py> (CELERY_QUEUES/ROUTES/BEAT) , <https://github.com/overhangio/tutor/tree/release/tutor/templates/jobs/init> | Kafka event bus for domain events (openedx/event-bus-kafka) — <https://github.com/openedx/event-bus-kafka> | None in core LMS UI docs |
| Canvas LMS | PostgreSQL (business data AND job tables, inst-jobs) — <https://github.com/instructure/canvas-lms/wiki/Production-Start> | Cache store + some features (OAuth2); optional session/cache store (`redis.yml.example`: "works without Redis; some features disabled") — <https://github.com/instructure/canvas-lms/blob/master/config/redis.yml.example> | inst-jobs (delayed_job lineage) with Postgres-backed `canvas_queue`, dedicated job hosts — <https://github.com/instructure/canvas-lms/blob/master/config/delayed_jobs.yml.example> , …/doc/canvas_operations_library.md | None internal; outbound analytics feed to AWS Kinesis (live_events) — <https://github.com/instructure/canvas-lms/blob/master/doc/live_events.md> | None in core |
| Sakai | MySQL/MariaDB or Oracle — <https://github.com/sakaiproject/sakai/blob/master/config/configuration/bundles/src/bundle/org/sakaiproject/config/bundle/default.sakai.properties> | Nothing — in-JVM Ehcache; no memcached/redis in repo | Quartz, DB-backed (`jobscheduler`, quartz2.sql) — <https://github.com/sakaiproject/sakai/tree/master/jobscheduler> | None | None |
| SEB Server (exam/proctoring ecosystem) | MariaDB — <https://github.com/SafeExamBrowser/seb-server> | Nothing documented | Spring in-process | None | None |

## What the comparison actually shows

1. **Redis ownership is always responsibility-scoped, never "general backend".** Moodle/Canvas:
   optional cache (and Canvas: some features, optional sessions). Open edX: cache + Celery
   broker — a role EXAM's rate-limit counters already mirror (bounded, ephemeral, accelerative).
   Sakai/SEB Server: no Redis at all. No system makes Redis a durable authority for assessment
   state.
2. **Job queues are DB-queued in most systems** (Moodle ad-hoc tasks, Canvas inst-jobs, Sakai
   Quartz) — i.e., the industry's default durable-work substrate is the SAME mechanism class as
   Exam's PG outbox (ADR-011), not a broker. The broker path (Open edX Celery) exists at
   multi-tenant SaaS scale with dedicated worker fleets — a scale profile far beyond a
   single-institution LAN deployment.
3. **Event buses appear only where an external integration exists** (Open edX Kafka for domain
   events; Canvas Kinesis for outbound analytics). Single-monolith systems (Sakai, SEB Server,
   Moodle core) have none — matching Exam's current absence of downstream consumers.
4. **Scale context:** these platforms target campus-to-national (Moodle: >530M registered
   accounts across 12,918 sites, stats.moodle.org) to global SaaS scale (Open edX ~140M
   learners; Canvas multi-tenant). Exam's supported envelope (single institution, ≤200
   concurrent candidates, one LAN) sits at the conservative end of Sakai/SEB-Server-like
   deployments. Infrastructure presence at their scale is not evidence for Exam's scale.
5. **Fanout:** none of the five documents core WebSocket fanout as essential; assessment state
   remains DB-authoritative everywhere.

Per the gate's rule: this table informs the pattern (responsibility-scoped infrastructure, PG /
RDBMS as the default durable-work substrate), and is explicitly NOT accepted as authority for
any `ADOPT_*` decision. Every Exam-side disposition in 06 rests on the measured evidence of
01–04; the comparison is consistent with, but does not by itself prove, those dispositions.
