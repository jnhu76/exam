# Docker Black-Box Discovery Campaign

Related: #442, #464

## Purpose

Run this campaign periodically (for example before a major release, after a large API/deployment refactor, or every few months) to rediscover runtime defects that deterministic regression tests may not yet encode.

This is an **exploratory black-box campaign**, not the permanent regression oracle itself.

The campaign treats the final Docker deployment artifact as an external HTTP service. Static inspection may be used later for diagnosis, but it is not closure evidence for runtime behavior.

## Core principle

Separate these two layers:

1. **Stable regression oracle** — deterministic checks that run routinely once an invariant is proven durable.
2. **Exploratory discovery campaign** — broader probing used periodically to find new anomalies and decide which observations deserve to become durable invariants.

Do not automatically convert every anomaly into a bug. The campaign must distinguish product defects from tool/setup problems, expected protocol behavior, fixture/state limitations, and incorrect oracle assumptions.

## Safety constraints

MUST:

- run only against the disposable Docker E2E/test topology;
- build the real app Docker image used by the canonical deployment/E2E path;
- verify the target container is healthy before probing;
- use real HTTP requests over the container's exposed service boundary;
- preserve reproducible request/response evidence for findings;
- redact authentication cookies/tokens from logs;
- clean test state after the campaign;
- keep production/shared staging systems out of scope.

MUST NOT:

- use Fastify `inject` or direct route-handler calls as black-box evidence;
- weaken schemas or product contracts just to make probes green;
- implement missing endpoints merely because a guessed URL returned an error;
- treat every 401/403/404 as a bug;
- fix production code before the finding is classified and independently reproduced;
- create one issue per failing URL before root-cause grouping/deduplication.

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

If the worktree is dirty in relevant tracked files, stop or use an isolated clean worktree. Do not silently test an unknown source state.

## Stage 1 — Existing baseline

Run the repository's existing canonical verification and Docker E2E before exploratory probing.

At minimum:

```bash
pnpm verify
```

Build the real image without relying on an old cache for the authoritative campaign run:

```bash
docker compose -f docker-compose.test.yml build --no-cache app
```

Then run the existing Docker E2E against that image using the repository's canonical runner.

Record PASS/FAIL separately for:

```text
static/typecheck/unit/integration/coverage/build
Docker build
Docker Playwright E2E
```

If an existing known unrelated blocker prevents `pnpm verify`, record the linked issue and continue only when the Docker campaign can still be executed independently and honestly.

## Stage 2 — Start the black-box target

Start a unique disposable compose project containing the canonical app/database/runtime dependencies.

Use the same Docker image/topology as the normal Docker E2E path. Do not invent a second deployment assembly.

Wait for container health rather than assuming `docker compose up` means readiness.

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

## Stage 3 — Inventory the current API surface

Regenerate/check the repository OpenAPI authority using the existing command:

```bash
pnpm --filter @exam/api api:openapi:check
```

Use `apps/api/openapi.json` as an **API census**, not as proof that runtime behavior is correct.

Count current method+path operations and compare with the previous campaign if available.

Pay special attention to:

- newly added operations;
- removed operations;
- newly introduced API namespaces;
- changed request/response schemas;
- changed authentication/role metadata.

Do not assume old campaign probes are sufficient when the API surface materially changed.

## Stage 4 — Run the stable oracle first

Execute all already-promoted deterministic black-box invariants.

Expected durable invariant families include examples such as:

```text
/api namespace never falls into SPA HTML
unknown API requests use the canonical API error boundary
API errors do not inherit immutable static-asset caching
canonical API errors contain a non-empty requestId
malformed client JSON does not become an unexpected 5xx
protected representative APIs return canonical unauthenticated errors
```

These stable checks should eventually live in the normal automated Docker contract command. This campaign must not duplicate their implementation unnecessarily; invoke the canonical stable-oracle command when it exists.

Any stable-oracle regression is immediately actionable, but still preserve reproduction evidence before editing code.

## Stage 5 — Exploratory namespace / routing probes

Probe API/SPA/static boundaries as an external client.

Include representative cases for:

