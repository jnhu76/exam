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
 * Pure domain types (the canonical command union, request/result payload
 * interfaces, and the per-command input/payload maps) live in `./types.ts`,
 * the single source of truth for domain types (review J5-I1C0 PR #261 P2-1).
 * This module re-exports them so existing deep-path imports
 * (`from "./attemptCommandPayload.js"`) keep working; new callers should import
 * them from `@exam/domain` directly.
 *
 * The `@exam/contracts` Zod schemas (`ForceSubmitRequestPayloadSchema`,
 * `MisconductMarkRequestPayloadSchema`, `AttemptCommandTypeSchema`) are the
 * wire-level projection of the canonical shapes defined in `./types.js`;
 * contracts depends on domain, never the reverse.
 */

// ── Canonical command identity (re-exported from types.ts) ─────────
//
// The type authority lives in `./types.ts` per AGENTS.md. Re-exported here so
// the existing deep-path imports from this module keep working without a
// churn-only diff across the engine / api / db layers.
import { ValidationError } from "./errors.js";
import type {
  AttemptCommandInputByType,
  AttemptCommandPayloadByType,
  AttemptCommandRequestPayload,
  AttemptCommandResultPayload,
  AttemptCommandType,
  ForceSubmitRequestPayload,
  ForceSubmitResultPayload,
  MisconductMarkRequestPayload,
  MisconductMarkResultPayload,
} from "./types.js";

export type {
  AttemptCommandInputByType,
  AttemptCommandPayloadByType,
  AttemptCommandRequestPayload,
  AttemptCommandResultPayload,
  AttemptCommandType,
  ForceSubmitRequestPayload,
  ForceSubmitResultPayload,
  MisconductMarkRequestPayload,
  MisconductMarkResultPayload,
};

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
    throw new ValidationError(
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
    throw new ValidationError(
      "misconduct_mark canonical payload requires non-empty notes after trim",
    );
  }
  return { severity: input.severity, notes: trimmedNotes };
}

// ── Command → input / payload type binding (compile-time) ──────────
//
// The per-command INPUT and PAYLOAD maps (`AttemptCommandInputByType`,
// `AttemptCommandPayloadByType`) are the compile-time binding between a
// command type and its payload shapes. They live in `./types.ts` (the domain
// type authority) and are imported above; the canonicalizer table below
// indexes them so `canonicalizeAttemptCommandRequest` dispatches WITHOUT any
// type assertion — the command→input→payload binding is structural, not cast
// (overnight hardening: the previous loose union + casts let both wrong
// combinations compile and silently canonicalize to a different command's
// identity).

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
