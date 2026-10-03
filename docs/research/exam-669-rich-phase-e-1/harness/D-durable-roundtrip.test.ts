/**
 * Phase-E Campaign D — durable write/read round-trip (L4, real PostgreSQL,
 * SaveAnswer wire). Falsification targets:
 *
 * E-RT01: every answer the production authorities accept (ContentDocumentV1
 *   schema parse + canonical closure) must be accepted by the wire and must
 *   round-trip: the GET read seam serves a schema-legal value classified
 *   rich_valid whose deep structure and canonical identity equal the
 *   canonical value the save authority computes from the same input.
 *
 * E-RT02: every answer the authorities reject must be rejected at the wire
 *   with a structured INVALID_ANSWER (HTTP 200 body), must leave the slot
 *   untouched (no version bump, no receipt) — proven by a subsequent legal
 *   write reusing the SAME clientSeq being accepted (a leaked receipt would
 *   answer CONFLICTING_PAYLOAD; a leaked version bump would answer
 *   STALE_VERSION).
 *
 * E-RT03: §12 replay at the wire — the exact original request (same payload
 *   + clientSeq + baseVersion) is an ACK with an unchanged serverVersion; a
 *   distinct-identity payload reusing the clientSeq is CONFLICTING_PAYLOAD
 *   and writes nothing.
 *
 * E-RT04: null (the protocol's cleared answer) round-trips as null with a
 *   version bump; a plain string on a rich question is INVALID_ANSWER; two
 *   consecutive GETs serve a byte-stable persisted projection (modulo the
 *   per-request serverNow clock field).
 *
 * ORACLE DISCIPLINE (§31): every expectation is computed from the production
 * authorities — ContentDocumentV1Schema, canonicalizeContentDocument,
 * classifyPersistedRichAnswer, canonicalAnswerIdentity — never from route
 * code. The exact-limit grid's expected outcome is the AUTHORITY BRANCH, not
 * the kernel-level expectLimitsClean label: canonicalization may legally
 * shrink a limits-clean composition (adjacent unmarked runs merge, empty
 * paragraphs collapse), and a composition whose canonical form leaves the
 * limits must be rejected at the wire (PC-F01 at the boundary).
 *
 * NUL DISCIPLINE: PostgreSQL jsonb cannot represent U+0000. The shared text
 * arbitrary may generate NUL; property runs bearing it are recorded and
 * deferred to Campaign Q (Unicode charter) instead of polluting this
 * campaign's verdict. The deterministic NUL probe pins the wire's actual
 * failure mode as DOCUMENTED COUNTEREXAMPLE D-F01 (03-counterexamples.md).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ContentDocumentV1 } from "@exam/domain";
import {
  ContentDocumentV1Schema,
  canonicalizeContentDocument,
  classifyPersistedRichAnswer,
} from "@exam/contracts";
import { canonicalAnswerIdentity } from "@exam/exam-engine";
import { arbitraryDocument, exactLimitDocs } from "./generators.js";
import { CampaignRecorder } from "./campaignStats.js";
import { buildRichAttemptFixture, type RichAttemptFixture } from "./fixture.js";

const recorder = new CampaignRecorder("D-durable-roundtrip", [0x669e0004]);
const NUM_RUNS = 40;
const SEED = 0x669e0004;

/** Text runs must not carry NUL — deferred to Campaign Q (see header). */
function bearsNul(v: unknown): boolean {
  return JSON.stringify(v)?.includes("\\u0000") ?? false;
}

type AuthorityVerdict =
  | { branch: "rejected" }
  | { branch: "accepted"; canonical: ContentDocumentV1; identity: string };

/** The save path's authority sequence, replayed independently of the wire. */
function authorityVerdict(sent: unknown): AuthorityVerdict {
  const parsed = ContentDocumentV1Schema.safeParse(sent);
  if (!parsed.success) return { branch: "rejected" };
  const canonical = canonicalizeContentDocument(parsed.data);
  if (!canonical.ok) return { branch: "rejected" };
  return {
    branch: "accepted",
    canonical: canonical.value,
    identity: canonicalAnswerIdentity(canonical.value),
  };
}

