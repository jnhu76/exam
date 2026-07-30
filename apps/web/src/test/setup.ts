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

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => "blob:mock");
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
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
