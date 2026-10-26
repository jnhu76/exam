#!/usr/bin/env node
// Exam #817 — PostgreSQL oracle (read-only) + per-answer comparison.
//
// All queries run through a one-shot psql sidecar container attached to the
// run's exam-net — fully independent of the app and of the target db
// container's lifecycle (a snapshot must survive a db process dying mid-
// experiment and still be taken right after recovery). SELECT-only.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { atomicWriteJson, sha256Hex } from "./mailbox.mjs";
import { runProjectName, runPaths } from "./stack.mjs";

const execFileP = promisify(execFile);

const PG_IMAGE = "postgres:18.4-bookworm";

export async function pgQuery(runId, sql, { timeoutMs = 30000 } = {}) {
  const p = runPaths(runId);
  const env = fs.readFileSync(p.envFile, "utf8");
  const password = env.match(/^POSTGRES_PASSWORD=(.*)$/m)[1];
  const dbUser = env.match(/^POSTGRES_USER=(.*)$/m)[1] || "exam";
  const dbName = env.match(/^POSTGRES_DB=(.*)$/m)[1] || "exam";
  const network = `${runProjectName(runId)}_exam-net`;
  const started = process.hrtime.bigint();
  const { stdout } = await execFileP(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      network,
      "-e",
      `PGPASSWORD=${password}`,
      PG_IMAGE,
      "psql",
      "-h",
      "db",
      "-U",
      dbUser,
      "-d",
      dbName,
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-c",
      sql,
    ],
    { encoding: "utf8", timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
  );
  const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
  return { stdout, latencyMs };
}

/**
 * Parse psql stdout into JSON row objects (F3 regression, #819).
 *
 * psql -At echoes transaction command tags ("BEGIN"/"COMMIT"/"ROLLBACK")
 * into stdout when a query runs multi-statement — the historical F3 failure.
 * Known tags are tolerated but RETURNED (never silently dropped); empty
 * lines are skipped; any other non-JSON line is a loud error. Unexpected
 * stdout must fail the snapshot, never shrink it.
 */
const PSQL_TRANSACTION_TAGS = new Set(["BEGIN", "COMMIT", "ROLLBACK"]);

export function parsePsqlJsonRows(stdout, { what = "psql output" } = {}) {
  const rows = [];
  const psqlTags = [];
  const unexpected = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (PSQL_TRANSACTION_TAGS.has(line)) {
      psqlTags.push(line);
      continue;
    }
    if (line.startsWith("{")) {
      try {
        rows.push(JSON.parse(line));
        continue;
      } catch (e) {
        throw new Error(`${what}: JSON line failed to parse: ${e.message} :: ${line.slice(0, 120)}`);
      }
    }
    unexpected.push(line);
  }
  if (unexpected.length > 0) {
    throw new Error(
      `${what}: unexpected non-JSON stdout (${unexpected.length} line(s)) — refusing to ignore: ` +
        JSON.stringify(unexpected.slice(0, 3)),
    );
  }
  return { rows, psqlTags };
}

/**
 * Authoritative pre/post snapshot of the attempt row. Uses row_to_json so
 * the answers jsonb array is compared verbatim.
 */
export async function snapshotAttempt(runId, attemptId) {
  const safeId = attemptId.replace(/[^0-9a-fA-F-]/g, "");
  if (safeId !== attemptId || attemptId.length === 0) {
    throw new Error(`refusing non-uuid attempt id: ${attemptId}`);
  }
  // Single SELECT = single implicit transaction (statement snapshot).
  // No explicit BEGIN/COMMIT: psql -At echoes their "BEGIN"/"COMMIT" tags
  // into stdout, which is not JSON (F3).
  const sql =
    `SELECT row_to_json(t) FROM (SELECT id, exam_id, status, deadline_at, started_at, submitted_at, ` +
    `answers, submitted_answers, updated_at FROM exam_attempts WHERE id = '${safeId}') t;`;
  const { stdout, latencyMs } = await pgQuery(runId, sql);
  const { rows, psqlTags } = parsePsqlJsonRows(stdout, { what: "snapshotAttempt" });
  if (rows.length > 1) {
    throw new Error(`snapshotAttempt: expected 0..1 row, got ${rows.length}`);
  }
  return { row: rows[0] ?? null, latencyMs, captured_at: new Date().toISOString(), psql_tags: psqlTags };
}

