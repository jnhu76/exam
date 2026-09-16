# #546 Topology freeze and design

## Supported-topology freeze

| Topology | Fastify `request.ip` | Trusted input | Spoofed forwarding headers | Verdict |
| --- | --- | --- | --- | --- |
| `DIRECT_LAN` (default compose, `EXAM_PORT` direct) | candidate's real socket IP | kernel socket peer only | ignored (`trustProxy` off) | **SUPPORTED** — unchanged from today |
| `SHARED_NAT` | one shared egress IP | kernel socket peer only | ignored | **SUPPORTED WITH DOCUMENTED POLICY** — all candidates legitimately share one limiter identity; operator must size `RATE_LIMIT_MAX` by the documented rule, and >10 logins/min requires either a trusted-proxy front or staggered start |
| `REVERSE_PROXY_WITH_TRUSTED_CLIENT_IP` | per-client IP (XFF entry selected by the trusted-hop walk) | socket peers matching `TRUSTED_PROXY_CIDRS`, plus the XFF entries they append | client-injected XFF entries sit left of the genuine client entry and are never selected (pinned by tests) | **SUPPORTED** — new explicit opt-in (`TRUSTED_PROXY_CIDRS`) |
| `REVERSE_PROXY_WITHOUT_TRUSTED_CLIENT_IP` | proxy socket IP | kernel socket peer only | ignored | **DEGRADED BY CONFIG** — same collapse as `SHARED_NAT`; runbook prescribes wiring `TRUSTED_PROXY_CIDRS` (and the proxy XFF contract) |

Trusted-IP authority stays **singular**: Fastify derives `request.ip` once
(`proxy-addr`), and both consumers — the limiter key and the audit trail
`ip_address` — read that one value. No parallel IP derivation is introduced.

## Trust model (bounded)

- New setting `TRUSTED_PROXY_CIDRS` (comma-separated CIDRs, default **empty**).
  Empty ⇒ `trustProxy: false` ⇒ behavior byte-identical to today (XFF fully
  ignored). Nothing changes for existing deployments unless they opt in.
- Non-empty ⇒ `Fastify({ trustProxy: <cidr array> })`. `proxy-addr` walks the
  hop chain right-to-left: every address matching a configured CIDR is a
  trusted proxy and is skipped; the **first untrusted address from the right
  is the client IP**; if the chain is exhausted the socket peer is used.
- Spoof analysis: a candidate cannot place an address to the right of the
  genuine client entry, because the genuine client address is appended (or
  overwritten) by the front proxy itself. Entries the client injects are
  always left of it and skipped by the walk. **Proxy XFF contract (documented,
  required)**: the front proxy must append (`$proxy_add_x_forwarded_for`) or
  overwrite (`$remote_addr`) `X-Forwarded-For` — a misconfigured pass-through
  proxy would defeat the model and is called out as unsupported in the
  runbook.
- Socket not matching any CIDR ⇒ headers ignored for that connection
  (DIRECT_LAN hardening is unaffected even when CIDRs are configured).
- Malformed CIDR entries fail fast at config load with the offending entry
  named (validated via `node:net` `BlockList` parsing; matching semantics
  belong to Fastify's `proxy-addr` alone).
- While a socket is trusted, Fastify may also honor `X-Forwarded-Proto` /
  `X-Forwarded-Host` for that request — untrusted (direct) connections are
  unaffected. No production consumer reads `request.protocol`/`request.hostname`
  for authorization decisions (verified in the audit).

## Options considered

- **A — KEEP_CURRENT + docs-only** ("proxies unsupported"): contradicts the
  deployment runbook's own TLS-reverse-proxy guidance; HTTPS deployments would
  be pushed outside the supported surface. REJECTED.
- **B — bounded trusted-proxy CIDR model (CHOSEN)**: one env var, default-off,
  changes one Fastify constructor option; limiter and audit follow the single
  `request.ip` authority; spoof model pinned by executable tests. Smallest
  change that makes the documented HTTPS topology safe.
- **C — identity-based limiter keys** (session/token where available): larger
  redesign of the limiter contract; the abuse-critical paths (login, password
  reset) are unauthenticated so identity is unavailable exactly where the
  budget matters most. REJECTED for this issue.
- **D — raise `RATE_LIMIT_MAX`** until tests pass: forbidden by non-goals.
- **E — disable limiting**: forbidden by non-goals.

## Operator sizing rule (documented in the runbook)

Measured steady load ≈ 6.6 requests/candidate/min (production-reality audit,
§1). Safe global budget:

```text
RATE_LIMIT_MAX ≥ candidates × 7 × 2   (headroom ×2)
RATE_LIMIT_WINDOW_MS = 60000
```

Login burst: the hardcoded 10 login/min/IP budget covers a full cohort
staggering in over a minute per IP. A deployment where >10 logins/min arrive
from one address (shared NAT, or an untrusted proxy) must either front the API
with a trusted reverse proxy (per-client identity restored) or stagger exam
start; raising the global max does not lift the login budget.

## Residual unknowns

1. Multi-level proxy chains (CDN in front of nginx) are supported by the same
   walk as long as every intermediate hop's CIDR is configured; untested here
   (no such topology in the deployment surface) — operator docs state the rule.
2. The proxy XFF contract (append/overwrite) is enforced by documentation, not
   by the API process; a pass-through proxy is operator error the runbook
   explicitly names. Detection from inside the API is not possible without a
   proxy-protocol dependency (out of scope).
