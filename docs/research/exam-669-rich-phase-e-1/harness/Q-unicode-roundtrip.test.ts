/**
 * Phase-E Campaign Q — Unicode corpus × durable round-trip (L4, real
 * PostgreSQL). The domain grammar accepts ANY string in a text run; the
 * durable store is UTF-8 jsonb. The corpus sweeps the shared
 * UNICODE_CORPUS through the SaveAnswer wire:
 *
 * Q1 (round-trip family): every jsonb-representable string must round-trip
 *   byte-deep with stable canonical identity — CJK, astral math letters,
 *   ZWJ emoji families, combining marks, bidi controls, paragraph/line
 *   separators, control characters (except NUL), tabs.
 *
 * Q2 (representability family): U+0000 cannot live in jsonb TEXT at all
 *   (D-F01 family), and an UNPAIRED SURROGATE is not valid UTF-8 — the
 *   corpus drives both through the wire and pins the observed failure mode
 *   (structured rejection vs silent replacement vs 500) as ledger evidence.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ContentDocumentV1 } from "@exam/domain";
import {
  ContentDocumentV1Schema,
  canonicalizeContentDocument,
} from "@exam/contracts";
import { canonicalAnswerIdentity } from "@exam/exam-engine";
import { UNICODE_CORPUS } from "./generators.js";
import { CampaignRecorder } from "./campaignStats.js";
import { buildRichAttemptFixture, type RichAttemptFixture } from "./fixture.js";

const recorder = new CampaignRecorder("Q-unicode-roundtrip", [0x669e0004]);

/** Corpus entries that cannot be represented by the durable store. */
const UNREPRESENTABLE: Array<{ name: string; text: string; reason: string }> = [
  {
    name: "nul-bearing",
    text: "nul-ish: \u0000\u0001\u007F",
    reason: "U+0000 cannot be encoded in jsonb text (D-F01 family)",
  },
  {
    name: "lone-surrogate",
    text: "lone surrogate half: \uD83D",
    reason: "unpaired surrogate is not valid UTF-8",
  },
];

const SURVIVABLE = UNICODE_CORPUS.filter(
  (text) => !UNREPRESENTABLE.some((u) => u.text === text),
);

function runDoc(text: string): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

