// Exam #817 — D7: 1500ms debounce draft-loss window (R3).
//
// Research question: a candidate types an answer; the page reloads before
// the debounced save fires — is the draft lost? The product keeps pending
// saves in memory only (useSubmitFlush at SHA 1bd86027: DEBOUNCE_MS=1500,
// unmount clears pending timers without flushing; no localStorage anywhere
// in TakeExamPage), so the expected outcome inside the window is
// LOCAL_UNSENT_LOST — a client unsent-draft fact, NOT ACK_LOST.
//
// Evidence model (E/S/A/P per the #817 R3 brief §4):
//   E — browser input actually happened (DOM read-back before the reload).
//   S — a save request for the question was sent (CDP network log).
//   A — that request got accepted:true (captured response).
//   P — PostgreSQL holds the answer (WSL psql sidecar, WSL-authoritative).
//
// The WSL side re-derives every classification from raw evidence; the
// Windows harness never gets to name the verdict. Timing uses the measured
// last-input→reload-initiation delta, never the nominal delay.

export const D7_DEBOUNCE_MS = 1500; // as-built product constant at the frozen SHA

/**
 * Field-name aliases accepted for the two decisive timestamps. The D7-01
 * trial exposed real Windows harness layouts beyond the scenario's primary
 * names (approx input derivation; epoch-ms reload stamps; the pre-armed
 * listener's timing witness) — the normalizer accepts them explicitly
 * instead of guessing. The reload FIRE moment is preferred over arming
 * (navigation start is the moment the debounce must have lost the race
 * against; it is the conservative choice for in-window claims).
 */
const INPUT_AT_KEYS = ["last_input_at", "actual_last_input_at_utc_approx", "input_last_at_utc"];
const RELOAD_AT_KEYS = [
  "reload_fired_at_epoch_ms",
  "reload_fired_at_utc",
  "reload_initiated_at_epoch_ms",
  "reload_initiated_at",
  "reload_at",
];

/** Normalize a raw TREATMENT_STEP event into the classifier's input shape. */
export function normalizeTreatmentWindows(ev = {}) {
  const pick = (keys) => {
    for (const k of keys) {
      const v = ev[k];
      if (v === undefined || v === null) continue;
      if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString();
      if (typeof v === "string" && v.length > 0) return v;
    }
    return null;
  };
  const witness = ev.timing_witness && typeof ev.timing_witness === "object" ? ev.timing_witness : {};
  return {
    input_confirmed: ev.input_confirmed ?? null,
    dom_value_before_reload: ev.dom_value_before_reload ?? null,
    last_input_at: pick(INPUT_AT_KEYS) ?? witness.last_input_at ?? null,
    reload_initiated_at: pick(RELOAD_AT_KEYS) ?? witness.reload_at ?? null,
    save_requests: Array.isArray(ev.save_requests) ? ev.save_requests : [],
    save_responses: Array.isArray(ev.save_responses) ? ev.save_responses : [],
    post_reload_value: ev.dom_value_after_reload ?? null,
    timing_note: ev.last_input_derivation ?? null,
  };
}

/**
 * Classify one treatment question from raw two-end evidence.
 *
 * @param treatment scenario spec {question_id, nominal_reload_delay_ms, expected_value}
 * @param windows   Windows-side raw evidence for this step:
 *   {input_confirmed, dom_value_before_reload, last_input_at,
 *    reload_initiated_at, save_requests:[{question_id,at,request_id}],
 *    save_responses:[{question_id,at,acked}], post_reload_value}
 * @param pg        WSL observation {present, version, value_matches_treatment}
 */
