# Exam Foundation Skills Pack

Four reusable coding-agent skills for TypeScript/PostgreSQL/containerized protocol-heavy applications.

These skills are intentionally not framework cheat sheets.

They separate:

1. PostgreSQL data design
2. PostgreSQL schema/data evolution
3. container build/runtime boundaries
4. application protocol and lifecycle design

## Authority model

Each skill distinguishes three kinds of guidance:

### Standard / product semantics

Behavior defined by PostgreSQL, Docker/Compose/OCI, HTTP, or another named technical source.

These rules are semantic facts about the platform or protocol.

### Engineering guideline

A documented operational practice from a mature engineering source, such as GitLab's database migration guidance or Docker's build guidance.

These are strong engineering references but are not universal language standards.

### Design heuristic

A synthesis rule used by this skill to make architecture review executable.

A design heuristic must not be presented as a PostgreSQL, Docker, HTTP, or TLA+ rule unless the canonical source actually says so.

## Skills

### `postgresql-design-guidelines`

Use when designing or reviewing PostgreSQL schema, constraints, types, indexes, JSONB, repositories, queries, transactions, row locking, idempotent writes, and concurrent update paths.

Core question:

> Does the data model express the invariant, and does the transaction protocol remain correct under concurrency?

### `postgresql-migration-safety`

Use when adding/removing/changing columns, constraints, indexes, tables, data formats, backfills, read/write paths, or migration rollout phases.

Core question:

> Can old data, new data, old code, and new code coexist through the rollout without invalid states, blocking surprises, or an unsequenced compatibility cutover?

### `container-build-runtime-guidelines`

Use for Dockerfiles, Compose, container entrypoints, images, build stages, runtime configuration, secrets, health checks, startup dependencies, migrations, and shutdown.

Core question:

> Are build artifact, runtime process, configuration, dependency readiness, and lifecycle responsibilities separated and testable?

### `protocol-and-lifecycle-review`

Use for stateful application workflows, commands, state machines, submit/save/freeze/finalize flows, deadlines, retries, idempotency, authority, snapshots, grading, jobs, outboxes, and recovery.

Core question:

> What are the states, actions, invariants, authorities, atomic boundaries, retry semantics, and terminal outcomes of this protocol?

## Recommended combinations for `exam`

Schema/repository work:

```text
postgresql-design-guidelines
```

Migration or backfill work:

```text
postgresql-design-guidelines
+
postgresql-migration-safety
```

Docker/Compose deployment work:

```text
container-build-runtime-guidelines
```

Attempt/exam/grading/outbox lifecycle work:

```text
protocol-and-lifecycle-review
+
postgresql-design-guidelines
```

Protocol change that adds or changes persisted state:

```text
protocol-and-lifecycle-review
+
postgresql-design-guidelines
+
postgresql-migration-safety
```

## Mechanical harness

These skills do not replace tools.

Examples:

```text
TypeScript:
    tsc
    typed ESLint

PostgreSQL:
    SQLFluff where adopted
    migration-risk lint such as Squawk where adopted
    migration apply/upgrade tests
    schema assertions
    real PostgreSQL concurrency tests

Containers:
    docker buildx build --check
    image build tests
    runtime smoke tests
    health/readiness tests
    vulnerability/SBOM tooling where adopted

Protocol:
    state transition tests
    structural tests
    transaction race tests
    idempotency tests
    clock/deadline tests
    recovery tests
```

The principle is:

> Mechanically decidable rules belong in the harness. Design semantics belong in review skills and normative project contracts.