```text
/api
/api/
unknown extensionless /api paths
unknown dotted /api paths
query strings that resemble static suffixes
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

Do not infer correctness only from HTTP status. A `200 text/html` response under `/api/**` may be a severe routing-boundary defect even though the request technically succeeded.

## Stage 6 — Authentication / authorization probes

Use the canonical E2E seed and perform authentication through real HTTP.

Do not mint JWTs directly in process.

Probe representative cases for:

- anonymous access to protected APIs;
- authenticated Admin reads;
- Candidate access where existing seed/helpers provide meaningful resource ownership;
- cross-resource or anti-enumeration behavior where an established product contract exists.

Prefer real IDs returned by earlier API responses over random UUIDs when testing positive/resource-aware behavior.

A random-ID 404 does not prove a positive authorized flow.

## Stage 7 — Malformed-input / protocol probes

Select representative endpoints across major API families and test malformed inputs such as:

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

Classify responses by wire behavior:

```text
canonical expected 4xx
unexpected 5xx
HTML escape
plain-text escape
schema/media mismatch
```

Do not globally assume `OPTIONS` behavior is a bug. Separate generic OPTIONS from valid/invalid CORS preflight requests and evaluate them against the repository's actual CORS contract.

## Stage 8 — Schema-derived dynamic testing

When #442 has a trusted Schemathesis profile, run a bounded exploratory pass against the real Docker HTTP service.

Use the checked-in OpenAPI spec as input and the real Docker base URL as target.

Before running, verify the exact current CLI/config syntax from official Schemathesis documentation and record the pinned/executed version.

Start with a bounded budget appropriate for discovery. Larger fuzz/stateful campaigns belong in release/nightly or explicitly authorized deep runs, not in every PR.

Record at least:

```text
operations attempted
generated cases
unexpected 5xx
undocumented statuses
response schema/media mismatches
reproduction command/request
```

Schemathesis findings are candidates, not automatic bugs. Authentication/state-precondition limitations must be classified explicitly.

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

For any proposed product bug:

1. reproduce independently of the original fuzz/random run;
2. capture the smallest useful HTTP request/response witness;
3. determine the likely ownership boundary;
4. check whether another observation is the same root-cause family.

## Stage 10 — Root-cause grouping and issue dedupe

Do not map one failed probe to one issue.

Before ticket creation:

1. group findings by likely authority/root-cause family;
2. search existing open and recent closed issues;
3. update/extend an existing issue when the new evidence belongs to the same corrective authority;
4. create a new issue only for materially independent behavior.

Historical example from the PRE-442 baseline:

```text
unknown /api path -> SPA HTML
wrong method -> SPA HTML
nonexistent /api child path -> SPA HTML
unknown dotted /api path -> plain-text static 404
```

These looked like multiple findings but belonged to one `/api` namespace routing authority and were merged into #429.

## Stage 11 — Produce candidate tickets, do not auto-fix by default

The default discovery-campaign output is a **candidate ticket plan**, not code changes.

For each actionable root-cause family, provide:

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

At the current project maturity level, a human should approve the ticket set before autonomous corrective work begins.

Future automation may enable `to-ticket -> agent fix -> PR`, but only after the triage/dedupe behavior has demonstrated low false-positive and duplicate rates.

## Stage 12 — Promote durable discoveries into the stable oracle

For each confirmed bug, ask:

> Is there a compact, stable invariant that should remain true even if the implementation changes?

If yes, promote it into the deterministic regression oracle.

Good oracle rules describe externally observable contracts, for example:

```text
/api/** must never be served by SPA fallback
malformed JSON must not produce INTERNAL_ERROR 500
API errors must include requestId
```

Avoid oracle rules that encode incidental implementation details or temporary route inventories unless those inventories are an explicit product contract.

## Stage 13 — Final report

Produce both human-readable and, once supported by #442, machine-readable results.

Minimum human report:

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
FINAL VERDICT
```

Recommended verdicts:

```text
DISCOVERY_CLEAN
DISCOVERY_FINDINGS
HARNESS_BLOCKED
ORACLE_REVIEW_REQUIRED
```

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
