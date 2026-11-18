// Node ≥26 ships native Web Storage on its global (sessionStorage as a real
// instance; localStorage as an own accessor resolving to undefined without
// --localstorage-file). vitest's jsdom env copies a jsdom-window key onto the
// test global only when that key is NOT already present on the Node global —
// its hardcoded copy list contains "Storage" but neither "sessionStorage" nor
// "localStorage" (vitest populateGlobal → getWindowKeys). On Node 26 that
// leaves a split realm: bare/window `sessionStorage` is the native instance,
// `localStorage` is undefined, while bare `Storage` IS jsdom's class. Every
// test that spies on `Storage.prototype` then fails to intercept production
// reads of `window.sessionStorage`, and bare `localStorage.clear()` throws.
// Node <26 has no native storage, so populateGlobal binds the jsdom instances
// itself and nothing needs to change.
//
// Bind the jsdom realm's storage onto the test global ONLY while the alias
// invariant does not already hold — on Node <26 vitest's own binding is left
// untouched. Production code reads `window.…`, and window === globalThis in
// the vitest jsdom env, so the bound instance is the object the app reads and
// `Storage.prototype` spies hit exactly that storage.
//
// INVARIANT after binding: bare `sessionStorage` === `window.sessionStorage`
// === the jsdom instance, likewise `localStorage`, and
// Object.getPrototypeOf(instance) === bare `Storage.prototype` (jsdom realm).
// The accessor reaches the captured jsdom window through a closure local and
// never re-reads `globalThis[...]`, so it cannot re-enter itself (the
// consecutive alias reads after defineProperty fail loudly with RangeError if
// it ever did). The setter mirrors populateGlobal's override semantics so
// assigning to `window.sessionStorage` keeps the same meaning on both
// runtimes; the descriptor stays configurable so the storage_unavailable
// swap/restore cycle keeps working.

const STORAGE_KEYS = ["sessionStorage", "localStorage"] as const;

export function bindJsdomBrowserStorage(): void {
  if (typeof window === "undefined") return;
  const win = (
    globalThis as typeof globalThis & {
      jsdom?: { window?: Window };
    }
  ).jsdom?.window;
  if (!win) return;
  const overrides = new Map<string, unknown>();
  for (const key of STORAGE_KEYS) {
    // Node <26: populateGlobal already aliases the jsdom instance here.
    if (globalThis[key] === win[key]) continue;
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get() {
        return overrides.has(key) ? overrides.get(key) : win[key];
      },
      set(value) {
        overrides.set(key, value);
      },
    });
    if (globalThis[key] !== win[key]) {
      throw new Error(
        `test-env storage binding failed: globalThis.${key} does not alias the jsdom window instance`,
      );
    }
    if (globalThis[key] !== globalThis[key]) {
      throw new Error(
        `test-env storage binding for ${key} is unstable across reads`,
      );
    }
  }
  // Prototype match is what lets `vi.spyOn(Storage.prototype, …)` intercept
  // the objects the app reads — assert it instead of assuming it.
  if (
    Object.getPrototypeOf(globalThis.sessionStorage) !==
      globalThis.Storage.prototype ||
    Object.getPrototypeOf(globalThis.localStorage) !==
      globalThis.Storage.prototype
  ) {
    throw new Error(
      "test-env storage binding failed: bound storage prototypes do not match Storage.prototype",
    );
  }
}