/**
 * Full-row snapshot (SELECT *) — D8 needs submitted_answers, submitted_at,
 * submission_reason and grading fields that the narrow snapshotAttempt does
 * not select. Same sidecar/single-statement snapshot semantics.
 */
export async function snapshotAttemptFull(runId, attemptId) {
  const safeId = attemptId.replace(/[^0-9a-fA-F-]/g, "");
  if (safeId !== attemptId || attemptId.length === 0) {
    throw new Error(`refusing non-uuid attempt id: ${attemptId}`);
  }
  const sql = `SELECT row_to_json(t) FROM (SELECT * FROM exam_attempts WHERE id = '${safeId}') t;`;
  const { stdout, latencyMs } = await pgQuery(runId, sql);
  const { rows, psqlTags } = parsePsqlJsonRows(stdout, { what: "snapshotAttemptFull" });
  if (rows.length > 1) {
    throw new Error(`snapshotAttemptFull: expected 0..1 row, got ${rows.length}`);
  }
  return { row: rows[0] ?? null, latencyMs, captured_at: new Date().toISOString(), psql_tags: psqlTags };
}

export function writePgSnapshotEvidenceFull(runId, trialId, phase, snapshot) {
  const p = runPaths(runId);
  const file = path.join(p.evidenceDir, `pg-snapshot-full-${trialId}-${phase}.json`);
  const body = {
    schema_version: "exam817/1",
    kind: "exam817/pg-snapshot-full",
    run_id: runId,
    trial_id: trialId,
    phase,
    captured_at: snapshot.captured_at,
    query_latency_ms: snapshot.latencyMs,
    sha256_at_capture: sha256Hex(JSON.stringify(snapshot.row ?? {})),
    row: snapshot.row ?? null,
  };
  atomicWriteJson(file, body);
  return { file, sha256: body.sha256_at_capture, latencyMs: snapshot.latencyMs };
}

export async function capturePgSettings(runId) {
  const { stdout, latencyMs } = await pgQuery(
    runId,
    "SELECT row_to_json(t) FROM (SELECT current_setting('fsync') AS fsync, " +
      "current_setting('synchronous_commit') AS synchronous_commit, " +
      "current_setting('full_page_writes') AS full_page_writes, " +
      "current_setting('data_directory') AS data_directory, " +
      "current_setting('wal_level') AS wal_level, version() AS version) t;",
  );
  const { rows } = parsePsqlJsonRows(stdout, { what: "capturePgSettings" });
  if (rows.length !== 1) {
    throw new Error(`capturePgSettings: expected exactly 1 row, got ${rows.length}`);
  }
  return { settings: rows[0], latencyMs, captured_at: new Date().toISOString() };
}

export async function captureWalRecoveryLog(runId, sinceIso) {
  const p = runPaths(runId);
  const env = fs.readFileSync(p.envFile, "utf8");
  const port = env.match(/^EXAM_PORT=(\d+)/m)[1];
  void port;
  const containers = await (await import("./stack.mjs")).runContainers(runId);
  const dbId = containers.db?.id;
  if (!dbId) return { log: "", note: "db container not found" };
  const { stdout } = await execFileP(
    "docker",
    ["logs", "--timestamps", dbId],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 30000 },
  );
  const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
  const lines = stdout.split("\n").filter((l) => {
    const ts = l.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
    return ts && Date.parse(ts[1]) >= sinceMs - 2000;
  });
  return { log: lines.join("\n"), lineCount: lines.length };
}

// ── Comparison ────────────────────────────────────────────────────

/** Stable JSON stringify (sorted object keys; arrays keep order). */
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

