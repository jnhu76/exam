import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorResponseSchema, type ClientEvent } from "@exam/contracts";
import { postClientEvents, KEEPALIVE_MAX_BODY_BYTES } from "./clientEvents";

function makeEvent(name = "test.event"): ClientEvent {
  return {
    kind: "log",
    level: "info",
    name,
    occurredAt: "2026-06-25T00:00:00.000Z",
  };
}

/** Minimal fetch mock that records the body and replies with a JSON envelope. */
function mockFetch(
  responder: (
    url: string,
    init: RequestInit,
  ) => { ok: boolean; status: number; json: () => unknown },
) {
  const calls: { url: unknown; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responder(url, init);
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.json(),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

describe("postClientEvents — success semantics (H4)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("acknowledges the full batch when the server accepted it", async () => {
    const { fn } = mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ accepted: 2 }),
    }));
    const result = await postClientEvents([makeEvent(), makeEvent()]);
    expect(result).toEqual({ acknowledgedCount: 2, rejected: [] });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns an empty classification for an empty batch without a network round-trip", async () => {
    // Nothing to send and nothing unconfirmed — a round-trip would be an
    // unobserved side effect; the buffer short-circuits empty queues anyway.
    const { fn } = mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ accepted: 0 }),
    }));
    const result = await postClientEvents([]);
    expect(result).toEqual({ acknowledgedCount: 0, rejected: [] });
    expect(fn).not.toHaveBeenCalled();
  });

  it("leaves every event unconfirmed when the server accepts 0 of a non-empty batch (data-loss signal)", async () => {
    // H4: a non-empty batch that the server reports as 0 accepted is NOT an
    // acknowledgment; the buffer keeps retrying instead of dropping silently.
    const { fn } = mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ accepted: 0 }),
    }));
    const result = await postClientEvents([makeEvent(), makeEvent()]);
    expect(result).toEqual({ acknowledgedCount: 0, rejected: [] });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("leaves events unconfirmed on non-2xx", async () => {
    mockFetch(() => ({ ok: false, status: 500, json: () => ({}) }));
    await expect(postClientEvents([makeEvent()])).resolves.toEqual({
      acknowledgedCount: 0,
      rejected: [],
    });
  });

  it("leaves events unconfirmed on malformed response body", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ weird: true }), // no `accepted`
    }));
    await expect(postClientEvents([makeEvent()])).resolves.toEqual({
      acknowledgedCount: 0,
      rejected: [],
    });
  });

  it("never throws on network failure (swallows)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    await expect(postClientEvents([makeEvent()])).resolves.toEqual({
      acknowledgedCount: 0,
      rejected: [],
    });
  });
});

describe("postClientEvents — keepalive payload split (H6)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("splits an oversized batch into multiple requests under the byte cap", async () => {
    // Build two events whose COMBINED JSON exceeds the cap but each fits alone.
    // Each event serializes well under 64KiB, but two together overflow.
    const big = "x".repeat(Math.floor(KEEPALIVE_MAX_BODY_BYTES / 2));
    const events = [
      { ...makeEvent("big.one"), metadata: { blob: big } },
      { ...makeEvent("big.two"), metadata: { blob: big } },
    ];
    const { fn } = mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ accepted: 1 }),
    }));
    const result = await postClientEvents(events);
    expect(result).toEqual({ acknowledgedCount: 2, rejected: [] });
    // The two events must be split across at least 2 requests.
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
    // No single request body exceeds the cap.
    for (const call of fn.mock.calls) {
      const init = call[1] as RequestInit;
      const bodyLen = String(init.body ?? "").length;
      expect(bodyLen).toBeLessThanOrEqual(KEEPALIVE_MAX_BODY_BYTES);
    }
  });

  it("drops an event that cannot fit even alone, keeps the rest", async () => {
    // One absurdly large event + one normal event.
    const absurd = "y".repeat(KEEPALIVE_MAX_BODY_BYTES * 2);
    const events = [
      { ...makeEvent("absurd"), metadata: { blob: absurd } },
      makeEvent("normal"),
    ];
    const { fn } = mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ accepted: 1 }),
    }));
    const result = await postClientEvents(events);
    // Only the sendable event was sent and acknowledged; the unsendable one
    // is reported as unconfirmed (the buffer keeps it pending — #874 PR-W).
    expect(result).toEqual({ acknowledgedCount: 1, rejected: [] });
    expect(fn.mock.calls.length).toBe(1);
    const sentBody = String((fn.mock.calls[0]![1] as RequestInit).body ?? "");
    expect(sentBody).toContain("normal");
    expect(sentBody).not.toContain("absurd");
  });
});

