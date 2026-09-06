# Docker Black-Box Discovery Campaign

Related: #442, #464, #476

## Document role and authority

This file is a **testing runbook**, not a second agent-instruction authority.

- `AGENTS.md` remains the repository's single semantic authority for agent behavior.
- `docs/standards/testing.md` owns the repository-wide test, environment, and lifecycle contract.
- `scripts/e2e/run.sh` owns the canonical Docker E2E orchestration behavior.
- `docker-compose.test.yml` owns the canonical disposable Docker E2E topology.
- This runbook describes **what a periodic black-box discovery campaign should exercise and report**.

If this runbook conflicts with any authority above, stop and reconcile the conflict before running the campaign. Do not copy a competing lifecycle into this file.

## Purpose

Run this campaign periodically—for example before a meaningful release, after a large API/deployment refactor, or every few months—to rediscover runtime defects that deterministic regression tests may not yet encode.

This is an **exploratory black-box campaign**, not the permanent regression oracle itself.

The campaign treats the final Docker artifact as an external HTTP service. Static inspection may be used later for diagnosis, but it is not closure evidence for wire behavior.

## Core principle

Keep two layers separate:

1. **Stable regression oracle** — compact deterministic checks promoted from confirmed bugs and run routinely.
2. **Exploratory discovery campaign** — broader periodic probing used to find anomalies and decide which observations deserve durable invariants.

Do not automatically convert every anomaly into a bug. Distinguish product defects from tool/setup problems, expected protocol behavior, fixture/state limitations, and incorrect oracle assumptions.

## Docker lifecycle authority

The campaign **MUST reuse or extract the lifecycle semantics already implemented by `scripts/e2e/run.sh`**. It MUST NOT hand-roll a second weaker Compose lifecycle merely because the campaign needs the stack to remain alive for HTTP probes.

The following existing semantics are mandatory:

- a unique `COMPOSE_PROJECT_NAME` for isolated disposable runs;
- canonical `docker-compose.test.yml` topology and app image;
- host-port ownership protection before startup so probes cannot silently hit a stale/non-campaign service;
- health-based readiness, not `docker compose up` exit status;
- cleanup on normal exit and interruption (`EXIT` / `INT` / `TERM` equivalent discipline);
- volume removal and orphan cleanup equivalent to `down -v --remove-orphans`;
- cleanup failure remains visible and must never be swallowed into exit code 0;
- a prior test/probe failure remains the primary failure when cleanup also fails;
- production, staging, and shared developer databases are never campaign targets.

If the campaign cannot use `scripts/e2e/run.sh` directly because it needs a long-lived target, **extract/reuse the runner lifecycle helpers first**. Do not duplicate port checks, readiness loops, trap handling, or cleanup-exit semantics in an ad-hoc campaign script.

## Safety constraints

MUST:

- run only against the disposable Docker E2E/test topology;
- build the real app Docker image used by the canonical Docker E2E path;
- verify target health before probing;
- use real HTTP over the exposed service boundary;
- preserve reproducible request/response evidence for findings;
- redact authentication cookies/tokens from logs;
- preserve the canonical Docker cleanup discipline;
- keep production/shared staging systems out of scope.

MUST NOT:

- use Fastify `inject` or direct route-handler calls as black-box closure evidence;
- weaken schemas or product contracts just to make probes green;
- implement missing endpoints merely because a guessed URL returned an error;
- treat every 401/403/404 as a bug;
- fix production code before a finding is classified and independently reproduced;
- create one issue per failed URL before root-cause grouping/deduplication;
- invent a parallel Compose/test-database lifecycle when the canonical runner already owns it.

## Stage 0 — Freeze reality

Record:

```bash
git rev-parse HEAD
git status --short
node --version
pnpm --version
docker --version
docker compose version
```

Record:

```text
BASE_SHA=
WORKTREE=
NODE_VERSION=
PNPM_VERSION=
DOCKER_VERSION=
COMPOSE_VERSION=
```

If relevant tracked files are dirty, stop or use an isolated clean worktree. Do not silently test an unknown source state.

## Stage 1 — Existing baseline

Run the repository's canonical verification and Docker E2E before exploratory probing.

At minimum:

```bash
pnpm verify
```

For the authoritative Docker campaign build, use the canonical runner's no-cache rebuild path rather than a separate build recipe:

```bash
bash scripts/e2e/run.sh --rebuild
```