/**
 * Compare an unordered set of chosen option ids (multiple_choice) order-
 * insensitively; everything else compares exact. Shared by the durability
 * oracle (D0-D5), the D6 restore comparator and the D8 submitted-answers
 * check so answer-equality semantics stay identical everywhere.
 */
export function valuesEqual(expected, actual, type) {
  if (type === "multiple_choice" && Array.isArray(expected) && Array.isArray(actual)) {
    const a = [...expected].map(String).sort();
    const b = [...actual].map(String).sort();
    return stableStringify(a) === stableStringify(b);
  }
  return stableStringify(expected) === stableStringify(actual);
}

/**
 * Per-question classification of one trial.
 *
 * The durability comparison is ACK-vs-PG (A−P): the expected value is the
 * content of the LAST verified ACK (request artifact value, or its digest),
 * not the scenario manifest — manifest deviations (e.g. CRLF normalized to
 * LF by a real textarea) are scenario authoring facts, reported separately
 * as scenario_deviation, never as answer loss.
 *
 * @param manifestQuestions manifest entries {question_id, type, expected_gen1, expected_gen2, order}
 * @param attemptRow        row_to_json of exam_attempts (answers jsonb array)
 * @param ackState          per question {serverVersion, generation, evidence_ref, answer_value?, answer_digest?}
 * @param browserState      per question {visible_value?, answer_digest?} from BROWSER_VERIFIED (optional)
 * @param apiState          per question {value, version, source} from the recovered
 *                          GET /candidate/attempts/:id/take snapshot (optional; D2
 *                          adds the ACK→PG→API third leg — the serving-path
 *                          authority must re-present exactly what PG holds)
 */
export function classifyPerQuestion({ manifestQuestions, attemptRow, ackState, browserState, apiState }) {
  const answers = Array.isArray(attemptRow?.answers) ? attemptRow.answers : [];
  const latestByQuestion = new Map();
  for (const rec of answers) {
    const prev = latestByQuestion.get(rec.questionId);
    if (!prev || Number(rec.version) > Number(prev.version)) {
      latestByQuestion.set(rec.questionId, rec);
    }
  }
  return manifestQuestions.map((q) => {
    const ack = ackState?.[q.question_id] ?? null;
    const expectedGeneration = q.expected_gen2 !== null && q.expected_gen2 !== undefined ? 2 : 1;
    const expectedValue = expectedGeneration === 2 ? q.expected_gen2 : q.expected_gen1;
    const pgRec = latestByQuestion.get(q.question_id) ?? null;

    // ACK-vs-PG content match: value comparison when the ACKed value is
    // available; digest comparison (sha256 of JSON-serialized value — the
    // Windows harness digest formula, verified against known vectors)
    // otherwise; null when neither is available (no verifiable content).
    let pgMatch = null;
    if (ack && pgRec) {
      if (ack.answer_value !== undefined && ack.answer_value !== null) {
        pgMatch = valuesEqual(ack.answer_value, pgRec.answer, q.type);
      } else if (ack.answer_digest) {
        pgMatch = sha256Hex(stableStringify(pgRec.answer)) === ack.answer_digest;
      }
    }

    let classification;
    if (!ack) {
      classification = ackState === null ? "NOT_RUN" : "UNACKNOWLEDGED_UNKNOWN";
    } else if (!pgRec) {
      classification = "ACK_LOST";
    } else if (pgMatch === true) {
      classification = "ACK_MATCHED";
    } else if (pgMatch === false) {
      classification = "ACK_LOST";
    } else {
      classification = "UNACKNOWLEDGED_UNKNOWN";
    }

    // Scenario-level deviation: the ACKed content differs from what the
    // manifest told the browser to enter. Recorded, not counted as loss.
    const scenarioDeviation =
      ack?.answer_value !== undefined && ack?.answer_value !== null
        ? !valuesEqual(expectedValue, ack.answer_value, q.type)
        : false;

    let browserClassification = null;
    if (browserState) {
      const b = browserState[q.question_id] ?? null;
      if (!b) browserClassification = "NOT_RUN";
      else if (classification !== "ACK_MATCHED") browserClassification = "UNKNOWN"; // PG itself failed; browser result secondary
      else {
        // Value comparison when the browser reported the visible value;
        // digest comparison when only a digest was reported.
        let match = null;
        if (b.visible_value !== null && b.visible_value !== undefined) {
          match = valuesEqual(ack?.answer_value ?? expectedValue, b.visible_value, q.type);
        } else if (b.answer_digest) {
          match = sha256Hex(stableStringify(ack?.answer_value ?? expectedValue)) === b.answer_digest;
        }
        browserClassification = match === null ? "NOT_RUN" : match ? "ACK_MATCHED" : "BROWSER_MISMATCH";
      }
    }

    let apiClassification = null;
    if (apiState) {
      const a = apiState[q.question_id] ?? null;
      if (!a) apiClassification = "NOT_RUN";
      else if (classification !== "ACK_MATCHED") apiClassification = "UNKNOWN"; // PG leg already failed; API leg secondary
      else {
        let match = null;
        if (a.value !== null && a.value !== undefined) {
          match = valuesEqual(ack?.answer_value ?? expectedValue, a.value, q.type);
        }
        const versionMismatch =
          a.version !== null &&
          a.version !== undefined &&
          ack &&
          Number(a.version) !== Number(ack.serverVersion);
        apiClassification =
          match === null ? "NOT_RUN" : match && !versionMismatch ? "ACK_MATCHED" : "API_MISMATCH";
      }
    }

    return {
      question_id: q.question_id,
      order: q.order,
      type: q.type,
      expected_generation: expectedGeneration,
      manifest_expected_value: expectedValue,
      expected_server_version: ack?.serverVersion ?? null,
      acked_value: ack?.answer_value ?? null,
      pg_value: pgRec?.answer ?? null,
      pg_version: pgRec?.version ?? null,
      pg_saved_at: pgRec?.savedAt ?? null,
      ack: ack
        ? { generation: ack.generation, server_version: ack.serverVersion, evidence_ref: ack.evidence_ref }
        : null,
      classification,
      scenario_deviation: scenarioDeviation,
      browser_classification: browserClassification,
      browser_value: browserState?.[q.question_id]?.visible_value ?? null,
      api_classification: apiClassification,
      api_value: apiState?.[q.question_id]?.value ?? null,
      api_version: apiState?.[q.question_id]?.version ?? null,
    };
  });
}

