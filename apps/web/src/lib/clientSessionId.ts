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
 *
 * `crypto.randomUUID` requires a secure context (HTTPS or localhost). The exam
 * platform is LAN/on-premise and may be served over plain HTTP at a raw IP
 * (not localhost), where `crypto.randomUUID` is `undefined` and calling it
 * throws — which would crash the exam flow (e.g. enterExam's navigate). We
 * guard for that and fall back to a manual RFC-4122 v4 UUID built from
 * `crypto.getRandomValues`, which is available in all contexts.
 */
function generateId(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // secure-context rejection or other failure — fall through to fallback
  }
  // Fallback: RFC-4122 v4 via getRandomValues (available in all contexts,
  // including plain-HTTP raw-IP origins).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Per RFC 4122 §4.4: set version (4) and variant (10xx).
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

export function getClientSessionId(): string {
  if (!hasBrowserStorage()) return NON_BROWSER_SENTINEL;

  const existing = readStored();
  if (existing) return existing;

  const id = generateId();
  store(id);
  return id;
}
