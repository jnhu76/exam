import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientEvent } from "@exam/contracts";
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

  it("returns true when server accepted the full batch", async () => {
    const { fn } = mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ accepted: 2 }),
    }));
    const ok = await postClientEvents([makeEvent(), makeEvent()]);
    expect(ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns true for a genuinely empty batch (no-op success)", async () => {
    // accepted:0 with no events sent is a legitimate empty flush, not failure.
    const { fn } = mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ accepted: 0 }),
    }));
    const ok = await postClientEvents([]);
    // Empty batch: still a clean round-trip.
    expect(ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns FALSE when events were sent but server accepted 0 (data loss signal)", async () => {
    // H4: a non-empty batch that the server reports as 0 accepted is treated
    // as failure so the buffer can retry/drop per policy, not silently OK.
    const { fn } = mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ accepted: 0 }),
    }));
    const ok = await postClientEvents([makeEvent(), makeEvent()]);
    expect(ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns false on non-2xx", async () => {
    mockFetch(() => ({ ok: false, status: 500, json: () => ({}) }));
    await expect(postClientEvents([makeEvent()])).resolves.toBe(false);
  });

  it("returns false on malformed response body", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ weird: true }), // no `accepted`
    }));
    await expect(postClientEvents([makeEvent()])).resolves.toBe(false);
  });

  it("never throws on network failure (swallows)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    await expect(postClientEvents([makeEvent()])).resolves.toBe(false);
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
    const ok = await postClientEvents(events);
    expect(ok).toBe(true);
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
    const ok = await postClientEvents(events);
    expect(ok).toBe(true);
    // Only the normal event is sent.
    expect(fn.mock.calls.length).toBe(1);
    const sentBody = String((fn.mock.calls[0]![1] as RequestInit).body ?? "");
    expect(sentBody).toContain("normal");
    expect(sentBody).not.toContain("absurd");
  });
});
