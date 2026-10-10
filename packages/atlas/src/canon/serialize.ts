/**
 * Canonical hashing and serialization (ir §7 ATLAS-IR-060..-062).
 *
 * same semantic input ⇒ byte-identical normalized representation.
 * One key-order rule everywhere: object keys serialized sorted (recursively,
 * by Unicode code unit — Atlas IDs and field names are ASCII, where code-unit
 * order equals code-point order). No floating-point values ever reach this
 * layer (ATLAS-IR-070).
 */

import { createHash } from "node:crypto";

export function sha256Hex(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Recursively sort object keys; arrays keep order (caller sorted them). */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** The canonical JSON text of a value: sorted keys, 2-space indent. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

/** Canonical bytes of a value. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

/** SHA-256 of the canonical form (the normalized-body hash). */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