export function classifyD7Treatment({ treatment, windows, pg, debounceMs = D7_DEBOUNCE_MS }) {
  const qid = treatment.question_id;
  const w = windows ?? {};

  // E gate: the DOM must have shown the treatment value before the reload.
  // The read-back itself is the input evidence — the optional
  // input_confirmed attestation is recorded but not required.
  const e =
    w.dom_value_before_reload !== null &&
    w.dom_value_before_reload !== undefined &&
    JSON.stringify(w.dom_value_before_reload) === JSON.stringify(treatment.expected_value);
  if (!e) {
    return { question_id: qid, classification: "UNKNOWN", e, s: null, a: null, p: pg?.present ?? null, measured_reload_delta_ms: null, reason: "input not proven (missing/mismatched pre-reload DOM read-back) — trial protocol failure, not a product result" };
  }

  const tIn = Date.parse(w.last_input_at);
  const tReload = Date.parse(w.reload_initiated_at);
  if (!Number.isFinite(tIn) || !Number.isFinite(tReload) || tReload < tIn) {
    return { question_id: qid, classification: "UNCONTROLLED", e, s: null, a: null, p: pg?.present ?? null, measured_reload_delta_ms: null, reason: "reload timing unmeasurable (missing/invalid input or reload timestamp) — cannot prove the refresh preceded the debounce" };
  }
  const delta = tReload - tIn;

  // S/A: requests for THIS question inside the treatment window. The window
  // ends slightly after reload initiation: a request dispatched a few ms
  // before the reload is recorded by CDP right around it.
  const inWindow = (at) => {
    const t = Date.parse(at);
    return Number.isFinite(t) && t >= tIn - 100 && t <= tReload + 50;
  };
  const reqs = (w.save_requests ?? []).filter((r) => r.question_id === qid && inWindow(r.at));
  const resps = (w.save_responses ?? []).filter((r) => r.question_id === qid && inWindow(r.at));
  const s = reqs.length > 0;
  const a = resps.some((r) => r.acked === true);

  const p = pg?.present === true;
  const pMatches = p ? pg.value_matches_treatment === true : null;
  const pgOutcome = p ? (pMatches ? "PRESENT_MATCHING" : "PRESENT_DIVERGENT") : "ABSENT";

  const base = { question_id: qid, e, s, a, p, measured_reload_delta_ms: delta, pg_outcome: pgOutcome };

  // Inside the debounce window the save must not exist at all.
  if (delta < debounceMs) {
    if (!s && !a) {
      if (!p) {
        if (isEmptyObservation(w.post_reload_value)) {
          return { ...base, classification: "LOCAL_UNSENT_LOST", reason: `reload at ${delta}ms < ${debounceMs}ms debounce; no save request, no ACK, PG absent, page shows the field empty after reload` };
        }
        return { ...base, classification: "UNKNOWN", reason: "PG absent but the reloaded page still shows a value — unknown persistence source; fail closed" };
      }
      return { ...base, classification: "UNKNOWN", reason: `answer present in PG (version ${pg.version}) although no save request was observed inside the window — network capture gap or unexpected persistence; fail closed` };
    }
    if (s && !a) {
      // Request left before the reload completed; response unknown → PG decides the fate, classification stays per brief.
      return { ...base, classification: "SENT_BUT_UNKNOWN", reason: `save request sent at ${delta}ms into the window but no captured response; PG outcome: ${pgOutcome}` };
    }
    if (s && a) {
      return pMatches === true
        ? { ...base, classification: "SAVED_ACKED", reason: `save+ACK observed despite reload at ${delta}ms — answer persisted (treatment executed past the effective flush point)` }
        : { ...base, classification: "UNKNOWN", reason: "ACK observed but PG content diverges from the typed value — durability anomaly, fail closed" };
    }
    // a without s — protocol impossibility
    return { ...base, classification: "UNKNOWN", reason: "ACK without an observed request — protocol contradiction, fail closed" };
  }

  // Outside the window: the debounce timer was already due when the reload
  // armed. The boundary control expects SAVED_ACKED; a silent window is a
  // finding about the timer itself, never reported as a draft-loss result.
  if (s && a) {
    return pMatches === true
      ? { ...base, classification: "SAVED_ACKED", reason: `reload at ${delta}ms ≥ debounce; save ACKed and PG matches (boundary control behaved as expected)` }
      : { ...base, classification: "UNKNOWN", reason: "ACK observed but PG content diverges from the typed value — durability anomaly, fail closed" };
  }
  if (s && !a) {
    // Late reload, request already gone, response not captured (e.g. aged
    // out of the CDP buffer) — same SENT_BUT_UNKNOWN semantics as inside
    // the window; PG decides the fate.
    return { ...base, classification: "SENT_BUT_UNKNOWN", reason: `reload at ${delta}ms ≥ debounce; save request sent but no captured response; PG outcome: ${pgOutcome}` };
  }
  if (!s && !a && !p) {
    return { ...base, classification: "DEBOUNCE_NOT_FIRED", reason: `reload at ${delta}ms ≥ ${debounceMs}ms debounce yet no save request, no ACK, PG absent — the in-memory timer did not produce a save` };
  }
  return { ...base, classification: "UNKNOWN", reason: `outside-window state s=${s} a=${a} p=${p} (${pgOutcome}) — inconclusive, fail closed` };
}

