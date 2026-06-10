# ADR: Redis / Message Queue for Phase 2

**Status**: Accepted
**Date**: 2026-06-10
**Job**: P1.4-A05 Redis / MQ ADR

## Context

Phase 1 runs entirely on SQLite/PostgreSQL with no external infrastructure. Phase 2 introduces requirements that exceed what a single relational database can provide efficiently:

- **Real-time exam state**: candidate heartbeat, seat status, proctor dashboard live view
- **Offline recovery**: candidate reconnects must restore answers + remaining time within seconds
- **Event-driven workflows**: PDF report generation, audit log fan-out, cross-system notifications
- **Pass-to-proceed API**: external systems (access control, training gates) need near-real-time exam result queries

### Current Limitations

| Feature | Phase 1 Approach | Phase 2 Need |
|---------|-----------------|--------------|
| Heartbeat | DB `lastActivityAt` column, polled every 30s | 10,000+ concurrent candidates → DB write storm |
| Seat status | Re-query `ExamAttempt` on each page load | Proctor dashboard needs sub-second updates |
| PDF report | Synchronous generation on submit | Must not block submit response |
| Audit fan-out | Single table append | External SIEM/log consumers need async delivery |
| Result query | API reads DB directly | External systems need push or poll with caching |

## Decision

**Adopt Redis for caching/session and a lightweight in-process task queue for async jobs. No external MQ broker in Phase 2.**

### Component Breakdown

#### 1. Redis — Session Cache + Real-time State

| Data | Key Pattern | TTL | Purpose |
|------|------------|-----|---------|
| Exam session | `exam:{attemptId}:session` | exam duration | Candidate reconnect recovery (answers + time) |
| Heartbeat | `exam:{attemptId}:heartbeat` | 60s | Last-seen timestamp, avoids DB write storm |
| Seat status | `org:{orgId}:seats` | 30s | Proctor dashboard live view |
| Result cache | `result:{attemptId}` | 5min | Pass-to-proceed API fast read |

**Why Redis and not in-memory Map?**
- Survives API server restarts (exam in progress must not be lost)
- Shared across multiple API instances (future horizontal scaling)
- Native TTL for automatic cleanup
- `EXPIRE` + `GET` is simpler than maintaining in-memory expiry logic

#### 2. In-Process Task Queue — Async Jobs

No external MQ (RabbitMQ, Kafka, etc.) in Phase 2. Use a lightweight in-process queue with Redis as durable backing:

```text
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ API Handler  │────▶│ Task Queue   │────▶│ Worker      │
│ (Fastify)    │     │ (BullMQ or   │     │ (same proc) │
│              │     │  custom)     │     │             │
└─────────────┘     └──────────────┘     └─────────────┘
```

| Job Type | Trigger | Processing | Why In-Process |
|----------|---------|------------|----------------|
| PDF generation | `submitAttempt` | Background, notify on complete | Low volume, < 1min |
| Audit log fan-out | Any state change | Async append | Can tolerate seconds of delay |
| Result notification | `gradeAttempt` | Push to external system | External system polls anyway |
| Seed/demo data | Admin action | Synchronous is fine | One-shot, not production |

**Why not Kafka/RabbitMQ?**
- LAN deployment constraint: no external infrastructure beyond Redis
- Job volume is low (exam submissions, not IoT telemetry)
- In-process queue + Redis is sufficient for 10K concurrent candidates
- Eliminates another deployment dependency

### Data Classification

| Data Type | Storage | Why |
|-----------|---------|-----|
| Exam answers | **PostgreSQL only** | Durability, ACID, source of truth |
| Heartbeat | **Redis only** | Ephemeral, high-write, TTL-based |
| Session recovery | **Redis + DB** | Redis for speed, DB for durability |
| PDF reports | **Filesystem** | Generated async, served on demand |
| Audit logs | **PostgreSQL** | Compliance, queryable |
| Seat status | **Redis only** | Derived from heartbeat, ephemeral |
| Exam results | **PostgreSQL** | Source of truth |
| Result cache | **Redis** | Fast read for external API |

### Critical Rule: Answers Never Go Through MQ

Exam answers are saved via the Answer Save Protocol directly to PostgreSQL. This is a hard invariant:

- Client → API → DB (synchronous save)
- No queue, no buffer, no "eventually consistent"
- Redis session cache is a **backup** for recovery, not the primary store
- If Redis is down, answers still save to DB; recovery falls back to DB query

## Implementation Order

| Phase | Component | Effort |
|-------|-----------|--------|
| Phase 2.1 | Redis session cache + heartbeat offload | 2 days |
| Phase 2.2 | In-process task queue for PDF generation | 1 day |
| Phase 2.3 | Audit log fan-out via task queue | 0.5 day |
| Phase 2.4 | Result cache for pass-to-proceed API | 0.5 day |

### Redis Introduction Checklist

- [ ] Add `redis` (ioredis) to `packages/api/package.json`
- [ ] Create `apps/api/src/plugins/redis.ts` Fastify plugin
- [ ] Add `REDIS_URL` to `.env.example` (optional, fallback to in-memory Map)
- [ ] Redis connection health check in `/health` endpoint
- [ ] Graceful degradation: if Redis unavailable, fallback to DB polling

## Consequences

### Positive

- Eliminates DB write storm from 10K candidate heartbeats
- Proctor dashboard gets sub-second live updates
- PDF generation no longer blocks submit response
- External systems get fast result queries via Redis cache
- Single additional dependency (Redis) beyond PostgreSQL

### Negative

- Another infrastructure component to deploy and monitor
- Redis data is ephemeral — loss means recovery falls back to slower DB path
- In-process queue loses jobs on crash (mitigated by Redis durable backing)

### Neutral

- Redis is optional in dev mode — fallback to in-memory Map for local development
- Existing Answer Save Protocol is unchanged — Redis is additive, not replacement
- PostgreSQL remains the single source of truth for all exam data

## Alternatives Considered

| Alternative | Rejected Because |
|-------------|-----------------|
| Kafka | Overkill for LAN deployment, operational complexity |
| RabbitMQ | Another service to deploy, similar to Redis but less caching utility |
| In-memory Map only | Lost on server restart, not shared across instances |
| PostgreSQL LISTEN/NOTIFY | Adds DB coupling, not suitable for ephemeral session data |
| SQLite WAL mode | Doesn't solve write contention at 10K scale |

## Related

- `docs/SPEC.md` — §3.5 Answer Save Protocol
- `docs/phase1.4/02-architecture-jobs.md` — A05 job card
- `docs/phase1.4/adr-db-dual-dialect.md` — DB layer decision
