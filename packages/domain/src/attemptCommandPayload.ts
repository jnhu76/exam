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

/**
 * The two dangerous Attempt commands sharing one receipt table. This is the
 * domain-level canonical literal union; the contract layer mirrors it as
 * `AttemptCommandTypeSchema` (single source of truth is this union).
 */
export type AttemptCommandType = "force_submit" | "misconduct_mark";

/**
 * Canonical `force_submit` request payload stored in a receipt's
 * `request_payload` jsonb (audit §4.1/§4.2). `reason` is normalized to `null`
 * when missing/blank so the durable shape is unambiguous.
 */
export interface ForceSubmitRequestPayload {
  reason: string | null;
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
 * Trim a free-text field and normalize whitespace-only/empty to `null`. Used
 * for `force_submit.reason`: a missing/blank reason canonicalizes to
 * `{ reason: null }`, which is more durable for JSON comparison than a field
 * that is sometimes-present-undefined (audit §8 force_submit canonical payload).
 */
function trimToNullable(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Canonicalize a `force_submit` request into the durable `request_payload`
 * shape stored in the receipt. The input accepts the loose legacy form
 * (`reason?` optional) so the canonicalizer is the single place that decides
 * the stable shape; the orchestrator passes whatever the route received.
 *
 * Canonical rules (frozen by tests):
 *   - `reason` is trimmed.
 *   - missing / undefined / null / whitespace-only → `null`.
 */
export function canonicalizeForceSubmitPayload(input: {
  reason?: string | null | undefined;
}): ForceSubmitRequestPayload {
  return { reason: trimToNullable(input.reason ?? null) };
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

/**
 * Dispatching canonicalizer: produces the canonical `request_payload` for a
 * given command type. Throws on an unknown command type so a future command
 * cannot silently reuse the wrong canonicalizer.
 */
export function canonicalizeAttemptCommandRequest(
  commandType: AttemptCommandType,
  input:
    | { reason?: string | null }
    | { severity: "warning" | "serious"; notes: string },
): AttemptCommandRequestPayload {
  if (commandType === "force_submit") {
    return canonicalizeForceSubmitPayload(input as { reason?: string | null });
  }
  if (commandType === "misconduct_mark") {
    return canonicalizeMisconductPayload(
      input as { severity: "warning" | "serious"; notes: string },
    );
  }
  throw new Error(`Unknown attempt command type: ${String(commandType)}`);
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
