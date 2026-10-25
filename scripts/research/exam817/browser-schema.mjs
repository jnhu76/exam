#!/usr/bin/env node
// Exam #817 — F7: frozen BROWSER_VERIFIED result schema (v2).
//
// History: D0 shipped per-question `browser_value`, the as-built harness used
// `visible_value`, and D2's Windows agent produced `browser_answer` — three
// layouts absorbed by alias chains in the oracle. That stops here (#817 D135
// brief §2): ONE canonical schema, versioned in the event, shared with the
// Windows side through scenario.json's browser_result_contract, and enforced
// strictly. Legacy layouts are REJECTED, not tolerated; R0 negative controls
// prove the rejection. Historical D0/D2 reports stay valid as published —
// their raw events are preserved — but this campaign's oracle validates v2
// only. If both ends cannot conform to v2, no new fault experiment starts.

export const BROWSER_RESULT_SCHEMA_VERSION = 2;

/** Per-question item: exactly these keys (browser_matches_last_ack and
 *  observed_at are optional). browser_answer must be PRESENT (null is a
 *  legitimate observation of an empty field and is compared as a value). */
export const BROWSER_RESULT_ITEM_ALLOWED = new Set([
  "question_id",
  "browser_answer",
  "browser_matches_last_ack",
  "observed_at",
]);

/** Business-level top-level fields beyond the event envelope. */
export const BROWSER_RESULT_TOP_ALLOWED = new Set([
  "browser_result_schema_version",
  "attempt_id",
  "per_question",
  "session_reauth_required",
  "reload_at",
  "identity_confirmed",
  "notes",
]);

/** Fields from pre-freeze layouts — their presence is a hard rejection. */
export const BROWSER_RESULT_LEGACY_FIELDS = new Set([
  "browser_answers",
  "browser_value",
  "visible_value",
  "answer_digest",
]);

// Event-envelope keys that legitimately coexist on a merged event object
// (normalizeWindowsEvent merges payload into the envelope).
const ENVELOPE_KEYS = new Set([
  "schema_version",
  "run_id",
  "trial_id",
  "seq",
  "event_id",
  "event",
  "timestamp_utc",
  "payload",
]);

export class BrowserSchemaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BrowserSchemaError";
    this.code = code;
  }
}

function isCanonicalAnswerValue(v) {
  if (v === null || ["string", "number", "boolean"].includes(typeof v)) return true;
  if (Array.isArray(v)) return v.every((x) => ["string", "number", "boolean"].includes(typeof x));
  return false; // plain objects were never a browser-observable answer shape
}

/**
 * The versioned sample shared with the Windows side via scenario.json. Both
 * ends validate against THIS shape; the sample values are placeholders.
 */
export function browserResultContract() {
  return {
    schema_version: BROWSER_RESULT_SCHEMA_VERSION,
    event: "BROWSER_VERIFIED",
    required_top_level: {
      browser_result_schema_version: BROWSER_RESULT_SCHEMA_VERSION,
      attempt_id: "<the attempt's uuid>",
      per_question: [
        {
          question_id: "<manifest question id>",
          browser_answer: "<the value exactly as the page shows it, in canonical form>",
          browser_matches_last_ack: true,
        },
      ],
    },
    optional_top_level: {
      session_reauth_required: "boolean — true if the reload required logging in again",
      reload_at: "ISO-8601 UTC timestamp of the reload",
      identity_confirmed: "boolean — candidate identity confirmed on the reloaded page",
      notes: "short free-text note",
    },
    per_question_item_rules: [
      "question_id: string, must cover EVERY manifest question exactly once",
      "browser_answer: REQUIRED key; string | number | boolean | null | array of (string|number|boolean)",
      "browser_matches_last_ack: optional boolean (the WSL oracle recomputes the comparison anyway)",
      "observed_at: optional ISO-8601 UTC",
    ],
    canonical_form_note:
      "multi-line text uses LF; multiple_choice is the array of chosen option ids; the value must be what the PAGE displays (the ACKed server value is compared against it)",
    forbidden: {
      legacy_fields: [...BROWSER_RESULT_LEGACY_FIELDS],
      reason:
        "pre-freeze layouts (D0 browser_value / as-built visible_value / D0 browser_answers[]) are rejected — do not send them",
    },
    enforcement:
      "strict: unknown fields, legacy layouts, missing/duplicate/unknown questions, attempt mismatch, or wrong schema version fail the trial closed",
  };
}

/**
 * Strictly validate a BROWSER_VERIFIED event (merged envelope+payload form)
 * against the frozen v2 schema. Returns the normalized browser_state map
 * ({questionId → {visible_value, browser_matches_last_ack}}) the oracle
 * consumes. Throws BrowserSchemaError with a stable code on any violation.
 *
 * @param ev merged event object (normalizeWindowsEvent output)
 * @param manifestQuestions manifest entries with question_id
 * @param attemptId the trial's authoritative attempt id (from CHECKPOINT_READY)
 */
