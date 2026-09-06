import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
// Initialize i18next + react-i18next once for all tests so components using
// useTranslation()/t() resolve keys against the zh-CN catalog (mirrors the
// production bootstrap in src/main.tsx).
import "@/i18n";

if (typeof window !== "undefined") {
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!window.HTMLElement.prototype.setPointerCapture) {
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
  }
  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  }
  if (!HTMLAnchorElement.prototype.click) {
    HTMLAnchorElement.prototype.click = vi.fn();
  }
}

// jsdom ships no ResizeObserver; Radix popper/measurement primitives
// (Tooltip, Popover, floating content) call it from layout effects. A
// no-op observer keeps those components openable in jsdom (positioning
// itself is real-DOM territory, covered by E2E).
if (typeof window !== "undefined" && !window.ResizeObserver) {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  window.ResizeObserver = ResizeObserverStub;
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => "blob:mock");
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}

// jsdom's Blob implements arrayBuffer()/text()/bytes() but NOT stream()
// (verified against jsdom@29.1.1 living/file-api/Blob-impl.js). The vitest
// jsdom env exposes Node/undici's native global `Response`, and constructing
// `new Response(blob)` consumes the Blob body via the WHATWG Body init, which
// calls `blob.stream()` — throwing `object.stream is not a function` at
// construction time. This cross-realm mismatch (jsdom Blob + Node Response)
// breaks any test that builds a Response from a Blob body (e.g. the CSV
// download test). Polyfill stream() to return a spec-shaped ReadableStream
// over the Blob's bytes so Response<Blob> round-trips. Production browsers
// provide a real Blob.prototype.stream(); this is test-infra only.
//
// IMPORTANT: read bytes via the PUBLIC `arrayBuffer()` (jsdom copies the impl
// `_bytes` into the target realm and returns them — see Blob-impl.js
// `arrayBuffer()`). Do NOT reach into the private `_bytes` field: it lives on
// the internal `BlobImpl`, not the public wrapper, so `(blob as any)._bytes`
// is `undefined` on the user-facing object (jsdom explicitly documents that it
// "never expose[s] this._bytes ... directly to the user"). Reading it silently
// yields an empty stream, which makes every Blob Response body appear empty.
if (
  typeof Blob !== "undefined" &&
  typeof Blob.prototype.stream !== "function"
) {
  Object.defineProperty(Blob.prototype, "stream", {
    configurable: true,
    writable: true,
    value: function stream(): ReadableStream<Uint8Array> {
      const blob = this as Blob;
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new Uint8Array(await blob.arrayBuffer()));
          controller.close();
        },
      });
    },
  });
}

// jsdom does not implement the Web Locks API, but the cross-tab pending-grant
// coordinator (REC-I4-C1) hard-requires `navigator.locks` — without it the
// read-check-write over localStorage is not atomic, so the coordinator fails
// closed (throws) rather than silently degrading. To exercise the REAL
// production coordinator singleton in page/component tests (jsdom), install a
// minimal single-process lock manager here. It serializes callbacks per lock
// name exactly like the real API's "held" semantics, which is sufficient for
// the single-tab coverage exercised by jsdom tests (cross-tab behavior is
// covered by the Playwright E2E in apps/e2e). This polyfill is test-only;
// production browsers provide a real navigator.locks.
if (
  typeof navigator !== "undefined" &&
  !(navigator as { locks?: unknown }).locks
) {
  const held = new Map<string, boolean>();
  const queue = new Map<string, Array<() => void>>();
  const request = async <T>(
    name: string,
    callback: (lock: { name: string } | null) => Promise<T>,
  ): Promise<T> => {
    while (held.get(name)) {
      await new Promise<void>((resolve) => {
        if (!queue.has(name)) queue.set(name, []);
        queue.get(name)!.push(resolve);
      });
    }
    held.set(name, true);
    try {
      return await callback({ name });
    } finally {
      held.set(name, false);
      const q = queue.get(name);
      if (q && q.length > 0) q.shift()!();
    }
  };
  Object.defineProperty(navigator, "locks", {
    value: { request },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});