/**
 * D8 submitted-answers gate: the frozen submitted_answers snapshot must
 * carry every answered question's value (shape per SubmittedAnswersSnapshot:
 * {schemaVersion:1, answers:[{questionId, value}]}). Shape-aware — an
 * unrecognized record shape fails closed (comparable=false), never guesses.
 */
export function compareSubmittedAnswers({ answers, submitted, manifestQuestions }) {
  const submittedByQ = new Map();
  let shapeOk = true;
  for (const rec of submitted?.answers ?? []) {
    if (rec && typeof rec === "object" && typeof rec.questionId === "string" && "value" in rec) {
      submittedByQ.set(rec.questionId, rec.value);
    } else shapeOk = false;
  }
  const typeByQ = new Map(manifestQuestions.map((q) => [q.question_id, q.type]));
  const mismatches = [];
  const perQuestion = [];
  for (const rec of answers ?? []) {
    if (!submittedByQ.has(rec.questionId)) {
      mismatches.push({ question_id: rec.questionId, reason: "missing from submitted_answers" });
      continue;
    }
    const match = valuesEqual(submittedByQ.get(rec.questionId), rec.answer, typeByQ.get(rec.questionId) ?? null);
    perQuestion.push({ question_id: rec.questionId, match });
    if (!match) mismatches.push({ question_id: rec.questionId, reason: "value mismatch" });
  }
  const extra = [...submittedByQ.keys()].filter((q) => !(answers ?? []).some((a) => a.questionId === q));
  return {
    comparable: shapeOk && extra.length === 0,
    per_question: perQuestion,
    mismatches,
    extra_in_submitted: extra,
    note: shapeOk ? undefined : "unrecognized submitted_answers record shape",
  };
}

