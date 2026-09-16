# #546 Fresh adversarial review

Fresh-context reviewer protocol: the reviewer received ONLY Issue #546, the
F-08-1 audit context, the #304-family docket discipline, the branch diff
(`7711cd9c..a701bdd4`), the evidence docs, and the tests — and attacked along
the 10 mandated lines (spoof/bypass, default-off equivalence, authority,
validation, topology freeze, scope, audit, test vacuity, docs, dependency
plumbing). The reviewer empirically probed the installed
fastify@5.8.5 / @fastify/proxy-addr@5.1.0 / ipaddr.js@2.4.0. Verdict:
**NEEDS_WORK** → all findings below were addressed in the corrective commit.

```json
{"severity":"MAJOR","attack":4,"claim":"The unconditional 'spoof-proof by construction' claim is false when a trusted CIDR also covers genuine client addresses — and the repo's own example config invites exactly that in this product's core LAN scenario. Empirically demonstrated: with trustProxy=['10.0.0.0/8','127.0.0.1/32'] (the shipped example), socket 10.1.1.5 and XFF '9.9.9.9, 10.5.5.5' (attacker-injected entry + proxy-appended real 10.x client), request.ip resolves to '9.9.9.9' — an attacker-chosen limiter identity AND audit ipAddress. Cause: proxy-addr's walk skips every address matching a trusted CIDR, including the genuine client entry, so injected entries are selected once the walk passes the real client","recommendation":"State the precondition (trusted CIDRs cover only proxy→API links, never candidate client networks; warn 0.0.0.0/0 & ::/0) in runbook/README/.env.deploy.example; qualify the spoof-proof sentence; fix the worked example away from 10/8; add a pinning test for the over-broad-CIDR case"}
{"severity":"MINOR","attack":8,"claim":"No test pins the actual server.ts wiring, so the single wiring line can drift silently; the runtimeConfig.ts comment overstates ('so the wiring cannot drift') because nothing enforces that server.ts keeps calling resolveTrustProxyOption. A regression to trustProxy: true would pass the entire suite while making every DIRECT_LAN deployment spoofable","recommendation":"Add a guard (contract-style textual check or boot-level test) asserting server.ts derives trustProxy via resolveTrustProxyOption(getRuntimeConfig())"}
{"severity":"MINOR","attack":9,"claim":"Design doc contradicts implementation on validation mechanism: doc says 'validated via node:net BlockList parsing', implementation validates with ipaddr.js","recommendation":"Fix the design doc; the runtimeConfig.ts comment (ipaddr.js = the same library proxy-addr matches with) is the correct phrasing"}
{"severity":"MINOR","attack":9,"claim":"Baseline doc says 'committed test ... 5/5 PASS on 7711cd9c' but the file is not on master — the characterization ran from an uncommitted working tree","recommendation":"Rephrase to working-tree-at-7711cd9c"}
{"severity":"INFO","attack":1,"claim":"With a trusted socket, Fastify v5 also honors client-injectable X-Forwarded-Host and X-Forwarded-Proto (inert today: no production consumer of request.protocol/hostname)","recommendation":"Note in the runbook that the front proxy should overwrite both headers"}
{"severity":"INFO","attack":4,"claim":"Validator/matcher parity divergences: proxy-addr accepts named ranges (loopback/linklocal/uniquelocal) the validator deliberately rejects (fail-closed, fine); IPv4-mapped IPv6 sockets match IPv4 CIDRs correctly (verified)","recommendation":"Record in the design doc's residual unknowns"}
```

## Disposition of findings

| Finding | Disposition |
| --- | --- |
| MAJOR — over-broad trusted CIDR re-enables identity forging | Precondition stated as **load-bearing** in the runbook §2 (never cover the candidate client network; blanket 0.0.0.0/0/::/0 called out), README, and .env.deploy.example; worked example changed to `127.0.0.1/32` (loopback TLS terminator); design-doc spoof analysis qualified with the walk-skips-every-trusted-address semantics; new "over-broad trusted CIDR hazard" test pins the forged-identity behavior as executable knowledge (`rateLimit.topology.test.ts`). |
| MINOR — unpinned server.ts wiring | New check 7 "Client-IP trust wiring" in `scripts/repository-contract/config-contract.mjs`: server.ts must derive `trustProxy` via `resolveTrustProxyOption(getRuntimeConfig())` and must not hand-build the option. The runtimeConfig.ts comment is now true. |
| MINOR — BlockList vs ipaddr.js in design doc | Design doc corrected: validation uses ipaddr.js, the same library `proxy-addr` matches with. |
| MINOR — "committed test on 7711cd9c" mischaracterization | 00-baseline.md rephrased: tests committed in `a701bdd4`, run against a working tree at `7711cd9c`. |
| INFO — X-Forwarded-Host/Proto | Runbook wiring step 3 added (proxy overwrites both headers); design-doc trusted-socket bullet extended. |
| INFO — parity divergences | Recorded as residual unknown #4 in the design doc; #3 records the accepted trust-everything CIDRs as operator-explicit with the precondition + hazard test as guards. |

Reviewer-executed verification: topology tests 8/8 and runtimeConfig 133/133
re-run green by the reviewer against the reviewed commit (hazard test and
contract check added after, in the corrective); config-contract gate PASS
(60 leaves); spoof demonstration reproduced against installed dependencies
via a throwaway script outside the repo. Full @exam/api suite re-run green in
the authoring environment after the corrective.