describe("Campaign Q — Unicode corpus × durable round-trip (L4)", () => {
  let fx: RichAttemptFixture;
  let seq: number;
  let version: number;

  beforeAll(async () => {
    fx = await buildRichAttemptFixture("Q unicode prompt");
    seq = 0;
    version = 0;
  }, 120_000);

  afterAll(async () => {
    recorder.flush();
    await fx.ctx.cleanup();
  });

  it("Q1: every jsonb-representable corpus string round-trips byte-deep with stable identity", async () => {
    const violations: string[] = [];
    let survived = 0;
    for (const [i, text] of SURVIVABLE.entries()) {
      seq += 1;
      const doc = runDoc(text);
      // Authority expectation FIRST: empty runs legally collapse (Campaign A
      // as-built), so the round-trip target is the canonical value.
      const verdict = canonicalizeContentDocument(
        ContentDocumentV1Schema.parse(doc),
      );
      if (!verdict.ok) {
        violations.push(
          `[${i}] ${JSON.stringify(text)}: authority rejected its own accepted input`,
        );
        continue;
      }
      const res = await fx.postAnswer(doc, seq, version);
      if (res.statusCode !== 200 || res.json().accepted !== true) {
        violations.push(
          `[${i}] ${JSON.stringify(text)}: wire rejected — HTTP ${res.statusCode} ${res.body.slice(0, 160)}`,
        );
        continue;
      }
      version = res.json().serverVersion as number;
      const slot = fx.slotOf(await fx.getAttemptBody()) as Record<
        string,
        unknown
      >;
      const served = slot.answer as ContentDocumentV1;
      try {
        expect(served).toEqual(verdict.value);
      } catch {
        violations.push(
          `[${i}] ${JSON.stringify(text)}: read-back mutated\n  served: ${JSON.stringify(served)?.slice(0, 200)}`,
        );
        continue;
      }
      if (
        canonicalAnswerIdentity(served) !==
        canonicalAnswerIdentity(verdict.value)
      ) {
        violations.push(`[${i}] ${JSON.stringify(text)}: identity drift`);
        continue;
      }
      survived += 1;
      recorder.record({
        probe: "survivable",
        outcome: "round-trip",
        sample: JSON.stringify(text).slice(0, 60),
      });
    }
    expect(violations, `counterexamples:\n${violations.join("\n")}`).toEqual(
      [],
    );
    // Census: the corpus must be big enough to mean something.
    expect(survived).toBeGreaterThanOrEqual(10);
  });

  it("Q2: the unrepresentable family — observed failure mode pinned as ledger evidence", async () => {
    for (const u of UNREPRESENTABLE) {
      seq += 1;
      const thisSeq = seq;
      const res = await fx.postAnswer(runDoc(u.text), thisSeq, version);
      const observed =
        res.statusCode === 200
          ? res.json().accepted
            ? "accepted"
            : `rejected:${res.json().reason}`
          : `http-${res.statusCode}`;
      recorder.record({
        probe: `unrepresentable-${u.name}`,
        outcome: observed,
        reason: u.reason,
        body: res.body.slice(0, 300),
      });

      if (res.statusCode === 200 && res.json().accepted === true) {
        // Accepted — then it MUST round-trip byte-deep (a silent replacement
        // is a round-trip violation, not a pass).
        version = res.json().serverVersion as number;
        const slot = fx.slotOf(await fx.getAttemptBody()) as Record<
          string,
          unknown
        >;
        expect(
          slot.answer,
          `${u.name}: accepted but the stored value is not the sent value (silent ${u.reason})`,
        ).toEqual(runDoc(u.text));
        continue;
      }
      if (res.statusCode === 200) {
        // Structured rejection: legal outcome — the wire refuses what it
        // cannot store, with a reason, writing nothing.
        expect(
          await slotUntouched(fx, version),
          `${u.name}: rejected write moved state`,
        ).toBe(true);
        const probe = await fx.postAnswer(
          runDoc(`Q receipt-probe after ${u.name}`),
          thisSeq,
          version,
        );
        expect(
          probe.json().accepted,
          `${u.name}: rejected write leaked a receipt`,
        ).toBe(true);
        version = probe.json().serverVersion as number;
        continue;
      }
      // HTTP-level failure (the D-F01 family): containment must hold — no
      // durable write, no receipt leak.
      expect(
        await slotUntouched(fx, version),
        `${u.name}: failed write moved state`,
      ).toBe(true);
      const probe = await fx.postAnswer(
        runDoc(`Q receipt-probe after ${u.name}`),
        thisSeq,
        version,
      );
      expect(
        probe.json().accepted,
        `${u.name}: failed write leaked a receipt`,
      ).toBe(true);
      version = probe.json().serverVersion as number;
    }
  });
});

async function slotUntouched(
  fx: RichAttemptFixture,
  expectedVersion: number,
): Promise<boolean> {
  const slot = fx.slotOf(await observedGet(fx)) as Record<string, unknown>;
  return slot.version === expectedVersion;
}

/**
 * Characterization instrument for the transient 503 AUTHZ_UNAVAILABLE seen
 * after failed jsonb writes: records every non-200 and probes persistence
 * instead of letting the harness die on the phenomenon it is measuring.
 */
async function observedGet(
  fx: RichAttemptFixture,
): Promise<Record<string, unknown>> {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fx.getAttemptRaw();
    statuses.push(res.statusCode);
    if (res.statusCode === 200) {
      if (statuses.length > 1) {
        recorder.record({
          probe: "authz-503-characterization",
          outcome: "transient",
          statuses,
        });
      }
      return res.json();
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  recorder.record({
    probe: "authz-503-characterization",
    outcome: "persistent",
    statuses,
  });
  throw new Error(
    `GET attempt persistently failing: statuses ${statuses.join(",")}`,
  );
}
