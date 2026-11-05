/**
 * Guarded opaque-id generator (RFC-4122 v4-shaped).
 *
 * Single implementation authority for every client-generated identifier
 * (per-tab clientSessionId, per-event eventId). The guard chain exists
 * because the exam platform is LAN/on-premise and may be served over plain
 * HTTP at a raw IP, where `crypto.randomUUID` is undefined (secure-context
 * only) and calling it would throw: prefer randomUUID, fall back to a manual
 * v4 UUID from `crypto.getRandomValues` (NOT secure-context gated), then to
 * Math.random. The "never throws" contract holds unconditionally.
 */
export function generateOpaqueId(): string {
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
  // Fallback 1: RFC-4122 v4 via getRandomValues (available in all contexts,
  // including plain-HTTP raw-IP origins — not gated behind secure context).
  if (typeof crypto?.getRandomValues === "function") {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      // Per RFC 4122 §4.4: set version (4) and variant (10xx).
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
        .slice(6, 8)
        .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    } catch {
      // fall through to Math.random fallback
    }
  }
  // Fallback 2: Math.random-based id (no Web Crypto available at all). Not a
  // standards-conformant UUID, but unique enough for a per-tab session id.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