/**
 * Oracle mutation RED test (counterfactual): per-answer comparison MUST
 * detect a deliberately mutated marker. Runs against the comparator on a
 * realistic attempt row shape — never against experiment data in place.
 * Returns {red, detail}.
 */
export function oracleMutationRedTest() {
  const manifestQuestions = [
    {
      question_id: "00000000-0000-0000-0000-0000000000q1",
      order: 1,
      type: "fill_blank",
      expected_gen1: "e817-x::t1|q7|g1|primary",
      expected_gen2: null,
    },
  ];
  const attemptRow = {
    id: "00000000-0000-0000-0000-00000000000a",
    status: "in_progress",
    answers: [
      {
        questionId: "00000000-0000-0000-0000-0000000000q1",
        answer: "e817-x::t1|q7|g1|MUTATED", // deliberately corrupted marker
        version: 1,
        savedAt: "2026-10-25T12:00:00.000Z",
      },
    ],
  };
  const ackState = {
    "00000000-0000-0000-0000-0000000000q1": { generation: 1, serverVersion: 1, evidence_ref: "synthetic", answer_value: "e817-x::t1|q7|g1|primary" },
  };
  const result = classifyPerQuestion({ manifestQuestions, attemptRow, ackState });
  const red = result.length === 1 && result[0].classification === "ACK_LOST";
  // Also prove the matching path is GREEN on identical values (comparator
  // must not be a detector that always fires).
  const attemptRow2 = { ...attemptRow, answers: [{ ...attemptRow.answers[0], answer: manifestQuestions[0].expected_gen1 }] };
  const result2 = classifyPerQuestion({ manifestQuestions, attemptRow: attemptRow2, ackState });
  const green = result2.length === 1 && result2[0].classification === "ACK_MATCHED";
  return {
    red,
    green,
    detail: { mutated_classification: result[0]?.classification, identical_classification: result2[0]?.classification },
  };
}

export async function writePgSnapshotEvidence(runId, trialId, phase, snapshot) {
  const p = runPaths(runId);
  const file = path.join(p.evidenceDir, `pg-snapshot-${trialId}-${phase}.json`);
  const body = {
    schema_version: "exam817/1",
    kind: "exam817/pg-snapshot",
    run_id: runId,
    trial_id: trialId,
    phase,
    captured_at: snapshot.captured_at,
    query_latency_ms: snapshot.latencyMs,
    sha256_at_capture: sha256Hex(JSON.stringify(snapshot.row ?? {})),
    row: snapshot.row ?? null,
  };
  atomicWriteJson(file, body);
  return { file, sha256: body.sha256_at_capture, latencyMs: snapshot.latencyMs };
}

/**
 * D8 evidence replay (§10): rebuild the verdict inputs from the evidence
 * files captured while the stack lived, for the one case where live
 * re-observation is impossible — the stack was torn down (cleanup
 * --delete-data) and a late BROWSER_VERIFIED arrived after the wait window
 * closed. Every input is fail-closed: a missing file, a row-hash mismatch
 * against the capture-time hash or the journaled capture hash, a foreign
 * run/trial/attempt, or a journal without a live d8_facets verdict throws.
 * The api snapshot is accepted on internal identity only (run/trial/
 * attempt/shape): the republish-time re-observation overwrites the file in
 * place, so its bytes legitimately differ from the state-recorded capture;
 * the semantic content is attested by the journal's live counts, which the
 * caller cross-checks.
 */