// #874 PR-W transport result contract. The wire protocol is UNCHANGED
// (200 {accepted: n} / standard 400 VALIDATION_ERROR envelope); what changes
// is the INTERNAL result the transport hands the buffer: instead of a boolean
// that conflates "server rejected the batch" with "network/server outcome
// unknown", the transport now classifies each round trip so the buffer can
// isolate determinately-rejected events without guessing.
describe("postClientEvents — send result classification (#874 PR-W)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  /**
   * A standard 400 VALIDATION_ERROR body, shaped exactly like the real
   * envelope produced by apps/api errorResponse.ts (details.fields with the
   * Zod issue path joined by "."). Guarded by the REAL contracts schema —
   * the classification must never depend on an invented shape.
   */
  function standard400(fields: Array<{ field: string; code?: string }>) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: {
          fields: fields.map((f) => ({
            field: f.field,
            code: f.code ?? "CUSTOM",
            message: "invalid",
          })),
        },
        requestId: "req-prw-test",
      },
    };
  }

  it("acknowledges a full batch on 200 accepted = n", async () => {
    mockFetch(() => ({ ok: true, status: 200, json: () => ({ accepted: 3 }) }));
    await expect(
      postClientEvents([makeEvent(), makeEvent(), makeEvent()]),
    ).resolves.toEqual({ acknowledgedCount: 3, rejected: [] });
  });

  it("maps a standard 400 VALIDATION_ERROR field path to a deterministic per-event rejection", async () => {
    const body = standard400([{ field: "events.1.occurredAt" }]);
    expect(ErrorResponseSchema.safeParse(body).success).toBe(true);
    mockFetch(() => ({ ok: false, status: 400, json: () => body }));
    await expect(
      postClientEvents([makeEvent("a"), makeEvent("b"), makeEvent("c")]),
    ).resolves.toEqual({
      acknowledgedCount: 0,
      rejected: [{ index: 1, fields: ["occurredAt"] }],
    });
  });

  it("reports every determinately invalid event of an all-invalid batch", async () => {
    mockFetch(() => ({
      ok: false,
      status: 400,
      json: () =>
        standard400([
          { field: "events.0.occurredAt" },
          { field: "events.1.occurredAt" },
        ]),
    }));
    await expect(
      postClientEvents([makeEvent("a"), makeEvent("b")]),
    ).resolves.toEqual({
      acknowledgedCount: 0,
      rejected: [
        { index: 0, fields: ["occurredAt"] },
        { index: 1, fields: ["occurredAt"] },
      ],
    });
  });

  it("treats a standard 400 whose indices fall OUTSIDE this sub-batch as unconfirmed (no guessing) and flags the protocol anomaly", async () => {
    mockFetch(() => ({
      ok: false,
      status: 400,
      json: () => standard400([{ field: "events.9.occurredAt" }]),
    }));
    await expect(
      postClientEvents([makeEvent("a"), makeEvent("b")]),
    ).resolves.toEqual({
      acknowledgedCount: 0,
      rejected: [],
      protocolAnomaly: {
        status: 400,
        reason: "http_400_without_usable_event_indices",
      },
    });
  });

  it("treats a standard 400 with only batch-level paths (no event index) as unconfirmed with a protocol anomaly", async () => {
    mockFetch(() => ({
      ok: false,
      status: 400,
      json: () => standard400([{ field: "events" }, { field: "_root" }]),
    }));
    await expect(postClientEvents([makeEvent("a")])).resolves.toEqual({
      acknowledgedCount: 0,
      rejected: [],
      protocolAnomaly: {
        status: 400,
        reason: "http_400_without_usable_event_indices",
      },
    });
  });

  it("treats a NON-standard 400 (no error envelope) as unconfirmed with a protocol anomaly, never as a rejection", async () => {
    mockFetch(() => ({
      ok: false,
      status: 400,
      json: () => ({ boom: true }),
    }));
    await expect(postClientEvents([makeEvent("a")])).resolves.toEqual({
      acknowledgedCount: 0,
      rejected: [],
      protocolAnomaly: {
        status: 400,
        reason: "http_400_without_usable_event_indices",
      },
    });
  });

  it.each([401, 403, 429, 500])(
    "treats HTTP %i as unconfirmed — auth/rate-limit/server state is never event-content evidence",
    async (status) => {
      mockFetch(() => ({
        ok: false,
        status,
        json: () => ({
          error: {
            code: "AUTH_REQUIRED",
            message: "no",
            requestId: "req-x",
          },
        }),
      }));
      await expect(postClientEvents([makeEvent("a")])).resolves.toEqual({
        acknowledgedCount: 0,
        rejected: [],
      });
    },
  );

  it("treats a 200 that does not confirm the whole sub-batch as unconfirmed", async () => {
    mockFetch(() => ({ ok: true, status: 200, json: () => ({ accepted: 1 }) }));
    await expect(
      postClientEvents([makeEvent("a"), makeEvent("b")]),
    ).resolves.toEqual({ acknowledgedCount: 0, rejected: [] });
  });

  it("maps a malformed 200 body and a network failure to unconfirmed", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ weird: true }),
    }));
    await expect(postClientEvents([makeEvent("a")])).resolves.toEqual({
      acknowledgedCount: 0,
      rejected: [],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    await expect(postClientEvents([makeEvent("a")])).resolves.toEqual({
      acknowledgedCount: 0,
      rejected: [],
    });
  });

  it("maps sub-batch rejection indices back to the ORIGINAL batch indices", async () => {
    // Two big events force a split after the first: sub-batch 1 = [a],
    // sub-batch 2 = [b, c]. A rejection at sub-batch-2 LOCAL index 1 is
    // event c — ORIGINAL index 2.
    const big = "x".repeat(35_000);
    const small = "s".repeat(5_000);
    const events = [
      { ...makeEvent("a"), metadata: { blob: big } },
      { ...makeEvent("b"), metadata: { blob: big } },
      { ...makeEvent("c"), metadata: { blob: small } },
    ];
    const { fn } = mockFetch((url, init) => {
      const sent = JSON.parse(String(init.body)) as {
        events: Array<{ name: string }>;
      };
      if (sent.events.some((e) => e.name === "c")) {
        return {
          ok: false,
          status: 400,
          json: () => standard400([{ field: "events.1.occurredAt" }]),
        };
      }
      return { ok: true, status: 200, json: () => ({ accepted: 1 }) };
    });
    const result = await postClientEvents(events);
    expect(result).toEqual({
      acknowledgedCount: 1, // event a confirmed; b's sub-batch stopped the flush
      rejected: [{ index: 2, fields: ["occurredAt"] }],
    });
    // Two round trips: [a] then [b, c].
    expect(fn.mock.calls.length).toBe(2);
  });
});