If the campaign needs to retain the stack for subsequent probes, use/reuse the runner's supported keep/lifecycle seams rather than replacing its orchestration.

Record PASS/FAIL separately for:

```text
static/typecheck/unit/integration/coverage/build
Docker build
Docker Playwright E2E
```

If a known unrelated blocker prevents `pnpm verify`, record the linked issue and continue only if the Docker campaign can still execute independently and honestly.

## Stage 2 — Start and retain the black-box target

Start a unique disposable Compose project using the **canonical Docker E2E lifecycle**.

Required ownership:

```text
topology                  docker-compose.test.yml
orchestration semantics   scripts/e2e/run.sh (reuse/extract)
project isolation          COMPOSE_PROJECT_NAME
port safety                existing runner protection
readiness                  app container health
cleanup                    existing runner trap/down semantics
```

The campaign may add a narrow reusable helper only when necessary to keep the already-built stack alive between Playwright and black-box probes. Such a helper must preserve the runner's behavior; it must not become a second lifecycle authority.

Prove the target through real HTTP:

```text
GET /api/health
```

Capture:

```text
container id/name
image id
target base URL
health response
compose ps
```

On any startup/readiness failure, capture app/compose diagnostics before cleanup.

## Stage 3 — Inventory the current API surface

Check the repository OpenAPI authority using the existing command:

```bash
pnpm --filter @exam/api api:openapi:check
```

Use `apps/api/openapi.json` as an **API census**, not as proof that runtime behavior is correct.

Count method+path operations and compare with the previous campaign when available. Pay attention to:

- added/removed operations;
- new API namespaces;
- request/response schema changes;
- authentication/authorization metadata changes.

Do not assume old probes remain sufficient after a material API-surface change.

## Stage 4 — Run the stable oracle first

Execute all already-promoted deterministic black-box invariants.

Typical durable invariant families include:

```text
/api namespace never falls into SPA HTML
unknown API requests use the canonical API error boundary
API errors do not inherit immutable static-asset caching
canonical API errors contain a non-empty requestId
malformed client JSON does not become an unexpected 5xx
representative protected APIs return canonical unauthenticated errors
```

Invoke the canonical stable-oracle command when it exists; do not duplicate its implementation in this campaign.

A stable-oracle regression is actionable, but preserve a reproduction witness before editing code.

## Stage 5 — Exploratory namespace / routing probes

Probe API/SPA/static boundaries as an external client.

Representative cases:

```text
/api
/api/
unknown extensionless /api paths
unknown dotted /api paths
query strings resembling static suffixes
unsupported methods on known API paths
non-/api prefixes such as /apix and /api-docs
SPA deep links
missing static assets
```

Record for every probe:

```text
method
path
status
content-type
cache-control
selected headers
body class (JSON / HTML / text / empty)
canonical error code/requestId where applicable
```

Do not infer correctness only from status. A `200 text/html` under `/api/**` may be a severe namespace defect.

## Stage 6 — Authentication / authorization probes

Use the canonical E2E seed and authenticate through real HTTP. Do not mint JWTs directly in-process.

Probe representative cases for:

- anonymous access to protected APIs;
- authenticated Admin reads;
- Candidate access where canonical fixtures provide meaningful resource ownership;
- cross-resource or anti-enumeration behavior where a product contract exists.

Prefer real IDs returned by earlier API responses over random UUIDs for positive/resource-aware behavior. A random-ID 404 does not prove an authorized positive flow.

## Stage 7 — Malformed-input / protocol probes

Across representative API families, test malformed inputs such as:

```text
syntactically invalid JSON
missing required fields
wrong scalar/container types
invalid UUIDs
unknown enum values
invalid query parameters
incorrect content-type
unsupported HTTP methods
```

Classify wire behavior as:

```text
canonical expected 4xx
unexpected 5xx
HTML escape
plain-text escape
schema/media mismatch
```

Do not globally assume `OPTIONS` behavior is a bug. Separate generic OPTIONS from valid/invalid CORS preflight and evaluate against the actual CORS contract.

## Stage 8 — Schema-derived dynamic testing

When #442 has a trusted Schemathesis profile, run a bounded exploratory pass against the real Docker HTTP service.

Use the checked-in OpenAPI spec as input and the Docker base URL as target. Verify exact current CLI/config syntax from official Schemathesis documentation and record the pinned/executed version.

