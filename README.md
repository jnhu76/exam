# Exam

Self-hosted exam and assessment platform for controlled testing, grading,
audit, and on-premise deployment.

## What is Exam?

Exam is a LAN/on-premise, single-tenant platform for creating, delivering,
and grading exams. An institution deploys one instance; candidates take
exams on the local network. There are no cloud dependencies, no external
APIs, and no telemetry.

The system supports open-book quizzes and strict proctored exams with
objective auto-grading, manual grading, and result publishing with
inbox notifications.

## Core Features

- **Exam lifecycle** — draft, publish, open, close, archive, cancel
- **Timing modes** — timed window, deadline, untimed
- **Answer save protocol** — versioned, idempotent, conflict-detecting
  answer persistence with client offline fallback
- **Auto-grading** — single choice, multiple choice, true/false, fill
  blank
- **Manual grading** — subjective text responses with rubric-based
  scoring
- **Result publishing** — immediate, after grading, or manual release;
  inbox notifications with optional email delivery
- **Candidate recovery** — disrupted attempt detection via heartbeat,
  self-service restore, admin recovery center
- **Identity lifecycle** — staff invitation, email password reset,
  account activation/deactivation
- **Role-based access** — Admin, Teacher, Candidate, Proctor, Grader,
  Maintainer with scoped permissions
- **Operational controls** — diagnostics, backup evidence ledger,
  restore readiness, structured audit log
- **Email delivery** — in-process outbox loop with retry, lock recovery,
  and optional SMTP
- **Docker deployment** — prebuilt images, single-command startup,
  optional Redis

## Quick Start

### Docker (recommended)

```bash
git clone <repo-url> exam && cd exam
node scripts/generate-env.mjs                      # create .env.deploy, fill secrets
docker compose --env-file .env.deploy up -d        # pull prebuilt image, start app + db
docker compose --env-file .env.deploy ps           # wait for app (healthy), db (healthy)
```

Bootstrap the first Admin (no public self-register):

```bash
docker compose --env-file .env.deploy exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin --password '<STRONG_PASSWORD>' \
  --name 'System Admin' --organization-name 'My Organization'
```

Open `http://localhost:3000` and log in.

### Local development

```bash
pnpm install
pnpm db:up           # start PostgreSQL container (port DB_HOST_PORT, default 5432)
pnpm db:migrate      # run migrations
pnpm db:seed         # seed test users (admin / candidate)
pnpm dev             # API on :3000, Web on :5173
```

See [INSTALL.md](INSTALL.md) for full installation details including
LAN access, Redis, email, and troubleshooting.

## Documentation

The canonical documentation index is
[`docs/README.md`](docs/README.md).

| Document | Purpose |
| --- | --- |
| [INSTALL.md](INSTALL.md) | First installation — zero to running |
| [`docs/deployment/`](docs/deployment/) | Production deployment, topology, runbooks |
| [`docs/operations/`](docs/operations/) | Backup, upgrade, diagnostics, email |
| [`docs/development/`](docs/development/) | Local setup, testing, E2E, commands |
| [`docs/SPEC.md`](docs/SPEC.md) | Product specification — invariants, domain model |
| [`docs/roadmap/current.md`](docs/roadmap/current.md) | Current phase status and next steps |
| [`docs/standards/code-quality.md`](docs/standards/code-quality.md) | Code quality rules, gates, AI coding rules |
| [`docs/standards/testing.md`](docs/standards/testing.md) | Testing and CI contract |
| [`docs/architecture/authorization.md`](docs/architecture/authorization.md) | Capability-based authorization model |
| [`docs/adr/README.md`](docs/adr/README.md) | Architecture Decision Records index |

Historical material (plans, audits, phase history) lives under
[`docs/archive/`](docs/archive/) and is not current implementation
guidance.

## Tech Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 19 + Vite + TypeScript + shadcn/ui + TailwindCSS v4 |
| Backend | Node.js 24.15 + Fastify + TypeScript + Zod validation |
| Database | PostgreSQL 18.4 via Drizzle ORM |
| Cache | Redis 7 (optional, shared rate limiting) |
| Auth | HTTP-only cookie + JWT, argon2 password hashing |
| Monorepo | pnpm 11 + Turborepo 2.9.16 |

## Project Status

| Phase | Status | Summary |
| --- | --- | --- |
| Phase 1 — Minimal Deliverable | Complete | Admin + Candidate reliable exam loop |
| Phase 2 — Exam Operation | Complete (MVP subset) | Lifecycle, recovery, grading, diagnostics |
| Phase 3 — Collaboration / Permissions | In progress | Authorization infra + scoped roles built; remaining product work tracked in [#333](https://github.com/jnhu76/exam/issues/333) |
| P7 — System Readiness | Complete | Hardening, backup/DR, operational control, RBAC remediation |
| Phase 4 — Platformization | Not started | Multi-tenant, API keys, webhooks — deferred |

See [`docs/roadmap/current.md`](docs/roadmap/current.md) for the
detailed phase summary and
[`docs/status/implementation-status.md`](docs/status/implementation-status.md)
for what is implemented now.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to find issues, set up
your environment, and submit pull requests.

AI coding agents must read and follow [AGENTS.md](AGENTS.md) before
making any changes.

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE)
(AGPL-3.0). See `LICENSE` for the authoritative terms.
