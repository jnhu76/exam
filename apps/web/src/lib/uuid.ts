/**
 * Context-safe UUID v4 generator for the exam web client.
 *
 * `crypto.randomUUID` requires a secure context (HTTPS or localhost). The exam
 * platform is LAN/on-premise and may be served over plain HTTP at a raw IP
 * (not localhost), where `crypto.randomUUID` is `undefined` and calling it
 * throws — which would crash any flow that mints an identity (e.g. the proctor
 * time-grant dialog's operationId). We guard for that and fall back to a manual
 * RFC-4122 v4 UUID built from `crypto.getRandomValues`, which is available in
 * all contexts (it is NOT gated behind secure context, unlike randomUUID or
 * crypto.subtle). A final Math.random-based fallback covers the theoretical
 * case where `crypto` is entirely absent, so this function never throws.
 *
 * Returns a string that satisfies `z.string().uuid()`. The Math.random
 * fallback produces a format-conformant UUID but is NOT cryptographically
 * strong; it is only a last resort for environments without Web Crypto.
 */

export function createContextSafeUuid(): string {
  // Path 1: native randomUUID (secure-context only).
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // secure-context rejection or other failure — fall through to fallback.
  }

  // Path 2: RFC-4122 v4 via getRandomValues (available in all contexts,
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
      // fall through to Math.random fallback.
    }
  }

  // Path 3: Math.random-based id (no Web Crypto available at all). Format-
  // conformant UUID v4, but not cryptographically strong — a last resort so
  // the never-throws contract holds unconditionally.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