describe("Campaign D — durable write/read round-trip (L4, E-RT01..04)", () => {
  let fx: RichAttemptFixture;

  // Protocol state mirroring the §12 versioned-receipt model. Every NEW
  // payload takes the next clientSeq; accepted writes advance currentVersion.
  let clientSeq = 1_000;
  let currentVersion = 0;

  beforeAll(async () => {
    fx = await buildRichAttemptFixture();
  }, 120_000);

  afterAll(async () => {
    recorder.flush();
    await fx.ctx.cleanup();
  });

  function postAnswer(answer: unknown, seq: number, baseVersion: number) {
    return fx.postAnswer(answer, seq, baseVersion);
  }

  /**
   * E-RT01 read-seam clauses for one accepted write. Returns violation
   * strings instead of throwing so one property run can enumerate every
   * counterexample, not just the first.
   */
  function readSeamViolations(
    label: string,
    canonical: ContentDocumentV1,
    identity: string,
    slot: Record<string, unknown> | undefined,
  ): string[] {
    const out: string[] = [];
    if (!slot) return [`${label}: no answer slot served for the question`];
    if (slot.version !== currentVersion) {
      out.push(
        `${label}: served version ${slot.version} != tracked ${currentVersion}`,
      );
    }
    const served = slot.answer;
    const parse = ContentDocumentV1Schema.safeParse(served);
    if (!parse.success) {
      out.push(`${label}: served answer is not schema-legal`);
      return out;
    }
    const kind = classifyPersistedRichAnswer({
      value: served,
      answerMode: "rich",
    }).kind;
    // An empty canonical document (all-empty-paragraph inputs collapse) may
    // classify as the classifier's empty family; only non-empty canonical
    // docs are required to read back rich_valid.
    if (canonical.content.length > 0 && kind !== "rich_valid") {
      out.push(
        `${label}: served answer classified ${kind}, expected rich_valid`,
      );
    }
    // jsonb serves object keys in its own sorted order, so the served value
    // is compared STRUCTURALLY, never by serialized key order.
    try {
      expect(served).toEqual(canonical);
    } catch {
      out.push(
        `${label}: served answer != canonical\n  served: ${JSON.stringify(served)?.slice(0, 300)}\n  canonical: ${JSON.stringify(canonical).slice(0, 300)}`,
      );
    }
    let servedIdentity: unknown;
    try {
      servedIdentity = canonicalAnswerIdentity(served as ContentDocumentV1);
    } catch (e) {
      out.push(`${label}: identity(served) threw: ${String(e)}`);
      return out;
    }
    if (servedIdentity !== identity) {
      out.push(
        `${label}: identity drift ${String(servedIdentity)} != ${identity}`,
      );
    }
    return out;
  }

  it("property: the wire verdict equals the authority verdict; accepted answers round-trip (E-RT01/02)", async () => {
    const violations: string[] = [];
    let runs = 0;
    let acceptedRuns = 0;
    let rejectedRuns = 0;
    let nulDeferred = 0;

    await fc.assert(
      fc.asyncProperty(arbitraryDocument("tiny"), async (doc) => {
        runs += 1;
        if (bearsNul(doc)) {
          nulDeferred += 1;
          recorder.record({ probe: "property", outcome: "nul-deferred-to-Q" });
          return;
        }
        const verdict = authorityVerdict(doc);
        clientSeq += 1;
        const seq = clientSeq;
        const res = await postAnswer(doc, seq, currentVersion);
        if (res.statusCode !== 200) {
          violations.push(
            `run ${runs} (clientSeq ${seq}, authority ${verdict.branch}): HTTP ${res.statusCode} ${res.body.slice(0, 200)}`,
          );
          return;
        }
        const body = res.json() as {
          accepted: boolean;
          reason?: string;
          serverVersion?: number;
        };

        if (verdict.branch === "rejected") {
          // E-RT02: structured INVALID_ANSWER, then prove the rejected write
          // left NO version bump and NO receipt by reusing the same clientSeq
          // with a legal distinct payload.
          if (body.accepted !== false || body.reason !== "INVALID_ANSWER") {
            violations.push(
              `run ${runs}: authority-rejected but wire said ${JSON.stringify(body).slice(0, 200)}`,
            );
            return;
          }
          rejectedRuns += 1;
          const probe: ContentDocumentV1 = {
            docVersion: 1,
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: `probe-${seq}` }],
              },
            ],
          };
          const probeRes = await postAnswer(probe, seq, currentVersion);
          const probeBody = probeRes.json();
          if (probeRes.statusCode !== 200 || probeBody.accepted !== true) {
            violations.push(
              `run ${runs}: rejected write leaked state — same-clientSeq legal write answered HTTP ${probeRes.statusCode} ${JSON.stringify(probeBody).slice(0, 160)}`,
            );
            return;
          }
          currentVersion = probeBody.serverVersion as number;
          acceptedRuns += 1;
          // The receipt probe is itself an accepted write — it must also
          // round-trip (single-run paragraphs are already canonical).
          violations.push(
            ...readSeamViolations(
              `run ${runs} receipt-probe`,
              probe,
              canonicalAnswerIdentity(probe),
              fx.slotOf(await fx.getAttemptBody()),
            ),
          );
          return;
        }

        // authority-accepted: E-RT01 accept + round-trip + §12 replay ACK.
        if (
          body.accepted !== true ||
          body.serverVersion !== currentVersion + 1
        ) {
          violations.push(
            `run ${runs}: authority-accepted but wire said ${JSON.stringify(body).slice(0, 200)}`,
          );
          return;
        }
        currentVersion = body.serverVersion as number;
        acceptedRuns += 1;
        violations.push(
          ...readSeamViolations(
            `run ${runs}`,
            verdict.canonical,
            verdict.identity,
            fx.slotOf(await fx.getAttemptBody()),
          ),
        );
        const replay = await postAnswer(doc, seq, currentVersion - 1);
        const replayBody = replay.json();
        if (
          replay.statusCode !== 200 ||
          replayBody.accepted !== true ||
          replayBody.serverVersion !== currentVersion
        ) {
          violations.push(
            `run ${runs}: §12 replay did not ACK unchanged — HTTP ${replay.statusCode} ${JSON.stringify(replayBody).slice(0, 160)}`,
          );
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );

    recorder.record({
      probe: "property-summary",
      outcome: "done",
      runs,
      acceptedRuns,
      rejectedRuns,
      nulDeferred,
      violations: violations.length,
    });
    expect(violations, `counterexamples:\n${violations.join("\n")}`).toEqual(
      [],
    );
    // Composition census: the run must actually exercise both branches — a
    // grid that never accepts or never rejects proves nothing.
    expect(acceptedRuns).toBeGreaterThan(5);
    expect(rejectedRuns).toBeGreaterThan(2);
  });

  it("deterministic exact-limit grid over the wire: the authority branch decides; accepted entries round-trip", async () => {
    const violations: string[] = [];
    let accepted = 0;
    let rejected = 0;

    for (const entry of exactLimitDocs()) {
      const verdict = authorityVerdict(entry.doc);
      clientSeq += 1;
      const seq = clientSeq;
      const res = await postAnswer(entry.doc, seq, currentVersion);
      if (res.statusCode !== 200) {
        violations.push(
          `${entry.name} (authority ${verdict.branch}): HTTP ${res.statusCode} ${res.body.slice(0, 200)}`,
        );
        continue;
      }
      const body = res.json();
      if (verdict.branch === "rejected") {
        if (body.accepted !== false || body.reason !== "INVALID_ANSWER") {
          violations.push(
            `${entry.name}: authority-rejected but wire said ${JSON.stringify(body).slice(0, 200)}`,
          );
          continue;
        }
        rejected += 1;
        recorder.record({ probe: entry.name, outcome: "wire-rejected" });
        continue;
      }
      if (body.accepted !== true || body.serverVersion !== currentVersion + 1) {
        violations.push(
          `${entry.name}: authority-accepted but wire said ${JSON.stringify(body).slice(0, 200)}`,
        );
        continue;
      }
      currentVersion = body.serverVersion as number;
      accepted += 1;
      violations.push(
        ...readSeamViolations(
          entry.name,
          verdict.canonical,
          verdict.identity,
          fx.slotOf(await fx.getAttemptBody()),
        ),
      );
      recorder.record({ probe: entry.name, outcome: "wire-accepted" });
    }

    recorder.record({
      probe: "grid-summary",
      outcome: "done",
      accepted,
      rejected,
    });
    expect(violations, `counterexamples:\n${violations.join("\n")}`).toEqual(
      [],
    );
    expect(accepted).toBeGreaterThan(3);
    expect(rejected).toBeGreaterThan(3);
  });

  it("serialized top end is durably reachable when canonicalization cannot shrink it (alternating marks)", async () => {
    // Adjacent runs with DIFFERENT marks never merge, and one-run-per-
    // paragraph compositions cannot merge across paragraphs, so this probe
    // exercises the serialized edge itself rather than the merge shrink.
    // Sized empirically to LIMIT - 1 like the B grid.
    const runDoc = (lengths: number[]): ContentDocumentV1 => ({
      docVersion: 1,
      type: "doc",
      content: lengths.map((n, i) => ({
        type: "paragraph" as const,
        content: [
          {
            type: "text" as const,
            text: "x".repeat(n),
            marks: [i % 2 === 0 ? ("bold" as const) : ("italic" as const)],
          },
        ],
      })),
    });
    const TEXT_RUN = 20_000;
    const SERIALIZED_LIMIT = 131_072;
    const runs: number[] = [];
    const serializedLen = (rs: number[]): number =>
      JSON.stringify(runDoc(rs)).length;
    while (serializedLen([...runs, TEXT_RUN]) <= SERIALIZED_LIMIT - 1) {
      runs.push(TEXT_RUN);
    }
    runs.push(SERIALIZED_LIMIT - 1 - serializedLen([...runs, 0]));

    const doc = runDoc(runs);
    expect(serializedLen(runs)).toBe(SERIALIZED_LIMIT - 1);
    // The authority must accept this composition outright — it is the
    // probe's premise; a rejection here invalidates the probe, not the wire.
    const verdict = authorityVerdict(doc);
    if (verdict.branch !== "accepted") {
      throw new Error(
        "probe premise violated: the authority rejected the alternating-marks composition",
      );
    }

    clientSeq += 1;
    const res = await postAnswer(doc, clientSeq, currentVersion);
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    const body = res.json();
    expect(body.accepted, res.body.slice(0, 300)).toBe(true);
    currentVersion = body.serverVersion as number;

    const violations = readSeamViolations(
      "alternating-marks-serialized-limit",
      verdict.canonical,
      verdict.identity,
      fx.slotOf(await fx.getAttemptBody()),
    );
    expect(violations.join("\n")).toBe("");
  });

  it("protocol: string on rich is INVALID_ANSWER; null clears with a version bump; conflicting write; byte-stable reads (E-RT03/04)", async () => {
    // A plain string is not a rich answer (authority: preflight rejects
    // non-document values) — the wire must say so without writing.
    clientSeq += 1;
    const strRes = await postAnswer("legacy text", clientSeq, currentVersion);
    expect(strRes.statusCode, strRes.body).toBe(200);
    expect(strRes.json()).toMatchObject({
      accepted: false,
      reason: "INVALID_ANSWER",
    });

    // null is the protocol's cleared answer: valid for every type, versioned
    // like any accepted save.
    clientSeq += 1;
    const nullSeq = clientSeq;
    const nullRes = await postAnswer(null, nullSeq, currentVersion);
    expect(nullRes.statusCode, nullRes.body).toBe(200);
    const nullBody = nullRes.json();
    expect(nullBody.accepted, nullRes.body).toBe(true);
    expect(nullBody.serverVersion).toBe(currentVersion + 1);
    currentVersion = nullBody.serverVersion as number;
    const nullSlot = fx.slotOf(await fx.getAttemptBody()) as Record<
      string,
      unknown
    >;
    expect(nullSlot.version).toBe(currentVersion);
    expect(nullSlot.answer).toBeNull();

    // §12 replay vs distinct identity on a deterministic document.
    const docA: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "phase-E answer A" }],
        },
      ],
    };
    const docB: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "phase-E answer B" }],
        },
      ],
    };
    clientSeq += 1;
    const seq = clientSeq;
    const base = currentVersion;
    const first = await postAnswer(docA, seq, base);
    expect(first.json().accepted, first.body).toBe(true);
    const v = first.json().serverVersion as number;
    expect(v).toBe(base + 1);
    currentVersion = v;

    const replay = await postAnswer(docA, seq, base);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      accepted: true,
      serverVersion: v,
    });

    const conflicting = await postAnswer(docB, seq, v);
    expect(conflicting.statusCode).toBe(200);
    expect(conflicting.json()).toMatchObject({
      accepted: false,
      reason: "CONFLICTING_PAYLOAD",
    });

    // The conflicting write must not have touched the durable slot, and the
    // read seam must be mutation-free. Byte identity is asserted on the body
    // MINUS serverNow — the response embeds a per-request server clock, which
    // is served fresh on every read by design; every persisted field must be
    // byte-stable across reads.
    const g1 = await fx.getAttemptRaw();
    const g2 = await fx.getAttemptRaw();
    expect(g1.statusCode).toBe(200);
    expect(g2.statusCode).toBe(200);
    const stable = (body: string): string => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      delete parsed.serverNow;
      return JSON.stringify(parsed);
    };
    expect(stable(g2.body)).toBe(stable(g1.body));
    const slot = fx.slotOf(g1.json()) as Record<string, unknown>;
    expect(slot.version).toBe(v);
    expect(slot.answer).toEqual(docA);
    expect(nullSeq).toBeGreaterThan(0);
  });

  it("DOCUMENTED COUNTEREXAMPLE D-F01: authority-accepted answer bearing U+0000 dies at the wire with HTTP 500 (§41: evidence only, no repair)", async () => {
    const nulDoc: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "a\u0000b" }],
        },
      ],
    };
    // Premise (as-built): the production authorities ACCEPT this document —
    // the schema and canonicalization are NUL-blind. The clause under test is
    // the §6 durability obligation behind E-WR01's Campaign-D reachability:
    // every authority-accepted answer must be accepted by the wire and
    // durably round-trip.
    const verdict = authorityVerdict(nulDoc);
    if (verdict.branch !== "accepted") {
      throw new Error(
        "counterexample premise violated: the authority rejected the NUL-bearing document",
      );
    }

    clientSeq += 1;
    const seq = clientSeq;
    const res = await postAnswer(nulDoc, seq, currentVersion);
    // OBSERVED (falsified clause): the wire answers HTTP 500 INTERNAL_ERROR —
    // no structured rejection category exists for "authority-accepted but
    // unrepresentable in the durable store" (jsonb cannot encode U+0000).
    expect(res.statusCode).toBe(500);
    const errBody = res.json() as { error?: { code?: string } };
    expect(errBody.error?.code).toBe("INTERNAL_ERROR");

    // Containment held: the failed save wrote nothing (transactional), the
    // slot still serves the previous canonical answer at the same version.
    const slot = fx.slotOf(await fx.getAttemptBody()) as Record<
      string,
      unknown
    >;
    expect(slot.version).toBe(currentVersion);
    expect(slot.answer).toBeDefined();
    expect(slot.answer).not.toBeNull();

    // And the failed save leaked no replay receipt: the same clientSeq with
    // a legal payload is accepted fresh at v+1.
    const probe: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: `nul-receipt-probe-${seq}` }],
        },
      ],
    };
    const probeRes = await postAnswer(probe, seq, currentVersion);
    expect(probeRes.statusCode, probeRes.body.slice(0, 200)).toBe(200);
    expect(probeRes.json().accepted, probeRes.body.slice(0, 200)).toBe(true);
    currentVersion = probeRes.json().serverVersion as number;

    recorder.record({
      probe: "D-F01-nul-text-run",
      outcome: "counterexample-pinned",
      detail:
        "authority-accepted rich answer with U+0000 in a text run: schema + canonicalization accept, wire answers 500 INTERNAL_ERROR; containment held (no durable write, no receipt). §41: recorded, not repaired.",
    });
  });
});
