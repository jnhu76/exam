# #550 Final capacity re-proof — 07 Rate-limit / deployment topologies (#546)

Status: FROZEN, RETAINED VALID by EXAM-550-CORRECTIVE-1. Raw records: `results/topo-<state>-S<n>-<ts>/samples.jsonl` +
`results/topology-<ts>.json` (campaign summary; the fix-rerun summaries are
`topology-2026-09-19T05-21-03-323Z.json` and `topology-2026-09-19T05-33-31-736Z.json` — see
§ rig deviations for why there are three summary files). API mode: production (limiter ON,
default budgets: login route 10/min/IP, global 100/min/IP), CSRF Origin enforcement active
(the harness sends the allowed Origin, like the real web client).

Retention justification (corrective-1): these runs already measured the production topology,
and their load-bearing claims are limiter-identity and 429-onset MECHANISM facts — audit-trail
`request.ip` evidence, per-IP budget isolation, XFF trust handling — not query-timing or
pool-queueing claims. The superseded pre-corrective CAPACITY_RESEARCH wrapper observed only
the drizzle→postgres.js funnel and cannot alter limiter keying, proxy-addr walking, or 429
decisions. The DIRECT_LAN limiter claim at S130/S200 — not measured in this group (direct was
measured at 20/50/100 here) — is provided by the corrective production-mode lifecycle runs
(auditDistinctIps = 131 at S130 and 201 at S200, zero 429; [04](04-results.md)).

The limiter key is a digest of `request.ip`; `request.ip` honors `TRUSTED_PROXY_CIDRS` via the
right-to-left proxy-addr walk (trusted hops are skipped; the first untrusted address is the
client identity). All topology states below carry full per-request records and the API's
audit-trail identity evidence.

## Measured states

| state | rig | N | login result | distinct audit IPs | verdict |
| --- | --- | ---: | --- | ---: | --- |
| `direct` (DIRECT_LAN) | candidates bind DISTINCT loopback aliases (127.0.0.2…), direct to API | 20 | 20/20, 0×429 | 21 | healthy — per-IP budgets, zero contention |
| `direct` | same | 50 | 50/50, 0×429 | 51 | healthy |
| `direct` | same | 100 | 100/100, 0×429 | 101 | healthy |
| `nat` (SHARED_NAT) | all candidates share 127.0.0.1 | 20 | 10/20, 10×429 | 1 | SUPPORTED_WITH_POLICY — honest label: the shared budget (10 login/min) is exhausted by the 11th simultaneous login; this is correct limiter behavior for one NAT address, and a real deployment behind CGNAT/Large-NAT sees exactly this |
| `nat` | same | 50 | 10/50, 40×429 | 1 | same |
| `degraded` (proxy, NO trust) | reverse proxy appends real client aliases to XFF; API trusts nothing | 20 | 10/20, 10×429 | 1 | DEGRADED_BY_CONFIG — everyone collapses to the proxy's socket identity; the config defect, not a code defect |
| `proxy` (REVERSE_PROXY_WITH_TRUSTED_CLIENT_IP) | same rig; API trusts the proxy's egress /32s | 20 | 20/20, 0×429 | 21 | healthy — the XFF walk restores each client's real alias; audit trail shows 21 distinct identities |

All measured login latencies in the healthy states match the DIRECT_LAN envelope
(proxy p99 ≈ 0.90 s at S20 — the added hop is noise-level).

## Spoof-negative evidence (NON_CANONICAL probes, live API)

- **Direct XFF spoofing is ignored**: 130 logins with `X-Forwarded-For: 9.9.9.9` from untrusted
  socket A → 120×429 + 10×401 (keyed by the socket peer); a single login with the SAME spoofed
  header from socket B at the same moment → 401 (not 429). If XFF were honored, B would have
  shared A's burned budget.
- **Injected XFF through the trusted proxy is ignored**: client-injected `6.6.6.6` left of the
  genuine entry; the proxy appends the client's real alias. 130-burst → 120×429 + 10×401 keyed
  by the GENUINE (rightmost untrusted) entry; the same injected header from a different alias →
  401 (not 429). The walk selects the proxy-appended entry, never the injected one.
- **Per-IP budget isolation** (direct:100 state): 130-login burst from alias .230 → 120×429;
  single login from alias .231 at the same moment → 401. Budgets are strictly per-identity.

## Rig deviations (measured, not assumed — honesty record)

The frozen plan (01-topology.md) assumed nginx-in-container could see client source IPs. Two
measured rig facts forced a change; both earlier attempts are retained as artifacts:

1. **Published-port Docker NAT erases client identity BEFORE the proxy.** With
   `docker run -p 8210:80`, every proxied request arrived at the API with socket peer
   172.17.0.1 (bridge gateway) or 127.0.0.1 (vpnkit path — the choice flipped between API
   restarts), so the candidates' distinct aliases never reached nginx and identity restoration
   was structurally impossible (`topology-2026-09-19T05-01-07-964Z.json`: proxy state collapsed
   to 2 audit IPs, 10/20 logins; the 12/20 login-burst 502s from the extra NAT hop are in the
   fix-rerun `topology-2026-09-19T05-21-03-323Z.json` — both retained).
2. **Docker Desktop host networking is not effective in this rig** (container up, port
   unreachable — measured before use).

Resolution: the harness runs a minimal host-side reverse proxy (Node `http`, ~30 lines,
faithful `$proxy_add_x_forwarded_for` semantics) binding 127.0.0.1:8210 — it sees the drivers'
real source addresses, exactly like a same-host reverse proxy in a real deployment. The
behavior under test is the API's `TRUSTED_PROXY_CIDRS` + proxy-addr walk (#546 contract), not
nginx-the-product. The trusted set is self-calibrated from live probes and recorded per run
(`calibrationPeers`, `trustedCidrs`, `trustedCidrsBasis` in
`topology-2026-09-19T05-33-31-736Z.json`).

## Consequences for the deployment guidance

- DIRECT_LAN (the primary on-prem topology): per-IP limiting works as designed with zero
  false positives measured — S20/S50/S100 in this group (21/51/101 distinct audit IPs,
  0×429), and S130/S200 through the corrective production-mode lifecycle runs
  (131/201 distinct audit IPs, 0×429 — [04](04-results.md), [03](03-workload-matrix.md)).
  The DIRECT_LAN limiter claim is therefore evidenced through S200 under production.
- Behind SHARED_NAT: simultaneous logins contend for the 10/min shared budget. This is
  correct-by-design (the alternative — disabling per-IP limits — removes the abuse bound);
  the honest operational note is "clients behind one NAT address should expect login bursting
  limits", SUPPORTED_WITH_POLICY.
- Behind a reverse proxy: `TRUSTED_PROXY_CIDRS` MUST be configured, or every client collapses
  to the proxy address (measured 50% login loss at 20 simultaneous clients). When configured,
  identity is fully restored (measured 21/21 distinct identities at N=20) and spoofed headers
  are ignored (measured). The CIDR must cover the proxy's REAL egress address — a wrong CIDR
  degrades exactly like no configuration (measured in the retained first-attempt artifacts).
