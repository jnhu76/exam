# #669 Phase E — Gate-1 Final Report (§51)

Recorded: 2026-10-04. Baseline: `00-baseline.md` (LIVE_MASTER `67079eff`,
branch `research/669-rich-phase-e-falsification`, zero production changes —
the entire Phase-E footprint is this research package plus one flake
registration in `docs/standards/test-flakes.md`).

## Gate-1 verdict: RICH_PROTOCOL_BACKEND_SOUND = **FAIL**

Applied rule (§51, strict vocabulary): PASS requires **every campaign green
AND zero open counterexamples**. 23/23 campaigns are green (§47 matrix), but
exactly one counterexample is OPEN and unrepaired per §41:

- **D-F01** — an authority-accepted Rich answer bearing U+0000 (or an
  unpaired surrogate) is answered HTTP 500 INTERNAL_ERROR at the SaveAnswer
  wire instead of being persisted or rejected with a structured category.
  Containment held (no partial state, no receipt leak, no pool poisoning);
  ledger: `03-counterexamples.md`.

FAIL — not BLOCKED: every campaign ran to completion against the real
authorities and real PostgreSQL; nothing was un-runnable. FAIL — not PASS:
the falsified clause is E-WR01's reachability premise (every answer the
production authorities accept must be accepted by the wire), and it is
falsified by observation, not inference.

## §47 — campaign × invariant coverage matrix

| Campaign | Level | Invariants attacked | Verdict | Evidence (latest checkpoint 2026-10-04) |
| --- | --- | --- | --- | --- |
| A canonicalization algebra | L1 | E-RC03 (closure, idempotence, N-fixed-point) | GREEN | `results/A-canonical-algebra-*.json` |
| B preflight/grammar differential | L1 | E-RC04 (+exact CONTENT_LIMITS grid, strict `>`) | GREEN | `results/B-preflight-differential-*.json` |
| C dual classifier differential | L1 | E-RD01/02/03 (+E-RC03 canonical trust, RC-03) | GREEN | `results/C-classifier-differential-*.json` |
| D durable round-trip | L4 | E-WR01, E-RP01/02 protocol, **D-F01 pinned** | GREEN* | `results/run-2026-10-04-a2g-d.log`, `results/D-durable-roundtrip-*.json` |
| E editor↔grammar differential | L1 | E-RC02 (adapter mapping policy, downgrades) | GREEN | `results/E-editor-differential-*.json` |
| F durable-writer census | L0 | E-WR01 inventory replay + mechanical sweep | GREEN | `results/F-durable-writer-census-*.json` |
| G SaveAnswer precedence | L2 | §12/§13 precedence (1440-combination state space) | GREEN | `results/G-saveanswer-precedence-*.json` |
| H replay longevity | L4 | E-RP03/05, restart stability, concurrency, zero-write ACK | GREEN | `results/run-2026-10-04-h.log`, `results/H-replay-longevity-*.json` |
| I submit freeze | L4 | E-SB01/02 (last-accepted freeze, no re-normalization) | GREEN | `results/I-submit-freeze-*.json` |
| J frozen-vs-live | L4 | E-FZ01 (durable rows across live edits + restart) | GREEN | `results/J-frozen-vs-live-*.json` |
| K grading consumer matrix | L4 | E-GR01 (frozen basis, raw evidence, manual scoring) | GREEN | `results/K-grading-consumer-matrix-*.json` |
| L export consistency | L4 | E-EX01/02 (+E-RS01; JSON/CSV trust boundary) | GREEN | `results/L-export-consistency-*.json` |
| M static render trust | L2 | E-RE01/02/03 (earn-render, fail-closed, inertness) | GREEN | `results/M-render-trust-*.json` |
| N math adversarial | L1 | E-RE04/05/06 (resource bounds, source preservation) | GREEN | `results/M-run-2026-10-04-mn.log`, `results/N-math-adversarial-*.json` |
| O publish trust | L4 | E-PB01..04 (gate-before-projection, no repair, generic wire copy) | GREEN | `results/O-publish-trust-*.json` |
| P DTO/OpenAPI drift | L0+L1 | contract surfaces (SaveAnswer/export/grading DTOs, spec published) | GREEN | `results/P-dto-openapi-drift-*.json` |
| Q Unicode corpus × jsonb | L4 | E-WR01 spread; **D-F01 family extension** | GREEN* | `results/Q-unicode-roundtrip-*.json` |
| R canonical identity differential | L1 | E-RP01/02 foundations (identity ↔ domain equality) | GREEN | `results/R-identity-differential-*.json` |
| S projection purity | L1 | E-WR02 (read-only, deterministic, canonical fixed point) | GREEN | `results/S-projection-purity-*.json` |
| T DB-history corpus at draft seam | L4 | E-RD01/03/04 (verbatim serve, dual-classifier agreement, write-seam boundary) | GREEN | `results/T-db-history-corpus-*.json` |
| U shadow-oracle census | L0 | E-RC01 (single definition of every authority symbol; no limit/docVersion/sha256 shadow) | GREEN | `results/U-shadow-oracle-census-*.json` |
| V mutation-free read | L4 | E-RD04 at the durable layer (5 read surfaces, corrupt-frozen hammer) | GREEN | `results/V-mutation-free-read-*.json` |
| W cross-seam mutation | L1 | E-RD04/E-WR02/E-RE01 foundations (8-seam deep-frozen chain) | GREEN | `results/W-cross-seam-mutation-*.json` |

