/**
 * Canonical payload + replay/conflict helpers for the durable Attempt command
 * receipt (J5-I1C Slice 1 / J5-I1C0 audit §4.5, §8).
 *
 * The two dangerous Attempt commands (`force_submit`, `misconduct_mark`) share
 * one `attempt_command_receipts` table arbitrated by
 * `UNIQUE(organization_id, operation_id)`. Replay/conflict is decided by
 * comparing the canonical `request_payload` of the incoming command against the
 * stored receipt row (audit §4.5). These helpers implement that comparison in
 * ONE place so the future orchestrators (Slices 2/3) do not hand-roll
 * `JSON.stringify(a) === JSON.stringify(b)` per command.
 *
 * The equality primitive here is the canonical jsonb comparison: object-key
 * order insensitive (PostgreSQL jsonb canonicalizes key order), array order
 * preserved, null/undefined semantics preserved. It is the same rule as the
 * `payloadsEqual` in `@exam/exam-engine` incident/time-grant commands; this
 * module is the leaf-node (no internal dependency) home so both the engine and
 * the future api orchestrators can import it without a cycle.
 *
 * This module is dependency-free. The `@exam/contracts` Zod schemas
 * (`ForceSubmitRequestPayloadSchema`, `MisconductMarkRequestPayloadSchema`,
 * `AttemptCommandTypeSchema`) are the wire-level projection of the canonical
 * shapes defined here; contracts depends on domain, never the reverse.
 */

// ── Canonical command identity (leaf-level) ────────────────────────

import type { AttemptStatus } from "./enums.js";
import type { MisconductFlag } from "./types.js";

/**
 * The two dangerous Attempt commands sharing one receipt table. This is the
 * domain-level canonical literal union; the contract layer mirrors it as
 * `AttemptCommandTypeSchema` (single source of truth is this union).
 */
export type AttemptCommandType = "force_submit" | "misconduct_mark";

/**
 * Canonical `force_submit` request payload stored in a receipt's
 * `request_payload` jsonb (audit §4.1/§4.2). `reason` is REQUIRED and
 * non-empty after trim (J5-R0 §8.1 upgraded it to server-required; the
 * durable shape never contains null/blank).
 */
export interface ForceSubmitRequestPayload {
  reason: string;
}

/**
 * Canonical `misconduct_mark` request payload stored in a receipt's
 * `request_payload` jsonb (audit §4.3/§4.4). `severity` is the validated
 * literal; `notes` is trimmed and non-empty.
 */
export interface MisconductMarkRequestPayload {
  severity: "warning" | "serious";
  notes: string;
}

/** Union of the canonical per-command request payloads. */
export type AttemptCommandRequestPayload =
  | ForceSubmitRequestPayload
  | MisconductMarkRequestPayload;

/**
 * Canonical `force_submit` result payload stored in a receipt's
 * `result_payload` jsonb (audit §4.2). The immutable committed fact: the
 * statuses observed under the EA lock and the attempt timestamps at commit —
 * returned verbatim on replay, NEVER re-derived from the live attempt.
 * Timestamps are ISO-8601 strings (the jsonb wire shape). `commandType` is
 * duplicated inside the payload so the stored fact is self-describing and the
 * discriminated union is usable at the db layer.
 */
export interface ForceSubmitResultPayload {
  commandType: "force_submit";
  beforeStatus: AttemptStatus;
  afterStatus: AttemptStatus;
  submittedAt: string | null;
  gradedAt: string | null;
  appliedAt: string;
}

/**
 * Canonical `misconduct_mark` result payload stored in a receipt's
 * `result_payload` jsonb (audit §4.4). The immutable committed fact: the
 * MisconductFlag this receipt establishes (null on no_change) and the
 * receipt's server time.
 */
export interface MisconductMarkResultPayload {
  commandType: "misconduct_mark";
  misconduct: MisconductFlag | null;
  appliedAt: string;
}

/** Union of the canonical per-command result payloads. */
export type AttemptCommandResultPayload =
  | ForceSubmitResultPayload
  | MisconductMarkResultPayload;

// ── Canonical jsonb equality primitive ─────────────────────────────

/**
 * Recursively sort object keys for order-insensitive JSON comparison. Mirrors
 * the PostgreSQL jsonb key-order canonicalization so a stored payload and a
 * freshly-built payload compare equal regardless of insertion order.
 */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Canonical payload equality for the idempotency contract (audit §4.5). Object
 * key order insensitive, array order preserved, primitive strict-equality.
 * This is the ONE implementation for Attempt command receipts; the future
 * orchestrators must call it instead of hand-rolled JSON compare.
 */
export function attemptCommandPayloadsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

// ── Per-command canonicalization ───────────────────────────────────

/**
 * Canonicalize a `force_submit` request into the durable `request_payload`
 * shape stored in the receipt. The input accepts the operation-aware wire
 * shape (`reason` required — J5-R0 §8.1) and applies trim; a blank-after-trim
 * reason throws so the canonical form is never ambiguous (mirrors
 * {@link canonicalizeMisconductPayload}).
 *
 * Canonical rules (frozen by tests):
 *   - `reason` is trimmed.
 *   - missing / blank-after-trim → throw (the wire layer already rejects
 *     these; this helper makes the canonical form unambiguous).
 */
