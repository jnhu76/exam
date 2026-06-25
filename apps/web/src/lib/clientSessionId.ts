/**
 * Stable per-tab client-session identifier for exam telemetry. Generated once
 * per browser tab and persisted in `sessionStorage`, so it survives in-tab
 * refreshes but resets when the tab closes (no cross-tab leakage).
 *
 * Used as `clientSessionId` on every exam telemetry event, letting a reviewer
 * reconstruct one continuous exam-session's frontend flow across reloads.
 */

/** sessionStorage key under which the id is persisted. */
export const CLIENT_SESSION_ID_KEY = "exam.clientSessionId";

/** Sentinel returned when not running in a browser (SSR / tests w/o DOM). */
const NON_BROWSER_SENTINEL = "ssr";

/** Returns true when running in a browser with `sessionStorage`. */
function hasBrowserStorage(): boolean {
  return typeof window !== "undefined" && !!window.sessionStorage;
}

/** Safely reads the persisted id, or null on any failure. */
function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(CLIENT_SESSION_ID_KEY);
  } catch {
    return null;
  }
}

/** Safely persists the id; failures are swallowed (id is still returned). */
function store(id: string): void {
  try {
    window.sessionStorage.setItem(CLIENT_SESSION_ID_KEY, id);
  } catch {
    // Best-effort persistence; the in-memory id remains usable for this tab.
  }
}

/**
 * Returns the stable per-tab session id, generating and persisting it on first
 * use. Never throws: on any storage failure it falls back to a freshly
 * generated id that lives for the page lifetime.
 */
export function getClientSessionId(): string {
  if (!hasBrowserStorage()) return NON_BROWSER_SENTINEL;

  const existing = readStored();
  if (existing) return existing;

  let id: string;
  try {
    id = crypto.randomUUID();
  } catch {
    id = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;
  }
  store(id);
  return id;
}
