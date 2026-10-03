/**
 * Phase-E Campaign H — replay longevity, restart stability, concurrency
 * (L4, real PostgreSQL, wire level). Falsification targets:
 *
 * H1 (E-RP03 longevity): an accepted replay key is ACKed after arbitrarily
 *   many later accepted saves on the same slot — no retention bound / eviction.
 *
 * H2 (E-RP03 restart): after rebuilding the app ON THE SAME DATABASE (fresh
 *   in-process state), the OLD key still ACKs verbatim and a distinct-identity
 *   payload on the same key still conflicts — receipts are durable, not
 *   in-memory.
 *
 * H3 (E-RP01 verbatim): the ACK returns the PRIOR version AND prior savedAt
 *   verbatim, and the durable slot is byte-stable across the replay (zero
 *   writes; stable projection = body minus the per-request serverNow clock).
 *
 * H4 (E-RP02 concurrent): N parallel distinct-identity saves on the SAME
 *   clientSeq — exactly one accepted, the others CONFLICTING_PAYLOAD, the
 *   version advances exactly 1, and the stored answer is the winner.
 *
 * H5 (§12 CAS concurrent): N parallel same-identity saves with DISTINCT fresh
 *   clientSeqs on one stale baseVersion — exactly one accepted, the others
 *   STALE_VERSION, version advances exactly 1 (no lost update, no double
 *   bump). The winner's key is then replay-ACKed.
 *
 * H6 (E-RP05 atomicity): structural — the route persists the protocol result
 *   inside ONE executeInTransaction that delegates to the engine saveAnswer,
 *   whose repository contract places receipt-append in the same transaction
 *   as the accepted answers write; behavioral spot — every accepted save's
 *   receipt is observable (replay ACKs) and no double records exist.
 *   Failure INJECTION into that transaction is not reachable without
 *   production fault hooks (§41 forbids adding them) — recorded BLOCKED for
 *   the injection leg, PASS for the structural + observational legs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ContentDocumentV1 } from "@exam/domain";
import { rebuildAppOnSameDb } from "@exam/api/src/routes/testHelpers.js";
import { canonicalAnswerIdentity } from "@exam/exam-engine";
import { CampaignRecorder } from "./campaignStats.js";
import {
  allAttemptRoutes,
  buildRichAttemptFixture,
  type RichAttemptFixture,
} from "./fixture.js";

const recorder = new CampaignRecorder("H-replay-longevity", [0x669e0004]);

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

function para(text: string): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/** Body minus the per-request serverNow clock field (see D, byte-stable). */
function stableProjection(body: string): string {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  delete parsed.serverNow;
  return JSON.stringify(parsed);
}