export function canonicalizeForceSubmitPayload(input: {
  reason: string;
}): ForceSubmitRequestPayload {
  const trimmedReason = input.reason.trim();
  if (trimmedReason.length === 0) {
    throw new Error(
      "force_submit canonical payload requires a non-empty reason after trim (J5-R0 §8.1)",
    );
  }
  return { reason: trimmedReason };
}

/**
 * Canonicalize a `misconduct_mark` request into the durable `request_payload`
 * shape. `severity` is the validated literal; `notes` is trimmed and must be
 * non-empty after trim (the contract layer already enforces 1..1000; this
 * helper throws if handed a blank string so the canonical form is never
 * ambiguous).
 */
export function canonicalizeMisconductPayload(input: {
  severity: "warning" | "serious";
  notes: string;
}): MisconductMarkRequestPayload {
  const trimmedNotes = input.notes.trim();
  if (trimmedNotes.length === 0) {
    throw new Error(
      "misconduct_mark canonical payload requires non-empty notes after trim",
    );
  }
  return { severity: input.severity, notes: trimmedNotes };
}

// ── Command → input / payload type binding (compile-time) ──────────

/**
 * Per-command canonical INPUT shapes. `canonicalizeAttemptCommandRequest`
 * is generic over this map, so a `force_submit` call can only ever pass a
 * force-submit-shaped input and a `misconduct_mark` call can only ever pass a
 * misconduct-shaped input — a mismatched payload is a TypeScript error, not a
 * runtime `as` cast (overnight hardening: the previous loose union + casts
 * let both wrong combinations compile and silently canonicalize to a
 * different command's identity).
 */
export interface AttemptCommandInputByType {
  force_submit: { reason: string };
  misconduct_mark: { severity: "warning" | "serious"; notes: string };
}

/**
 * Per-command canonical PAYLOAD shapes returned by
 * {@link canonicalizeAttemptCommandRequest} (compile-time bound to the input
 * via {@link AttemptCommandInputByType}).
 */
export interface AttemptCommandPayloadByType {
  force_submit: ForceSubmitRequestPayload;
  misconduct_mark: MisconductMarkRequestPayload;
}

/**
 * Per-command canonicalizer table. Indexing this by a command type `C` yields
 * exactly `(input: AttemptCommandInputByType[C]) => AttemptCommandPayloadByType[C]`,
 * so {@link canonicalizeAttemptCommandRequest} dispatches WITHOUT any type
 * assertion — the command→input→payload binding is structural, not cast.
 */
const attemptCommandCanonicalizers: {
  [C in AttemptCommandType]: {
    canonicalize: (
      input: AttemptCommandInputByType[C],
    ) => AttemptCommandPayloadByType[C];
  };
} = {
  force_submit: { canonicalize: canonicalizeForceSubmitPayload },
  misconduct_mark: { canonicalize: canonicalizeMisconductPayload },
};

/**
 * Dispatching canonicalizer: produces the canonical `request_payload` for a
 * given command type. The `commandType` argument and the `input` argument are
 * bound together at compile time ({@link AttemptCommandInputByType} →
 * {@link AttemptCommandPayloadByType}), so a payload that belongs to a
 * different command cannot be expressed. Throws on an unknown command type so
 * a future command cannot silently reuse the wrong canonicalizer.
 */
export function canonicalizeAttemptCommandRequest<C extends AttemptCommandType>(
  commandType: C,
  input: AttemptCommandInputByType[C],
): AttemptCommandPayloadByType[C] {
  return attemptCommandCanonicalizers[commandType].canonicalize(input);
}

// ── Replay / conflict decision ─────────────────────────────────────

/** Outcome of {@link classifyAttemptCommandReplay} for a stored receipt. */
export type AttemptCommandReplayDecision =
  | { kind: "replay" }
  | { kind: "conflict"; reason: "command_type" | "attempt_id" | "payload" };

/**
 * Pure replay/conflict classifier for a stored receipt against an incoming
 * command (audit §4.5, §8 Domain conflict helper). The orchestrator slices use
 * this to decide, after the pre-read or after a 23505 race recovery, whether a
 * stored receipt is a replay (return its `result_payload` verbatim) or a
 * conflict (409 IDEMPOTENCY_CONFLICT).
 *
 * Frozen rules:
 *   - commandType differs                                          → conflict
 *   - attemptId differs                                            → conflict
 *   - canonical requestPayload differs                             → conflict
 *   - all three match                                              → replay
 *
 * This helper does NOT perform HTTP error mapping and does NOT touch the
 * database; it is a pure function over the stored receipt's identifying fields.
 */
export function classifyAttemptCommandReplay(args: {
  storedCommandType: string;
  storedAttemptId: string;
  storedRequestPayload: unknown;
  requestedCommandType: AttemptCommandType;
  requestedAttemptId: string;
  requestedCanonicalPayload: unknown;
}): AttemptCommandReplayDecision {
  if (args.storedCommandType !== args.requestedCommandType) {
    return { kind: "conflict", reason: "command_type" };
  }
  if (args.storedAttemptId !== args.requestedAttemptId) {
    return { kind: "conflict", reason: "attempt_id" };
  }
  if (
    !attemptCommandPayloadsEqual(
      args.storedRequestPayload,
      args.requestedCanonicalPayload,
    )
  ) {
    return { kind: "conflict", reason: "payload" };
  }
  return { kind: "replay" };
}
