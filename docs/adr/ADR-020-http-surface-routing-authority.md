# ADR-020 — HTTP Surface Routing & Policy Authority

## Status

ACCEPTED (2026-09-10 — HTTP surface routing authority implemented in `fix/429-api-namespace-boundary` / PR #499)

## Metadata

| Field | Value |
|---|---|
| Date | 2026-09-10 |
| Decision owners | jnhu76 |
| Supersedes | — |
| Superseded by | — |
| Related decisions | #429 (unmatched /api namespace boundary), #500 (HTML shell immutable cache), #464 (PRE-442 Docker black-box findings closure tracker), PR #499 |

## Context

Exam's HTTP server grew several independent ways to answer "which surface
does this request belong to?". Application code repeatedly re-read the raw
request URL and independently decided "this is API", "this is an asset",
"this is SPA navigation", "this is docs", "this skips rate limiting", "this
is a platform API". Each such decision was a second routing authority that
could diverge from the real router:

- CORRECTIVE-1 (PR #499) proved an application parser can normalize **more**
  than Fastify (`/api/../x` collapsed by WHATWG URL, escaping the /api
  boundary).
- CORRECTIVE-2 proved an application parser can normalize **less** than
  Fastify (`/%61pi/x` decoded by the router but not by the raw-byte
  classifier, so unmatched encoded /api requests escaped to the SPA).
- The static frontend additionally decided asset-vs-SPA by pathname
  heuristics (`req.url.startsWith("/assets/")`, `/\.[^/]+$/`).
- The rate limiter exempted the docs UI by splitting `request.url` on `?`.
- The tenant guard kept a pathname registry (`/api/...` regexes and an exact
  public-endpoint list) whose `validateTenantAccess` was a Phase-1 no-op.

The failure mode is not any single bug: it is the duplicated authority. The
router (find-my-way) is the only component with a complete, consistent
model of request identity; every application-side approximation is a second
router with its own bugs.

## Decision

Freeze the following architecture law, and implement it across the whole
HTTP surface:

1. **Fastify owns route identity.** Whether a request is `/api`, `/assets`,
   `/fonts`, the docs surface, or the HTML shell is decided by Fastify
   routing, plugin scope prefixes, and route registration — never by
   application code re-parsing `request.url`.

2. **/api is one encapsulated surface.** All production `/api/**` routes,
   the liveness probe, the rate limiter, and the unmatched-request policy
   live in ONE Fastify scope (`routes/apiSurface.ts`, registered with
   `{ prefix: "/api" }`). There is exactly one /api prefix owner and one API
   404 policy (canonical `RESOURCE_NOT_FOUND` JSON envelope).

3. **Web static/shell policies are surface-owned.** The web surface is three
   router-owned scopes: `/assets/**` (fingerprinted build output, immutable
   long-lived cache), `/fonts/**` (stable-name public resources, must
   revalidate), and the HTML shell + SPA navigation fallback (no-cache). A
   missing file inside a static scope stays in that scope's 404 policy; the
   shell is served only to GET/HEAD navigation; every other unmatched method
   is a plain 404.

4. **Capability state and namespace ownership are separate concerns.** A
   surface does not stop owning its namespace because the feature behind it
   is disabled. Disabling a capability changes the behavior *inside* the
   surface; it does not surrender the namespace to another surface. The docs
   surface (`/_dev/api-reference`) is therefore ALWAYS registered as a
   router-owned scope (I11): when the API reference is enabled, swagger-ui
   serves the UI/spec routes; when it is disabled, every request in the
   namespace answers with the docs-owned 404 — never the web/SPA fallback.

5. **Route metadata drives route-specific policy.** Policy that depends on
   which route or surface a request belongs to (rate limiting, caching,
   docs exemption, tenancy, auth/authz) consumes Fastify encapsulation,
   route options/config, or registered plugin scope — not raw URL text.

6. **Raw URL must not be re-parsed for policy classification.** The legal
   exceptions are logging/telemetry (error reports carry `request.url`),
   CSRF `Referer`/`Origin` parsing (`new URL(referer)` — origin parsing, not
   route identity), URL generation, and tests. Each production use is
   classified; unexplained policy classification of raw URL is a defect.

7. **Generated OpenAPI is a projection.** The machine-readable spec route is
   whatever `@fastify/swagger-ui` actually registers (`/_dev/api-reference/json`).
   Public config projections (`apiReference.specPath`) must equal a real
   registered route; a config field with no router consumer is deleted,
   derived, or bound. The docs path identity has ONE runtime authority
   (`openapi/docsPaths.ts`): the spec path is derived from the UI path at
   projection and is not independently configured (I6).

## Consequences

- The runtime route manifest's `/api` product set is byte-stable across the
  refactor (208 entries, method+path) and pinned by an executable snapshot
  gate (I10).
- `RATE_LIMIT_DISABLED`/rate-limit behavior is unchanged at the wire; the
  docs surface no longer needs an allow-list because it never enters the
  limiter (I7).
- The inert Phase-1 tenant guard (`tenantGuard.ts` path registries and the
  tenant plugin) is deleted; `organizationId` remains the internal data
  boundary from `RequestContext`. ADR-010 §5 documents the guard's
  pre-deletion state as historical evidence.
- Static serving no longer registers one route per built file; the web
  surface is four router-owned wildcard routes. Per-file cache policy is
  replaced by per-surface policy (assets immutable, fonts revalidate, shell
  no-cache — #500).
- The docs namespace is always router-owned (I11): a disabled API reference
  returns the docs-owned 404 for every request under `/_dev/api-reference/**`
  instead of falling into the SPA shell, and an unknown docs child returns
  the same docs 404 when enabled. Capability state never surrenders the
  namespace.
- Guards are low-cost and deterministic: runtime `onRoute` evidence plus
  small targeted source gates (I1–I11 in
  `apps/api/src/routes/httpSurfaceAuthority.test.ts` and the boundary suite
  `apiSurface.test.ts`). I8 points at real repo paths (derived from the test
  file's own URL) and is mutation-proven; I11 is a real-HTTP matrix over the
  production composition. No universal router framework or centralized
  classifier is introduced — the goal is deleting classification, not
  centralizing it.

## Non-goals

- #451 (OPTIONS/CORS corrective) — policy stays out of scope; only
  non-regression is pinned.
- 405/METHOD_NOT_ALLOWED framework — unmatched API stays canonical 404.
- #450 (malformed JSON body handling).