function isEmptyObservation(v) {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * Trial-level D7 summary from per-question classifications.
 *
 * Evidence rules: a per-sample UNKNOWN blocks the headline (the measurement
 * itself is untrusted); UNCONTROLLED and SENT_BUT_UNKNOWN samples are
 * disclosed but carry no evidence either way — they never veto clean
 * in-window samples, whose timing and absence-of-request are independently
 * proven. Controls must be clean first: a broken control invalidates the
 * whole trial regardless of what the treatments showed.
 */
export function summarizeD7({ controlResults, treatmentResults, apiLegAvailable = true, browserLegAvailable = true }) {
  const counts = {};
  for (const t of treatmentResults) counts[t.classification] = (counts[t.classification] ?? 0) + 1;
  const controlsOk = controlResults.every((c) => c.classification === "ACK_MATCHED");
  const inside = treatmentResults.filter((t) => t.classification === "LOCAL_UNSENT_LOST");
  const anomalies = treatmentResults.filter((t) => t.classification === "UNKNOWN");

  let verdict;
  let reason;
  if (!controlsOk) {
    verdict = "UNKNOWN";
    reason = "control question(s) not ACK_MATCHED — PG baseline broken, treatment results uninterpretable";
  } else if (!apiLegAvailable || !browserLegAvailable) {
    verdict = "UNKNOWN";
    reason = "API/browser leg missing — COMPLETE unavailable (fail closed)";
  } else if (anomalies.length > 0) {
    verdict = "UNKNOWN";
    reason = `${anomalies.length} treatment(s) untrustworthy (UNKNOWN): ${anomalies.map((t) => (t.question_id ?? "?").slice(0, 8)).join(",")}`;
  } else if (counts.LOCAL_UNSENT_LOST > 0) {
    verdict = "LOCAL_UNSENT_LOST";
    reason =
      `${counts.LOCAL_UNSENT_LOST} in-window treatment(s) provably lost (unsent in-memory draft); controls clean` +
      (counts.UNCONTROLLED ? `; ${counts.UNCONTROLLED} uncontrolled sample(s) excluded from evidence` : "") +
      (counts.SENT_BUT_UNKNOWN ? `; ${counts.SENT_BUT_UNKNOWN} sent-but-unknown sample(s) reported separately` : "");
  } else if (counts.SENT_BUT_UNKNOWN > 0) {
    verdict = "SENT_BUT_UNKNOWN";
    reason = "no clean in-window loss sample: every executed treatment's request left before its reload";
  } else {
    verdict = "UNKNOWN";
    reason = "no interpretable treatment outcome";
  }
  return { verdict, reason, counts, controls_ok: controlsOk, lost_question_ids: inside.map((t) => t.question_id) };
}