export function parseBrowserVerified(ev, { manifestQuestions, attemptId }) {
  if (!ev || typeof ev !== "object" || Array.isArray(ev)) {
    throw new BrowserSchemaError("EVENT_INVALID", "BROWSER_VERIFIED event must be an object");
  }
  if (!("browser_result_schema_version" in ev)) {
    throw new BrowserSchemaError(
      "SCHEMA_VERSION_MISSING",
      "BROWSER_VERIFIED requires browser_result_schema_version=2 (frozen F7 contract)",
    );
  }
  if (ev.browser_result_schema_version !== BROWSER_RESULT_SCHEMA_VERSION) {
    throw new BrowserSchemaError(
      "SCHEMA_VERSION_UNSUPPORTED",
      `browser_result_schema_version ${JSON.stringify(ev.browser_result_schema_version)} != frozen ${BROWSER_RESULT_SCHEMA_VERSION}`,
    );
  }
  if (typeof ev.attempt_id !== "string" || ev.attempt_id.length === 0) {
    throw new BrowserSchemaError("ATTEMPT_ID_MISSING", "BROWSER_VERIFIED requires attempt_id");
  }
  if (attemptId && ev.attempt_id !== attemptId) {
    throw new BrowserSchemaError(
      "ATTEMPT_MISMATCH",
      `BROWSER_VERIFIED attempt_id ${ev.attempt_id} != trial attempt ${attemptId}`,
    );
  }
  for (const k of Object.keys(ev)) {
    if (ENVELOPE_KEYS.has(k) || BROWSER_RESULT_TOP_ALLOWED.has(k)) continue;
    if (BROWSER_RESULT_LEGACY_FIELDS.has(k)) {
      throw new BrowserSchemaError(
        "LEGACY_FIELD",
        `top-level field '${k}' belongs to a pre-freeze layout and is rejected (v2 uses per_question[].browser_answer)`,
      );
    }
    throw new BrowserSchemaError("UNKNOWN_FIELD", `top-level field '${k}' is not in the frozen v2 schema`);
  }
  if (!Array.isArray(ev.per_question)) {
    throw new BrowserSchemaError(
      "PER_QUESTION_MISSING",
      "v2 requires per_question[]; browser_answers[] is a legacy layout and is rejected",
    );
  }
  const seen = new Map();
  const browserState = {};
  for (const item of ev.per_question) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new BrowserSchemaError("ITEM_INVALID", "per_question entries must be objects");
    }
    for (const k of Object.keys(item)) {
      if (BROWSER_RESULT_LEGACY_FIELDS.has(k)) {
        throw new BrowserSchemaError("LEGACY_FIELD", `per_question field '${k}' is a pre-freeze layout field and is rejected`);
      }
      if (!BROWSER_RESULT_ITEM_ALLOWED.has(k)) {
        throw new BrowserSchemaError("UNKNOWN_FIELD", `per_question field '${k}' is not in the frozen v2 schema`);
      }
    }
    if (typeof item.question_id !== "string" || item.question_id.length === 0) {
      throw new BrowserSchemaError("QUESTION_ID_INVALID", "per_question.question_id must be a non-empty string");
    }
    if (!("browser_answer" in item)) {
      throw new BrowserSchemaError("BROWSER_ANSWER_MISSING", `question ${item.question_id}: browser_answer key is required (null allowed)`);
    }
    if (!isCanonicalAnswerValue(item.browser_answer)) {
      throw new BrowserSchemaError(
        "BROWSER_ANSWER_TYPE",
        `question ${item.question_id}: browser_answer must be string|number|boolean|null|array of those, got ${typeof item.browser_answer}`,
      );
    }
    if ("browser_matches_last_ack" in item && typeof item.browser_matches_last_ack !== "boolean") {
      throw new BrowserSchemaError("FIELD_TYPE", `question ${item.question_id}: browser_matches_last_ack must be boolean`);
    }
    if ("observed_at" in item && (typeof item.observed_at !== "string" || item.observed_at.length === 0)) {
      throw new BrowserSchemaError("FIELD_TYPE", `question ${item.question_id}: observed_at must be a string`);
    }
    if (seen.has(item.question_id)) {
      throw new BrowserSchemaError("DUPLICATE_QUESTION", `question ${item.question_id} appears more than once`);
    }
    seen.set(item.question_id, true);
    browserState[item.question_id] = {
      visible_value: item.browser_answer,
      browser_matches_last_ack: item.browser_matches_last_ack ?? null,
    };
  }
  const expected = new Set((manifestQuestions ?? []).map((q) => q.question_id));
  const missing = [...expected].filter((q) => !seen.has(q));
  if (missing.length > 0) {
    throw new BrowserSchemaError(
      "MISSING_QUESTION",
      `${missing.length} manifest question(s) absent from per_question (first: ${missing.slice(0, 3).join(",")})`,
    );
  }
  const unknown = [...seen.keys()].filter((q) => !expected.has(q));
  if (unknown.length > 0) {
    throw new BrowserSchemaError("UNKNOWN_QUESTION", `per_question carries non-manifest question(s): ${unknown.slice(0, 3).join(",")}`);
  }
  if ("session_reauth_required" in ev && typeof ev.session_reauth_required !== "boolean") {
    throw new BrowserSchemaError("FIELD_TYPE", "session_reauth_required must be boolean");
  }
  if ("identity_confirmed" in ev && typeof ev.identity_confirmed !== "boolean") {
    throw new BrowserSchemaError("FIELD_TYPE", "identity_confirmed must be boolean");
  }
  return {
    schema_version: BROWSER_RESULT_SCHEMA_VERSION,
    attempt_id: ev.attempt_id,
    browser_state: browserState,
    session_reauth_required: ev.session_reauth_required ?? null,
    identity_confirmed: ev.identity_confirmed ?? null,
    reload_at: ev.reload_at ?? null,
  };
}