export function d8ReplayEvidence({ evidenceDir, journalPath, st }) {
  const fail = (what) => {
    throw new Error(`D8 evidence replay: ${what} — fail closed`);
  };
  if (!st?.attempt_id) fail("state has no attempt_id");
  if (!st?.pre_full_snapshot?.ref || !st?.pre_full_snapshot?.sha256) fail("state has no pre full snapshot ref/sha");
  if (!st?.post_snapshot?.ref || !st?.post_snapshot?.sha256) fail("state has no post tagged snapshot ref/sha");
  const rowSha = (doc) => sha256Hex(JSON.stringify(doc.row ?? {}));
  const readDoc = (file, what) => {
    if (!fs.existsSync(file)) fail(`${what} missing (${path.basename(file)})`);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  };
  const identity = (doc, what, phase) => {
    if (doc.run_id !== st.run_id || doc.trial_id !== st.trial_id) fail(`${what} belongs to another run/trial`);
    if (phase && doc.phase !== phase) fail(`${what} phase is ${doc.phase ?? "none"}, expected ${phase}`);
  };

  const preFull = readDoc(path.join(evidenceDir, st.pre_full_snapshot.ref), "pre full snapshot");
  identity(preFull, "pre full snapshot", "pre");
  if (rowSha(preFull) !== preFull.sha256_at_capture) fail("pre full snapshot row hash mismatch (sha256_at_capture)");
  if (rowSha(preFull) !== st.pre_full_snapshot.sha256) fail("pre full snapshot row hash does not match the journaled capture hash");
  if (preFull.row?.id !== st.attempt_id) fail("pre full snapshot row is not the trial attempt");

  const postFullFile = `pg-snapshot-full-${st.trial_id}-post.json`;
  const postFull = readDoc(path.join(evidenceDir, postFullFile), "post full snapshot");
  identity(postFull, "post full snapshot", "post");
  if (rowSha(postFull) !== postFull.sha256_at_capture) fail("post full snapshot row hash mismatch (sha256_at_capture)");
  if (postFull.row?.id !== st.attempt_id) fail("post full snapshot row is not the trial attempt");

  const postTagged = readDoc(path.join(evidenceDir, st.post_snapshot.ref), "post tagged snapshot");
  identity(postTagged, "post tagged snapshot", "post");
  if (rowSha(postTagged) !== st.post_snapshot.sha256) fail("post tagged snapshot row hash does not match the journaled capture hash");

  // Attempt count and the live-observed facets come from the append-only
  // journal: the last VERDICT_PUBLISHED carrying d8_facets was computed from
  // live PG/API while the stack was still up.
  if (!fs.existsSync(journalPath)) fail("wsl journal missing");
  let live = null;
  for (const line of fs.readFileSync(journalPath, "utf8").split("\n").filter(Boolean)) {
    let rec = null;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec?.event === "VERDICT_PUBLISHED" && rec.trial_id === st.trial_id && rec.d8_facets) live = rec.d8_facets;
  }
  if (!live) fail("journal has no VERDICT_PUBLISHED with d8_facets (no live verdict to replay against)");
  if (!Number.isInteger(live.attempt_rows_for_exam)) fail("journaled d8_facets lack attempt_rows_for_exam");

  const apiFile = st.api_snapshot?.ref
    ? path.join(evidenceDir, st.api_snapshot.ref)
    : path.join(evidenceDir, `api-snapshot-${st.trial_id}.json`);
  const api = readDoc(apiFile, "api snapshot");
  if (api.run_id !== st.run_id || api.trial_id !== st.trial_id || api.attempt_id !== st.attempt_id) {
    fail("api snapshot belongs to another run/trial/attempt");
  }
  if (!api.api_state || typeof api.api_state !== "object" || Object.keys(api.api_state).length === 0) {
    fail("api snapshot has no api_state");
  }

  return {
    apiState: api.api_state,
    apiAttemptStatus: api.attempt_status ?? null,
    postRow: postFull.row,
    postSnap: { row: postTagged.row, latencyMs: postTagged.query_latency_ms ?? null },
    attemptCount: live.attempt_rows_for_exam,
    liveFacets: live,
    postFullRef: { ref: postFullFile, sha256: postFull.sha256_at_capture, replayed: true },
    source: {
      mode: "persisted_evidence_post_cleanup",
      pre_full: st.pre_full_snapshot.ref,
      post_full: postFullFile,
      post_tagged: st.post_snapshot.ref,
      api: path.basename(apiFile),
      api_captured_at: api.captured_at ?? null,
      attempt_count_and_live_facets_from: "journal VERDICT_PUBLISHED d8_facets (captured live before cleanup)",
    },
  };
}