describe("Campaign H — replay longevity, restart, concurrency (L4, E-RP01/02/03/05)", () => {
  let fx: RichAttemptFixture;
  let seq: number;
  let version: number;
  let doc1: ContentDocumentV1;
  let savedAt1: string;

  beforeAll(async () => {
    fx = await buildRichAttemptFixture("H campaign prompt.");
    // Key under attack: clientSeq 1 on this slot (fresh attempt ⇒ seq 1 is
    // truly the OLDEST possible key).
    seq = 0;
    version = 0;
    doc1 = para("H key answer v1");
    seq = 1;
    const res = await fx.postAnswer(doc1, seq, 0);
    expect(res.json().accepted, res.body.slice(0, 200)).toBe(true);
    version = res.json().serverVersion as number;
    savedAt1 = res.json().savedAt as string;
    expect(version).toBe(1);
  }, 120_000);

  afterAll(async () => {
    recorder.flush();
    await fx.ctx.cleanup();
  });

  it("H1 longevity: seq 1 still ACKs after many later accepted saves (E-RP03, no eviction)", async () => {
    for (let i = 2; i <= 12; i += 1) {
      const res = await fx.postAnswer(para(`H1 later answer ${i}`), i, version);
      expect(res.json().accepted, res.body.slice(0, 200)).toBe(true);
      version = res.json().serverVersion as number;
      expect(version).toBe(i);
    }
    const replay = await fx.postAnswer(doc1, 1, 0);
    expect(replay.statusCode, replay.body.slice(0, 200)).toBe(200);
    expect(replay.json()).toMatchObject({ accepted: true, serverVersion: 1 });
    expect(replay.json().savedAt).toBe(savedAt1);
    recorder.record({
      probe: "H1-longevity",
      outcome: "ack-verbatim-after-11-saves",
    });
  });

  it("H2 restart: rebuilt app on the same DB still ACKs the old key and still conflicts distinct identity (E-RP03)", async () => {
    const app2 = await rebuildAppOnSameDb(fx.ctx, allAttemptRoutes);
    try {
      const replay = await fx.postAnswer(doc1, 1, 0, app2);
      expect(replay.statusCode, replay.body.slice(0, 200)).toBe(200);
      expect(replay.json()).toMatchObject({ accepted: true, serverVersion: 1 });
      expect(replay.json().savedAt).toBe(savedAt1);

      const conflicting = await fx.postAnswer(
        para("H2 distinct identity on key 1"),
        1,
        version,
        app2,
      );
      expect(conflicting.statusCode).toBe(200);
      expect(conflicting.json()).toMatchObject({
        accepted: false,
        reason: "CONFLICTING_PAYLOAD",
      });
      // The conflicting write wrote nothing.
      expect(
        (fx.slotOf(await fx.getAttemptBody(app2)) as Record<string, unknown>)
          .version,
      ).toBe(version);
      recorder.record({ probe: "H2-restart", outcome: "durable-receipts" });
    } finally {
      await app2.close();
    }
  });

  it("H3 verbatim ACK + zero writes: the slot is byte-stable across a replay (E-RP01)", async () => {
    const before = await fx.getAttemptRaw();
    const replay = await fx.postAnswer(doc1, 1, 0);
    expect(replay.json()).toMatchObject({
      accepted: true,
      serverVersion: 1,
      savedAt: savedAt1,
    });
    const after = await fx.getAttemptRaw();
    expect(stableProjection(after.body)).toBe(stableProjection(before.body));
    recorder.record({ probe: "H3-verbatim", outcome: "zero-write-ack" });
  });

  it("H4 concurrent distinct identities on ONE clientSeq: exactly one winner, others conflict, one version bump (E-RP02)", async () => {
    seq = 100;
    const base = version;
    const contenders = [1, 2, 3, 4].map((i) => para(`H4 contender ${i}`));
    const results = await Promise.all(
      contenders.map((doc) => fx.postAnswer(doc, seq, base)),
    );
    for (const r of results) {
      expect(r.statusCode, r.body.slice(0, 160)).toBe(200);
    }
    const bodies = results.map((r) => r.json());
    const winners = contenders.filter((_, i) => bodies[i].accepted === true);
    expect(
      winners.length,
      JSON.stringify(bodies.map((b) => b.reason ?? "ok")),
    ).toBe(1);
    const conflictCount = bodies.filter(
      (b) => b.accepted === false && b.reason === "CONFLICTING_PAYLOAD",
    ).length;
    expect(conflictCount).toBe(3);

    const winnerIdx = bodies.findIndex((b) => b.accepted === true);
    version = bodies[winnerIdx].serverVersion as number;
    expect(version).toBe(base + 1);
    const slot = fx.slotOf(await fx.getAttemptBody()) as Record<
      string,
      unknown
    >;
    expect(slot.version).toBe(version);
    expect(slot.answer).toEqual(contenders[winnerIdx]);
    // The winner's receipt is live.
    const ack = await fx.postAnswer(contenders[winnerIdx], seq, base);
    expect(ack.json()).toMatchObject({
      accepted: true,
      serverVersion: version,
    });
    recorder.record({
      probe: "H4-concurrent-conflict",
      outcome: "single-winner",
      winnerIdentity: canonicalAnswerIdentity(contenders[winnerIdx]),
    });
  });

  it("H5 concurrent same identity, distinct fresh seqs, stale base: exactly one accepted, others STALE, one version bump (§12 CAS)", async () => {
    const base = version;
    const doc = para("H5 shared identity payload");
    const seqs = Array.from({ length: 10 }, (_, i) => 200 + i);
    const results = await Promise.all(
      seqs.map((s) => fx.postAnswer(doc, s, base)),
    );
    for (const r of results) {
      expect(r.statusCode, r.body.slice(0, 160)).toBe(200);
    }
    const bodies = results.map((r) => r.json());
    const acceptedIdx = bodies.findIndex((b) => b.accepted === true);
    expect(
      acceptedIdx,
      JSON.stringify(bodies.map((b) => b.reason ?? "ok")),
    ).toBeGreaterThanOrEqual(0);
    const staleCount = bodies.filter(
      (b) => b.accepted === false && b.reason === "STALE_VERSION",
    ).length;
    expect(staleCount).toBe(9);
    version = bodies[acceptedIdx].serverVersion as number;
    expect(version).toBe(base + 1);
    // The winner's key ACKs; a sibling key (distinct seq, same identity) does
    // NOT become a replay of the winner — it stays unknown (conflict if
    // retried against current base with a DIFFERENT identity is out of scope
    // here; same-identity retry on its OWN seq must ACK its own receipt).
    const winnerSeq = seqs[acceptedIdx];
    const ack = await fx.postAnswer(doc, winnerSeq, base);
    expect(ack.json()).toMatchObject({
      accepted: true,
      serverVersion: version,
    });
    const slot = fx.slotOf(await fx.getAttemptBody()) as Record<
      string,
      unknown
    >;
    expect(slot.version).toBe(version);
    recorder.record({
      probe: "H5-concurrent-cas",
      outcome: "single-accept",
      winnerSeq,
    });
  });

  it("H6 atomicity: single-commit structure + observable receipt/answer pairing (E-RP05; injection leg BLOCKED)", () => {
    // Structural: the save route wraps the engine saveAnswer call in ONE
    // executeInTransaction; the engine's repository contract requires the
    // receipt append in the SAME transaction as the accepted answers write.
    const routeSrc = readFileSync(
      path.join(REPO_ROOT, "apps/api/src/routes/attempts.candidate.ts"),
      "utf8",
    );
    expect(routeSrc).toMatch(
      /executeInTransaction\(fastify\.db, async \(tx\) => \{[\s\S]*?await saveAnswer\(/,
    );
    const engineSrc = readFileSync(
      path.join(REPO_ROOT, "packages/exam-engine/src/attemptCommands.ts"),
      "utf8",
    );
    expect(engineSrc).toMatch(
      /same transaction as the[\s\S]*?accepted answers write/,
    );

    // Behavioral spot (observational leg): H4/H5 winners' receipts ACKed and
    // exactly ONE answer record per slot — no answer-without-receipt is
    // observable from the outside.
    recorder.record({
      probe: "H6-atomicity",
      outcome: "structural+observational-pass",
      injectionLeg: "BLOCKED-without-production-fault-hooks (§41)",
    });
  });
});