Start with a bounded discovery budget. Larger fuzz/stateful campaigns belong in release/nightly or explicitly authorized deep runs, not every PR.

Record at least:

```text
operations attempted
generated cases
unexpected 5xx
undocumented statuses
response schema/media mismatches
reproduction command/request
```

Schemathesis findings are candidates, not automatic bugs. Authentication and state-precondition limitations must be classified explicitly.

## Stage 9 — Classify every anomaly

Assign exactly one primary class before proposing production changes:

```text
TOOL_SETUP
SPEC_DRIFT
AUTH_FIXTURE
STATE_PRECONDITION
EXPECTED_PROTOCOL
EXPECTED_4XX
CONTRACT_VIOLATION
UNEXPECTED_5XX
ROUTING_NAMESPACE
DEPLOYMENT
ORACLE_ASSUMPTION
```

For a proposed product bug:

1. reproduce independently of the original fuzz/random run;
2. capture the smallest useful HTTP request/response witness;
3. identify the likely ownership boundary;
4. check whether another observation is the same root-cause family.

## Stage 10 — Root-cause grouping and issue dedupe

Do not map one failed probe to one issue.

Before ticket creation:

1. group findings by likely authority/root-cause family;
2. search existing open and recent closed issues;
3. extend an existing issue when the evidence belongs to the same corrective authority;
4. create a new issue only for materially independent behavior.

Historical PRE-442 example:

```text
unknown /api path -> SPA HTML
wrong method -> SPA HTML
nonexistent /api child path -> SPA HTML
unknown dotted /api path -> plain-text static 404
```

These appeared as multiple observations but belonged to one `/api` namespace routing authority and were grouped into #429.

## Stage 11 — Produce candidate tickets, do not auto-fix by default

The default campaign output is a **candidate ticket plan**, not production changes.

For each actionable root-cause family provide:

```text
finding ids
severity
runtime evidence
expected contract
affected surface
minimal reproduction
existing issue or proposed new issue
why findings are grouped together
confidence / unresolved questions
```

At the current project maturity level, human approval of the ticket set precedes autonomous corrective work.

Future `to-ticket -> agent fix -> PR` automation is allowed only after triage/dedupe demonstrates acceptably low false-positive and duplicate rates.

## Stage 12 — Promote durable discoveries into the stable oracle

For every confirmed bug ask:

> Is there a compact externally observable invariant that should remain true even if the implementation changes?

If yes, promote it into the deterministic regression oracle.

Good examples:

```text
/api/** must never be served by SPA fallback
malformed JSON must not produce INTERNAL_ERROR 500
API errors must include requestId
```

Avoid encoding incidental implementation details or temporary route inventories unless they are explicit product contracts.

## Stage 13 — Final report

Produce a human-readable report and, once #442 supports it, machine-readable results.

Minimum report:

```text
DOCKER BLACK-BOX DISCOVERY

BASE / HEAD / image
existing verification status
Docker E2E status
OpenAPI operation count
stable-oracle result
exploratory HTTP request count
JSON / HTML / text response counts
unexpected 5xx count
contract/schema/media findings
routing findings
auth/state limitations
finding -> root-cause family map
existing issue links
proposed tickets
new durable invariants to promote
oracle assumptions disproved/changed
cleanup result
FINAL VERDICT
```

Recommended verdicts:

```text
DISCOVERY_CLEAN
DISCOVERY_FINDINGS
HARNESS_BLOCKED
ORACLE_REVIEW_REQUIRED
```

A report is not complete until canonical cleanup has run and its result is recorded.

## Scheduling guidance

This full exploratory campaign is intentionally **not** required for every commit.

Run it when one or more apply:

- before a major/minor release with meaningful API/runtime change;
- after substantial routing/auth/deployment refactors;
- after introducing a new API family or transport boundary;
- every few months as an adversarial rediscovery exercise;
- when existing E2E/contract coverage is suspected of missing an entire behavior class.

The stable regression oracle derived from past campaigns should run much more frequently.

## Long-term automation model

Target architecture:

```text
deterministic Docker oracle
        -> structured evidence
        -> LLM triage / root-cause grouping / dedupe
        -> existing issue update or new ticket
        -> approved coding agent
        -> focused PR
        -> deterministic CI + Docker oracle
        -> human review/merge
```

Keep deterministic detection and verification outside the LLM. Use the LLM only where classification, evidence synthesis, root-cause grouping, and ticket drafting materially outperform hard-coded rules.