\* campaign green with its documented counterexample pinned as a test — the
pinning is the deliverable, per §41.

Full-suite checkpoint: 23 files, **114/114 tests passed**
(`results/run-2026-10-04-full-aw.log`, 2026-10-04).

## §48 — counterexample adjudication matrix

| ID | Status | Clause falsified | Level/seam | Disposition |
| --- | --- | --- | --- | --- |
| D-F01 (incl. Q unpaired-surrogate extension) | **OPEN** | E-WR01 reachability premise / contract §6 durability: authority-accepted value outside jsonb's representable set (U+0000, lone surrogate) → HTTP 500 at SaveAnswer | L4 wire, `attempts.answers` jsonb write | Recorded, unrepaired (§41). Post-Gate repair candidates: (a) reject non-representable values at the write authority with a structured INVALID_ANSWER category, or (b) contract change shrinking the legal text set. Containment verified: transactional, no partial state, no receipt leak, no persistent pool effect. |
| PC-F01…F-06 (Phase C lineage) | REPAIRED (pre-Phase-E) | — | — | Continuity replay 2026-10-04: all pinned suites green — 263 tests (`results/run-2026-10-04-replay-pcf-d51.log`; table in `03-counterexamples.md`). No reopened class. |
| D5.1 publish-trust regressions | REPAIRED (pre-Phase-E) | — | — | `examCommands.test.ts` 91/91 within the same replay. |

## §51 — findings narrative

**What held under attack.** The authority stack is semantically singular
(U: one definition per authority symbol; no duplicated limits, version
gates, or identity digests). Canonicalization is a genuine algebra
(A: closure, idempotence, N-fixed-point) with preflight exactly
co-extensive to the grammar+limits kernel (B). The write seam persists only
canonical values (D/F/I), the replay protocol's precedence order survived a
1440-combination enumeration (G) plus longevity/restart/concurrency attacks
(H), identity and domain equality agree over mutation operators (R), and the
projection is a pure derivation stable under re-canonicalization (S). The
read side never repairs: every DB-history shape serves verbatim with
consumer classification in agreement (T), and even a corrupt frozen truth
survives the full read hammer byte-identical at the row level (V), across
all eight consumer seams (W). Freeze chains, grading, exports, rendering,
publish, and the DTO surface all held their frozen-trust discipline
(I–O). The Unicode corpus round-trips byte-deep except the D-F01 family.

**The one falsification.** A gap between the AUTHORITIES' legal set and the
DURABLE STORE's representable set: `ContentDocumentV1Schema` and
`canonicalizeContentDocument` accept U+0000 / unpaired surrogates inside
text runs; PostgreSQL jsonb cannot encode them; the SaveAnswer path has no
rejection category for that class, so the request dies as a 500 after
canonicalization, inside the protocol transaction. The design's layering
contained the blast radius exactly as the transaction discipline promised —
but the contract sentence "every answer the production authorities accept
is accepted by the wire" is false, and Gate-1's rule leaves no discretion.

**Oracle-quality notes (harness near-misses, fixed during the run).**
Two harness bugs were caught and fixed before they could produce vacuous
verdicts: (1) Campaign G initially enumerated a phantom `active` attempt
status that the domain does not have; (2) Campaign R initially compared
RAW mutants with the domain equality, while the engine's equality/identity
domain is the CANONICAL value. Both fixes are in the harness history; the
recorded evidence is post-fix.

**Transient noted, not a counterexample.** One 503 AUTHZ_UNAVAILABLE
observed 3× early, never recurred instrumented; registered in
`docs/standards/test-flakes.md` with instrumentation retained (second sample
→ escalate).

## Evidence index

- Suite checkpoint: `results/run-2026-10-04-full-aw.log` (23 files, 114/114)
- Per-campaign JSON run artifacts: `results/<campaign>-*.json` (seeds
  recorded per §6: `0x669E0001..0007` + Phase-C lineage seeds)
- Campaign logs: `results/run-2026-10-04-{a2g,a2g-d,a2g-full,h,mn,aq}.log`
- Prior-phase continuity replay: `results/run-2026-10-04-replay-pcf-d51.log`
- Flake registration: `docs/standards/test-flakes.md` (2026-10-03 bootstrap
  timeout host-load family; AUTHZ_UNAVAILABLE transient)

## §41 handoff (post-Gate repair candidates, not executed here)

1. **D-F01 repair** — decision required: structured INVALID_ANSWER category
   at the save boundary for jsonb-unrepresentable values (keeps the legal
   set), or grammar-level rejection of control characters/unpaired
   surrogates (contract change, shrinks the legal set). Cross-seam spread
   (question create/update, publish freeze) should be swept in the same
   repair, reusing the Q corpus.
2. Post-repair, flip D-F01 to REPAIRED with a regression test at the wire,
   re-run the Phase-E suite, and re-adjudicate Gate-1 (expected PASS if
   nothing else regressed).
