#!/usr/bin/env node
// Exam #817 — R0 mailbox protocol verification battery.
//
// Runs the frozen encoding/replay test matrix against the mailbox protocol
// core using synthetic fixtures (simulating a Windows writer byte-for-byte).
// Writes an R0 receipt to the run directory and appends R0 events to
// wsl.events.jsonl. Exit code 0 iff every test passes.
//
// R0 failure blocks the Docker fault phase (stop gate).

import fs from "node:fs";
import path from "node:path";
import {
  EventWriter,
  JsonlFileReader,
  JsonParseError,
  MAX_RECORD_BYTES,
  SCHEMA_VERSION,
  appendEventLine,
  atomicWriteJson,
  decodeRecordBytes,
  parseJsonStrict,
  readPublishedJson,
  serializeEventLine,
  sha256Hex,
  validateEnvelope,
} from "./mailbox.mjs";
import {
  BrowserSchemaError,
  BROWSER_RESULT_SCHEMA_VERSION,
  browserResultContract,
  parseBrowserVerified,
} from "./browser-schema.mjs";
import { summarizeProbeSamples } from "./probe.mjs";
import { pgdataSurvivalShell } from "./fault.mjs";
import { classifyPerQuestion, compareSubmittedAnswers, oracleMutationRedTest, valuesEqual } from "./oracle.mjs";
import { parsePsqlJsonRows } from "./oracle.mjs";
import { classifyD7Treatment, normalizeTreatmentWindows, summarizeD7, D7_DEBOUNCE_MS } from "./d7.mjs";
import { compareD6, measureRpo, scratchProjectName, scratchPaths } from "./d6.mjs";
import { FAULT_PLAN } from "./fault.mjs";

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("usage: r0-selftest.mjs <run-dir> <mailbox-run-dir> <run_id>");
  process.exit(2);
}
const [runDir, mailboxRunDir, runId] = args;

fs.mkdirSync(path.join(mailboxRunDir, "artifacts", "wsl", "r0"), { recursive: true });
fs.mkdirSync(runDir, { recursive: true });

const results = [];
function record(id, description, expected, actual, pass, evidence = {}) {
  results.push({ id, description, expected, actual, pass, evidence });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} — ${description}${pass ? "" : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
}

const trialId = "r0";
const wslEventsPath = path.join(mailboxRunDir, "wsl.events.jsonl");
const writer = new EventWriter(wslEventsPath, path.join(runDir, "r0-wsl-seq.json"));

function emit(event, payload) {
  return writer.append(event, { run_id: runId, trial_id: trialId, ...payload });
}

// Helper: build a valid Windows-style event record as a JS object.
function winEvent(overrides = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    trial_id: trialId,
    seq: 1,
    event_id: `evt-${Math.random().toString(16).slice(2, 10)}`,
    event: "SAVE_ACCEPTED",
    timestamp_utc: new Date().toISOString(),
    ...overrides,
  };
}

// ── T1 UTF-8 roundtrip: 中文 / emoji / quotes / backslash ─────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t1-");
  const file = path.join(dir, "windows.events.jsonl");
  const special = "中文答案 🎉📝 \"引号\" '单引号' 反斜线\\路径 C:\\exam\\data";
  const ev = winEvent({ payload: { answer: special } });
  appendEventLine(file, serializeEventLine(ev));
  const reader = new JsonlFileReader(file, path.join(dir, "cursor.json"));
  const { records, rejected } = reader.poll();
  const roundtripped = records[0]?.value?.payload?.answer;
  record(
    "T1",
    "UTF-8 roundtrip 中文/emoji/quotes/backslash",
    special,
    roundtripped,
    roundtripped === special && rejected.length === 0,
    { dir },
  );
}

// ── T2 CRLF inside JSON string values preserved ───────────────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t2-");
  const file = path.join(dir, "windows.events.jsonl");
  const answerWithCrlf = "第一行\r\n第二行\r仅CR行\n尾随LF";
  const ev = winEvent({ payload: { answer_text: answerWithCrlf } });
  const line = serializeEventLine(ev);
  // The serialized line must contain no raw 0x0D (CR is escaped as \r).
  const rawHasCR = Buffer.from(line, "utf8").includes(0x0d);
  appendEventLine(file, line);
  const reader = new JsonlFileReader(file, path.join(dir, "cursor.json"));
  const { records, rejected } = reader.poll();
  const got = records[0]?.value?.payload?.answer_text;
  record(
    "T2",
    "answer-internal CRLF/CR preserved via escaping, no raw CR on the wire",
    { roundtrip: answerWithCrlf, rawCRForbidden: false },
    { roundtrip: got, rawCRForbidden: rawHasCR },
    got === answerWithCrlf && !rawHasCR && rejected.length === 0,
    { dir },
  );
}

// ── T3 BOM rejection ──────────────────────────────────────────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t3-");
  const file = path.join(dir, "windows.events.jsonl");
  const body = Buffer.from(serializeEventLine(winEvent()), "utf8");
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]));
  const reader = new JsonlFileReader(file, path.join(dir, "cursor.json"));
  const { records, rejected } = reader.poll();
  // BOM poisons only its own record (bytes valid, boundary known): that
  // record is rejected and never dispatched; the file channel stays alive.
  record(
    "T3",
    "BOM at record start rejected (record refused, no dispatch)",
    { records: 0, rejected: 1 },
    { records: records.length, rejected: rejected.length },
    records.length === 0 && rejected.length === 1 && /BOM/.test(rejected[0]?.reason ?? ""),
    { dir, rejectReason: rejected[0]?.reason },
  );
}

// ── T4 CRLF record separator rejection ────────────────────────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t4-");
  const file = path.join(dir, "windows.events.jsonl");
  const a = Buffer.from(serializeEventLine(winEvent({ seq: 1 })), "utf8");
  const b = Buffer.from(serializeEventLine(winEvent({ seq: 2 })), "utf8");
  // Windows-style writer: LF records terminated with CRLF.
  fs.writeFileSync(file, Buffer.concat([a, Buffer.from([0x0d]), b])); // A + \r + B
  const reader = new JsonlFileReader(file, path.join(dir, "cursor.json"));
  const { records, rejected } = reader.poll();
  // Record 1 absorbs the CR (its line ends "…}\r") → must be REJECTED;
  // record 2 is clean → must be processed. No CR-terminated record may act.
  record(
    "T4",
    "CRLF record separator: CR-carrying record rejected, following record unaffected",
    { accepted: 1, rejected: 1 },
    { accepted: records.length, rejected: rejected.length },
    records.length === 1 && rejected.length === 1 && /CR/.test(rejected[0].reason),
    { dir, rejectReason: rejected[0]?.reason },
  );
}

// ── T5 bare CR rejection (raw CR inside a record) ─────────────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t5-");
  const file = path.join(dir, "windows.events.jsonl");
  // Inject a RAW 0x0D byte into the serialized line (JSON.stringify would
  // escape a JS \r, so the raw byte must be spliced in after serialization).
  const poisoned = serializeEventLine(winEvent({ event: "SAVE_ACCEPTED" })).replace(
    "SAVE_ACCEPTED",
    "SAVE\r_ACCEPTED",
  );
  const clean = Buffer.from(serializeEventLine(winEvent({ seq: 2 })), "utf8");
  fs.writeFileSync(file, Buffer.concat([Buffer.from(poisoned, "utf8"), clean]));
  const reader = new JsonlFileReader(file, path.join(dir, "cursor.json"));
  const { records, rejected } = reader.poll();
  record(
    "T5",
    "raw CR inside a record rejected (CR never legal anywhere in a record)",
    { accepted: 1, rejected: 1 },
    { accepted: records.length, rejected: rejected.length },
    records.length === 1 && rejected.length === 1 && /CR/.test(rejected[0]?.reason ?? ""),
    { dir, rejectReason: rejected[0]?.reason },
  );
}

// ── T6 invalid UTF-8 rejection ────────────────────────────────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t6-");
  const file = path.join(dir, "windows.events.jsonl");
  const body = Buffer.from(serializeEventLine(winEvent()), "utf8");
  const bad = Buffer.from([0xff, 0xfe]);
  fs.writeFileSync(file, Buffer.concat([bad, body]));
  const reader = new JsonlFileReader(file, path.join(dir, "cursor.json"));
  const { records, halted } = reader.poll();
  record(
    "T6",
    "invalid UTF-8 rejected strictly (fail-closed halt, no replacement chars)",
    { records: 0, halted: true },
    { records: records.length, halted: Boolean(halted) },
    records.length === 0 && Boolean(halted) && /decode|UTF/.test(halted?.reason ?? ""),
    { dir, haltReason: halted?.reason },
  );
}

// ── T7 half line (no LF) never dispatched until complete ──────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t7-");
  const file = path.join(dir, "windows.events.jsonl");
  const full = serializeEventLine(winEvent({ seq: 1, event_id: "evt-half0001" }));
  fs.writeFileSync(file, Buffer.from(full.slice(0, 40), "utf8")); // partial JSON, no LF
  let reader = new JsonlFileReader(file, path.join(dir, "cursor.json"));
  const first = reader.poll();
  const firstCounts = { records: first.records.length, rejected: first.rejected.length };
  // Complete the line exactly as the writer would have.
  fs.appendFileSync(file, Buffer.from(full.slice(40), "utf8"));
  reader = new JsonlFileReader(file, path.join(dir, "cursor.json")); // simulate restart
  const second = reader.poll();
  record(
    "T7",
    "half-written JSONL line not acted on; completed line processed exactly once",
    { before: { records: 0, rejected: 0 }, after: { records: 1, rejected: 0 } },
    { before: firstCounts, after: { records: second.records.length, rejected: second.rejected.length } },
    firstCounts.records === 0 && firstCounts.rejected === 0 && second.records.length === 1,
    { dir },
  );
}

// ── T8 oversize record (>64 KiB) rejection ────────────────────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t8-");
  const file = path.join(dir, "windows.events.jsonl");
  const big = "x".repeat(MAX_RECORD_BYTES + 1);
  const ev = winEvent({ payload: { blob: big } });
  fs.writeFileSync(file, Buffer.from(serializeEventLine(ev), "utf8"));
  const reader = new JsonlFileReader(file, path.join(dir, "cursor.json"));
  const { records, rejected } = reader.poll();
  record(
    "T8",
    "record over 64 KiB rejected",
    { accepted: 0, rejected: 1 },
    { accepted: records.length, rejected: rejected.length },
    records.length === 0 && rejected.length === 1 && /exceeds limit/.test(rejected[0]?.reason ?? ""),
    { dir, rejectReason: rejected[0]?.reason?.slice(0, 120) },
  );
}

// ── T9 invalid JSON rejection ─────────────────────────────────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t9-");
  const file = path.join(dir, "windows.events.jsonl");
  fs.writeFileSync(file, Buffer.from("{\"event\": \"SAVE_ACCEPTED\", oops}\n", "utf8"));
  const reader = new JsonlFileReader(file, path.join(dir, "cursor.json"));
  const { records, rejected } = reader.poll();
  record(
    "T9",
    "invalid JSON rejected",
    { accepted: 0, rejected: 1 },
    { accepted: records.length, rejected: rejected.length },
    records.length === 0 && rejected.length === 1,
    { dir, rejectReason: rejected[0]?.reason },
  );
}

// ── T10 duplicate JSON key rejection ──────────────────────────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t10-");
  const file = path.join(dir, "windows.events.jsonl");
  fs.writeFileSync(
    file,
    Buffer.from('{"schema_version":"' + SCHEMA_VERSION + '","run_id":"' + runId + '","trial_id":"' + trialId + '","seq":1,"event_id":"evt-dupkey001","event":"SAVE_ACCEPTED","timestamp_utc":"2026-10-25T00:00:00.000Z","seq":2}\n', "utf8"),
  );
  const reader = new JsonlFileReader(file, path.join(dir, "cursor.json"));
  const { records, rejected } = reader.poll();
  record(
    "T10",
    "duplicate JSON key (seq twice) rejected",
    { accepted: 0, rejected: 1 },
    { accepted: records.length, rejected: rejected.length },
    records.length === 0 && rejected.length === 1 && /duplicate/.test(rejected[0]?.reason ?? ""),
    { dir, rejectReason: rejected[0]?.reason },
  );
}

// ── T11 missing required field rejection ──────────────────────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t11-");
  const file = path.join(dir, "windows.events.jsonl");
  const ev = winEvent();
  delete ev.seq;
  fs.writeFileSync(file, Buffer.from(serializeEventLine(ev), "utf8"));
  const reader = new JsonlFileReader(file, path.join(dir, "cursor.json"));
  const { records, rejected } = reader.poll();
  record(
    "T11",
    "missing required field (seq) rejected",
    { accepted: 0, rejected: 1 },
    { accepted: records.length, rejected: rejected.length },
    records.length === 0 && rejected.length === 1 && /'seq'/.test(rejected[0]?.reason ?? ""),
    { dir, rejectReason: rejected[0]?.reason },
  );
}

// ── T12 wrong schema_version / wrong run_id / wrong trial_id ──────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t12-");
  const file = path.join(dir, "windows.events.jsonl");
  const lines = [
    serializeEventLine(winEvent({ seq: 1, schema_version: "exam817/2" })),
    serializeEventLine(winEvent({ seq: 2, run_id: "other-run" })),
    serializeEventLine(winEvent({ seq: 3, trial_id: "other-trial" })),
  ];
  fs.writeFileSync(file, Buffer.concat(lines.map((l) => Buffer.from(l, "utf8"))));
  const reader = new JsonlFileReader(file, path.join(dir, "cursor.json"), {});
  const first = reader.poll();
  // No expected ids passed to reader → wrong schema_version is a reader-layer
  // envelope rejection; wrong run/trial parse fine and are filtered at the
  // dispatch layer (never dispatched for action).
  const envBad = first.rejected.filter((r) => /schema_version/.test(r.reason)).length;
  const dispatched = first.records.filter(
    (r) => r.value.run_id === runId && r.value.trial_id === trialId,
  );
  record(
    "T12",
    "wrong schema_version rejected at envelope layer; wrong run_id/trial_id parsed but never dispatched",
    { dispatched: 0, envRejected: 1, readerAccepted: 2 },
    { dispatched: dispatched.length, envRejected: envBad, readerAccepted: first.records.length },
    dispatched.length === 0 && envBad === 1 && first.records.length === 2,
    { dir, rejectReasons: first.rejected.map((r) => r.reason) },
  );
}

// ── T13 duplicate event does not re-execute ───────────────────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t13-");
  const file = path.join(dir, "windows.events.jsonl");
  const ev = winEvent({ seq: 7, event_id: "evt-dup-fixed1" });
  const line = serializeEventLine(ev);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(line, "utf8"), Buffer.from(line, "utf8")]));
  const reader = new JsonlFileReader(file, path.join(dir, "cursor.json"));
  const seen = new Set();
  let actions = 0;
  const { records } = reader.poll();
  for (const rec of records) {
    const key = `windows.events.jsonl|${rec.value.run_id}|${rec.value.trial_id}|${rec.value.seq}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actions += 1; // stand-in for a fault action
  }
  record(
    "T13",
    "duplicate event (same writer+run+trial+seq) executes its action exactly once",
    { actions: 1, recordsSeen: 2 },
    { actions, recordsSeen: records.length },
    actions === 1 && records.length === 2,
    { dir },
  );
}

// ── T14 reader restart resumes from persisted cursor ──────────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t14-");
  const file = path.join(dir, "windows.events.jsonl");
  const cursor = path.join(dir, "cursor.json");
  const mk = (seq) => Buffer.from(serializeEventLine(winEvent({ seq, event_id: `evt-resume${String(seq).padStart(4, "0")}` })), "utf8");
  fs.writeFileSync(file, Buffer.concat([mk(1), mk(2)]));
  let reader = new JsonlFileReader(file, cursor);
  const first = reader.poll();
  reader.saveCursor();
  // Harness restarts: fresh reader instance from the same cursor file.
  reader = new JsonlFileReader(file, cursor);
  const empty = reader.poll();
  fs.appendFileSync(file, mk(3));
  const third = reader.poll();
  reader.saveCursor();
  record(
    "T14",
    "reader restart resumes: no replay of old records, new record processed",
    { first: 2, afterRestart: 0, afterAppend: 1 },
    { first: first.records.length, afterRestart: empty.records.length, afterAppend: third.records.length },
    first.records.length === 2 && empty.records.length === 0 && third.records.length === 1,
    { dir },
  );
}

// ── T15 atomic full-file publication semantics ────────────────────
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t15-");
  const target = path.join(dir, "scenario.json");
  atomicWriteJson(target, { run_id: runId, marker: "v1" });
  const v1 = readPublishedJson(target);
  // Simulate a crashed publisher: leftover temp file must be invisible.
  fs.writeFileSync(path.join(dir, ".scenario.json.tmp-999-abc"), "{ half");
  const v2 = readPublishedJson(target);
  atomicWriteJson(target, { run_id: runId, marker: "v2" });
  const v3 = readPublishedJson(target);
  const leftovers = fs.readdirSync(dir).filter((f) => f.startsWith(".scenario.json.tmp-999"));
  const halfParsesOk = (() => {
    try {
      parseJsonStrict("{ half");
      return true;
    } catch (e) {
      return false;
    }
  })();
  record(
    "T15",
    "atomic publish: temp files invisible to readers, replacement is whole-file, half-JSON never parses",
    { v1: "v1", interrupted: "v1", v3: "v2", leftoversVisible: true, halfParsesOk: false },
    { v1: v1?.marker, interrupted: v2?.marker, v3: v3?.marker, leftoversVisible: leftovers.length === 1, halfParsesOk },
    v1?.marker === "v1" && v2?.marker === "v1" && v3?.marker === "v2" && leftovers.length === 1 && !halfParsesOk,
    { dir },
  );
}

// ── T16 wrong-target envelope: negative seq / bad timestamp ───────
{
  const badTs = winEvent({ seq: 1, timestamp_utc: "2026-10-25 12:00:00" });
  const badSeq = winEvent({ seq: -1 });
  const r1 = validateEnvelope(badTs);
  const r2 = validateEnvelope(badSeq);
  record(
    "T16",
    "envelope validation rejects non-UTC timestamp and negative seq",
    { ts: false, seq: false },
    { ts: r1.ok, seq: r2.ok },
    r1.ok === false && r2.ok === false,
    { reasons: [r1.reason, r2.reason] },
  );
}

// ── T17/T18/T19 F3 regression: psql stdout parsing (#819) ─────────
// Historical failure: `psql -At` echoes BEGIN/COMMIT command tags when a
// query runs multi-statement; the snapshot parser must never let that shape
// corrupt (or silently shrink) an attempt snapshot.
{
  const row = JSON.stringify({ id: "00000000-0000-0000-0000-00000000000a", status: "in_progress", answers: [] });
  // T17: clean single-statement output parses to exactly one row, no tags.
  const clean = parsePsqlJsonRows(`${row}\n`);
  record(
    "T17",
    "F3: single-SELECT psql stdout parses to exactly one JSON row",
    { rows: 1, tags: 0 },
    { rows: clean.rows.length, tags: clean.psqlTags.length },
    clean.rows.length === 1 && clean.rows[0].id === "00000000-0000-0000-0000-00000000000a" && clean.psqlTags.length === 0,
  );

  // T18: the historical F3 shape (tag echo around the JSON row) still parses
  // AND the tags are reported — tolerated, never silently dropped.
  const tagged = parsePsqlJsonRows(`BEGIN\n${row}\nCOMMIT\n`);
  record(
    "T18",
    "F3: BEGIN/COMMIT tag echo tolerated and surfaced, row intact",
    { rows: 1, tags: ["BEGIN", "COMMIT"] },
    { rows: tagged.rows.length, tags: tagged.psqlTags },
    tagged.rows.length === 1 && tagged.rows[0].status === "in_progress" && JSON.stringify(tagged.psqlTags) === JSON.stringify(["BEGIN", "COMMIT"]),
  );

  // T19: any other unexpected stdout is a LOUD error — the parser must not
  // skip lines it does not recognize ("cannot silently ignore stdout").
  let threw = false;
  let threwMessage = "";
  try {
    parsePsqlJsonRows(`psql: warning: connection reset\n${row}\n`, { what: "T19 probe" });
  } catch (e) {
    threw = true;
    threwMessage = e.message;
  }
  record(
    "T19",
    "F3: unexpected non-JSON psql stdout throws (never silently ignored)",
    { threw: true, mentions: "T19 probe" },
    { threw, message: threwMessage.slice(0, 120) },
    threw && threwMessage.includes("T19 probe"),
  );
}

// ── T20–T28 F7: frozen BROWSER_VERIFIED schema v2 (#817 D135 brief §2) ──
// History: D0 shipped browser_value, the as-built harness visible_value,
// D2's Windows agent browser_answer — three layouts absorbed by alias
// chains. v2 is canonical; every legacy layout MUST be rejected.
{
  const manifestQuestions = [
    { question_id: "00000000-0000-0000-0000-0000000000q1", order: 1, type: "fill_blank", expected_gen1: "x", expected_gen2: null },
    { question_id: "00000000-0000-0000-0000-0000000000q2", order: 2, type: "single_choice", expected_gen1: "A", expected_gen2: null },
  ];
  const attemptId = "00000000-0000-0000-0000-00000000000a";
  const validEvent = {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    trial_id: trialId,
    seq: 9,
    event_id: "evt-browser-v2-001",
    event: "BROWSER_VERIFIED",
    timestamp_utc: "2026-10-26T00:00:00.000Z",
    browser_result_schema_version: BROWSER_RESULT_SCHEMA_VERSION,
    attempt_id: attemptId,
    per_question: [
      { question_id: manifestQuestions[0].question_id, browser_answer: "x", browser_matches_last_ack: true },
      { question_id: manifestQuestions[1].question_id, browser_answer: "A" },
    ],
  };

  // T20: a conforming v2 event parses and maps to the oracle's browser_state.
  {
    const withWriter = { ...validEvent, writer: "windows" };
    const parsed = parseBrowserVerified(withWriter, { manifestQuestions, attemptId });
    record(
      "T20",
      "F7: conforming v2 BROWSER_VERIFIED (incl. envelope writer) parses to oracle browser_state",
      { questions: 2, schema: 2 },
      { questions: Object.keys(parsed.browser_state).length, schema: parsed.schema_version },
      parsed.schema_version === 2 &&
        Object.keys(parsed.browser_state).length === 2 &&
        parsed.browser_state[manifestQuestions[0].question_id].visible_value === "x" &&
        parsed.browser_state[manifestQuestions[1].question_id].browser_matches_last_ack === null,
      { contract_schema_version: browserResultContract().schema_version },
    );
  }
  const expectReject = (id, desc, ev, code) => {
    let threw = null;
    try {
      parseBrowserVerified(ev, { manifestQuestions, attemptId });
    } catch (e) {
      threw = e;
    }
    record(
      id,
      desc,
      { threw: true, code },
      { threw: threw !== null, code: threw?.code ?? null, message: threw?.message?.slice(0, 140) },
      threw instanceof BrowserSchemaError && threw.code === code,
    );
  };

  // T21: D0 layout (browser_value) rejected.
  expectReject("T21", "F7: legacy D0 per_question field 'browser_value' rejected", {
    ...validEvent,
    per_question: [{ question_id: manifestQuestions[0].question_id, browser_value: "x" }],
  }, "LEGACY_FIELD");

  // T22: as-built layout (visible_value) rejected.
  expectReject("T22", "F7: legacy as-built per_question field 'visible_value' rejected", {
    ...validEvent,
    per_question: [{ question_id: manifestQuestions[0].question_id, visible_value: "x" }],
  }, "LEGACY_FIELD");

  // T23: D0 top-level browser_answers[] layout rejected.
  expectReject("T23", "F7: legacy top-level browser_answers[] layout rejected", {
    ...validEvent,
    browser_answers: [{ question_id: manifestQuestions[0].question_id, browser_answer: "x" }],
  }, "LEGACY_FIELD");

  // T24: attempt mismatch rejected.
  expectReject("T24", "F7: attempt_id mismatch vs the trial attempt rejected", {
    ...validEvent,
    attempt_id: "00000000-0000-0000-0000-0000000000zz",
  }, "ATTEMPT_MISMATCH");

  // T25: a manifest question missing from per_question rejected.
  expectReject("T25", "F7: manifest question missing from per_question rejected", {
    ...validEvent,
    per_question: [validEvent.per_question[0]],
  }, "MISSING_QUESTION");

  // T26: non-manifest question rejected.
  expectReject("T26", "F7: non-manifest question_id rejected", {
    ...validEvent,
    per_question: [
      ...validEvent.per_question,
      { question_id: "00000000-0000-0000-0000-0000000000qx", browser_answer: "y" },
    ],
  }, "UNKNOWN_QUESTION");

  // T27: unknown extra field rejected (no schema drift by accretion).
  expectReject("T27", "F7: unknown top-level field rejected", {
    ...validEvent,
    browser_state_extra: {},
  }, "UNKNOWN_FIELD");

  // T28: missing or wrong browser_result_schema_version rejected.
  {
    const noVersion = { ...validEvent };
    delete noVersion.browser_result_schema_version;
    let threwA = null;
    try {
      parseBrowserVerified(noVersion, { manifestQuestions, attemptId });
    } catch (e) {
      threwA = e;
    }
    let threwB = null;
    try {
      parseBrowserVerified({ ...validEvent, browser_result_schema_version: 1 }, { manifestQuestions, attemptId });
    } catch (e) {
      threwB = e;
    }
    record(
      "T28",
      "F7: missing/wrong browser_result_schema_version rejected",
      { missing: "SCHEMA_VERSION_MISSING", wrong: "SCHEMA_VERSION_UNSUPPORTED" },
      { missing: threwA?.code ?? null, wrong: threwB?.code ?? null },
      threwA?.code === "SCHEMA_VERSION_MISSING" && threwB?.code === "SCHEMA_VERSION_UNSUPPORTED",
    );
  }

  // T29: browser_answer must be a canonical observable value; null is legal
  // (empty field), plain objects are not.
  {
    let nullOk = null;
    try {
      parseBrowserVerified(
        { ...validEvent, per_question: [{ question_id: manifestQuestions[0].question_id, browser_answer: null }, validEvent.per_question[1]] },
        { manifestQuestions, attemptId },
      );
      nullOk = true;
    } catch {
      nullOk = false;
    }
    let objThrew = null;
    try {
      parseBrowserVerified(
        { ...validEvent, per_question: [{ question_id: manifestQuestions[0].question_id, browser_answer: { nested: true } }] },
        { manifestQuestions, attemptId },
      );
    } catch (e) {
      objThrew = e;
    }
    record(
      "T29",
      "F7: browser_answer type gate — null allowed, plain object rejected",
      { nullAllowed: true, objectCode: "BROWSER_ANSWER_TYPE" },
      { nullAllowed: nullOk, objectCode: objThrew?.code ?? null },
      nullOk === true && objThrew?.code === "BROWSER_ANSWER_TYPE",
    );
  }
}

// ── T30–T32 F6: fault-window probe summary (#817 D135 brief §2/§8) ──
{
  const mk = (tMs, api, stat, containers) => ({
    t_ms: tMs,
    t: new Date(new Date("2026-10-26T00:00:00.000Z").getTime() + tMs).toISOString(),
    static: stat,
    api_ready: api,
    containers: containers ?? { app: "running", db: "running", web: "running" },
  });
  const ok = { ok: true, status: 200 };
  const fail503 = { ok: false, status: 503 };

  // T30: OBSERVED — failure samples bound the outage; the window is between
  // the first failed sample and the first OK sample; bounded window includes
  // the last OK before the failure.
  {
    const samples = [
      mk(0, ok, ok),
      mk(300, ok, ok),
      mk(600, fail503, ok),
      mk(900, fail503, ok),
      mk(1200, ok, ok),
    ];
    const s = summarizeProbeSamples(samples, { intervalMs: 300, startedAtIso: samples[0].t, stoppedAtIso: samples[4].t });
    record(
      "T30",
      "F6: observed outage computed from failed/OK samples only",
      { observed: "OBSERVED", http_ms: 600, bounded_ms: 900 },
      { observed: s.observed_api_outage, http_ms: s.api.observed_outage_ms, bounded_ms: s.api.bounded_outage_ms },
      s.observed_api_outage === "OBSERVED" &&
        s.api.observed_outage_ms === 600 &&
        s.api.bounded_outage_ms === 900 &&
        s.api.first_fail_at === samples[2].t &&
        s.api.first_ok_after_fail_at === samples[4].t,
    );
  }

  // T31: no failed sample → NOT_ESTABLISHED (never fabricated).
  {
    const samples = [mk(0, ok, ok), mk(300, ok, ok), mk(600, ok, ok)];
    const s = summarizeProbeSamples(samples, { intervalMs: 300, startedAtIso: samples[0].t, stoppedAtIso: samples[2].t });
    record(
      "T31",
      "F6: no failed sample → NOT_ESTABLISHED, no fabricated window",
      { observed: "NOT_ESTABLISHED", http_ms: null },
      { observed: s.observed_api_outage, http_ms: s.api?.observed_outage_ms ?? null, reason: s.not_established_reason },
      s.observed_api_outage === "NOT_ESTABLISHED" && s.api.observed_outage_ms === undefined,
    );
  }

  // T32: D3 shape — /api/ready fails (db down) while nginx static keeps
  // serving; the two channels summarize independently.
  {
    const samples = [mk(0, ok, ok), mk(300, fail503, ok), mk(600, fail503, ok), mk(900, ok, ok)];
    const s = summarizeProbeSamples(samples, { intervalMs: 300, startedAtIso: samples[0].t, stoppedAtIso: samples[3].t });
    record(
      "T32",
      "F6: static and /api/ready channels summarize independently (D3 shape)",
      { api: "OBSERVED", static_observed: false },
      { api: s.observed_api_outage, static_observed: s.static.observed, static_failures: s.static.first_fail_at },
      s.observed_api_outage === "OBSERVED" && s.static.observed === false,
    );
  }
}

// ── T33 F9 regression: PGDATA survival vs the versioned layout ─────
// D5-01 live failure: the postgres:18 Debian image puts PGDATA at
// /var/lib/postgresql/<major>/docker, so a host-side check of
// <pgdata>/PG_VERSION mis-fires and aborts a real trial. The fixed check
// runs inside a throwaway read-only container and searches by layout.
{
  const dir = fs.mkdtempSync("/tmp/e817-r0-t33-");
  fs.mkdirSync(path.join(dir, "18", "docker"), { recursive: true });
  fs.writeFileSync(path.join(dir, "18", "docker", "PG_VERSION"), "18\n");
  // The old (buggy) check: fixed unversioned path.
  const oldCheck = fs.existsSync(path.join(dir, "PG_VERSION"));
  // Host-side mirror of the fixed shell's find semantics (the real check
  // runs in-container where postgres-uid permissions do not apply).
  const findLike = (root, depth = 0) => {
    let hits = [];
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      const p = path.join(root, e.name);
      if (e.isDirectory() && depth + 1 < 3) hits = hits.concat(findLike(p, depth + 1));
      else if (e.isFile() && e.name === "PG_VERSION") hits.push(p);
    }
    return hits;
  };
  const hits = findLike(dir);
  const shell = pgdataSurvivalShell();
  record(
    "T33",
    "F9: PGDATA survival searches the versioned layout, not a fixed host path",
    { oldCheckFails: true, newHits: 1, shellSearchesByFind: true },
    { oldCheckFails: oldCheck === false, newHits: hits.length, shellSearchesByFind: /find \/pgdata -maxdepth 3 -name PG_VERSION/.test(shell) },
    oldCheck === false && hits.length === 1 && /find \/pgdata -maxdepth 3 -name PG_VERSION/.test(shell),
    { dir },
  );
}

// ── T34 F11 regression: absent browser leg = NOT_RUN, never vacuous pass ──
{
  const manifestQuestions = [
    { question_id: "00000000-0000-0000-0000-0000000000q1", order: 1, type: "fill_blank", expected_gen1: "x", expected_gen2: null },
  ];
  const attemptRow = {
    id: "00000000-0000-0000-0000-00000000000a",
    status: "in_progress",
    answers: [{ questionId: "00000000-0000-0000-0000-0000000000q1", answer: "x", version: 1, savedAt: "2026-10-26T00:00:00.000Z" }],
  };
  const ackState = { "00000000-0000-0000-0000-0000000000q1": { generation: 1, serverVersion: 1, evidence_ref: "synthetic", answer_value: "x" } };
  // browserState = {} (no BROWSER_VERIFIED received): PG leg matches, but the
  // browser classification must be NOT_RUN — the verdict layer treats any
  // NOT_RUN as fail-closed UNKNOWN.
  const r = classifyPerQuestion({ manifestQuestions, attemptRow, ackState, browserState: {}, apiState: {} });
  record(
    "T34",
    "F11: absent browser/API legs classify per-question NOT_RUN (never vacuously absent)",
    { browser: "NOT_RUN", api: "NOT_RUN", pg: "ACK_MATCHED" },
    { browser: r[0].browser_classification, api: r[0].api_classification, pg: r[0].classification },
    r[0].browser_classification === "NOT_RUN" && r[0].api_classification === "NOT_RUN" && r[0].classification === "ACK_MATCHED",
  );
}

// ── T35 R3 arm registry ───────────────────────────────────────────
{
  const ok =
    FAULT_PLAN.D6?.action === "none" &&
    FAULT_PLAN.D7?.action === "none" &&
    FAULT_PLAN.D8A?.action === "kill" && FAULT_PLAN.D8A?.target === "app" &&
    FAULT_PLAN.D8B?.action === "kill" && FAULT_PLAN.D8B?.target === "db" &&
    D7_DEBOUNCE_MS === 1500 &&
    scratchProjectName("e817-d6-x").startsWith("exam817-e817-d6-x") &&
    scratchPaths("e817-d6-x").root.includes("/scratch");
  record(
    "T35",
    "R3: fault registry carries D6/D7/D8A/D8B; D7 debounce constant 1500; scratch paths isolated",
    { d6: "none", d7: "none", d8a: "kill:app", d8b: "kill:db", debounce: 1500 },
    {
      d6: FAULT_PLAN.D6?.action, d7: FAULT_PLAN.D7?.action,
      d8a: `${FAULT_PLAN.D8A?.action}:${FAULT_PLAN.D8A?.target}`,
      d8b: `${FAULT_PLAN.D8B?.action}:${FAULT_PLAN.D8B?.target}`,
      debounce: D7_DEBOUNCE_MS,
    },
    ok,
  );
}

// ── T36–T42 D7 treatment classifier ───────────────────────────────
{
  const mk = (qid) => ({ question_id: qid, order: 1, type: "fill_blank", nominal_reload_delay_ms: 300, expected_value: "m|t|q|g1" });
  const win = (over = {}) => ({
    input_confirmed: true,
    dom_value_before_reload: "m|t|q|g1",
    last_input_at: "2026-10-26T00:00:00.000Z",
    reload_initiated_at: "2026-10-26T00:00:00.300Z",
    save_requests: [],
    save_responses: [],
    post_reload_value: null,
    ...over,
  });
  const pgAbsent = { present: false, version: null, value_matches_treatment: null };
  const t = (windows, pg, over = {}) => classifyD7Treatment({ treatment: mk("q"), windows, pg, ...over });

  // T36: clean in-window loss.
  const r36 = t(win(), pgAbsent);
  // T37: request sent but no captured response → SENT_BUT_UNKNOWN, PG decides.
  const r37 = t(win({ save_requests: [{ question_id: "q", at: "2026-10-26T00:00:00.250Z", request_id: "r1" }] }), pgAbsent);
  // T38: S+A+P inside window (mis-executed treatment / very fast save) → SAVED_ACKED.
  const r38 = t(
    win({
      save_requests: [{ question_id: "q", at: "2026-10-26T00:00:00.250Z", request_id: "r1" }],
      save_responses: [{ question_id: "q", at: "2026-10-26T00:00:00.280Z", acked: true }],
    }),
    { present: true, version: 1, value_matches_treatment: true },
  );
  // T39: unmeasurable timing → UNCONTROLLED (never a loss claim).
  const r39 = t(win({ reload_initiated_at: null }), pgAbsent);
  // T40: P present with NO observed request → UNKNOWN (anomaly, fail closed).
  const r40 = t(win(), { present: true, version: 1, value_matches_treatment: true });
  // T41: input not proven (DOM read-back mismatch) → UNKNOWN.
  const r41 = t(win({ dom_value_before_reload: "something-else" }), pgAbsent);
  // T42: boundary control — reload AFTER the debounce with S+A+P → SAVED_ACKED;
  //      and a silent post-debounce window → DEBOUNCE_NOT_FIRED finding.
  const r42a = t(
    win({
      reload_initiated_at: "2026-10-26T00:00:02.500Z",
      save_requests: [{ question_id: "q", at: "2026-10-26T00:00:01.600Z", request_id: "r1" }],
      save_responses: [{ question_id: "q", at: "2026-10-26T00:00:01.650Z", acked: true }],
    }),
    { present: true, version: 1, value_matches_treatment: true },
  );
  const r42b = t(win({ reload_initiated_at: "2026-10-26T00:00:02.500Z" }), pgAbsent);
  // T1-of-D7-01 regression: the real event layout (approx input derivation,
  // epoch-ms reload stamps, no input_confirmed, empty responses) must classify
  // SENT_BUT_UNKNOWN with the PG outcome — never UNKNOWN-by-parser-gap.
  const rawT1 = {
    actual_last_input_at_utc_approx: "2026-10-26T00:44:35.856Z",
    dom_value_before_reload: "m|t|q|g1",
    dom_value_after_reload: "m|t|q|g1",
    reload_fired_at_epoch_ms: 1792975495335,
    save_requests: [{ question_id: "q", at: "2026-10-26T00:44:36.000Z", request_id: "r66" }],
    save_responses: [],
  };
  const wNorm = normalizeTreatmentWindows(rawT1);
  const rT1 = classifyD7Treatment({
    treatment: mk("q"),
    windows: wNorm,
    pg: { present: true, version: 1, value_matches_treatment: true },
  });
  const rT1epoch = Date.parse(wNorm.reload_initiated_at);

  const pass =
    r36.classification === "LOCAL_UNSENT_LOST" &&
    r37.classification === "SENT_BUT_UNKNOWN" && r37.pg_outcome === "ABSENT" &&
    r38.classification === "SAVED_ACKED" &&
    r39.classification === "UNCONTROLLED" &&
    r40.classification === "UNKNOWN" &&
    r41.classification === "UNKNOWN" &&
    r42a.classification === "SAVED_ACKED" &&
    r42b.classification === "DEBOUNCE_NOT_FIRED" &&
    rT1.classification === "SENT_BUT_UNKNOWN" && rT1.pg_outcome === "PRESENT_MATCHING" &&
    rT1.measured_reload_delta_ms >= 1500 && rT1epoch === 1792975495335;
  record(
    "T36",
    "D7 classifier: E/S/A/P combinations land on the frozen vocabulary; the D7-01 T1 real layout (approx input + epoch reload stamps) replays to SENT_BUT_UNKNOWN/PERSISTED",
    { clean: "LOCAL_UNSENT_LOST", sent: "SENT_BUT_UNKNOWN", acked: "SAVED_ACKED", notime: "UNCONTROLLED", leak: "UNKNOWN", noinput: "UNKNOWN", boundary: "SAVED_ACKED", silent: "DEBOUNCE_NOT_FIRED", t1: "SENT_BUT_UNKNOWN:PRESENT_MATCHING" },
    {
      clean: r36.classification, sent: r37.classification, acked: r38.classification,
      notime: r39.classification, leak: r40.classification, noinput: r41.classification,
      boundary: r42a.classification, silent: r42b.classification,
      t1: `${rT1.classification}:${rT1.pg_outcome}`,
    },
    pass,
  );
}

// ── T43 D7 trial summary ──────────────────────────────────────────
{
  const ok = { question_id: "00000000-0000-0000-0000-00000000000c", classification: "ACK_MATCHED" };
  const lost = (qid) => ({ question_id: qid, classification: "LOCAL_UNSENT_LOST" });
  const saved = (qid) => ({ question_id: qid, classification: "SAVED_ACKED" });
  const sum = summarizeD7({ controlResults: [ok, ok], treatmentResults: [lost("t1"), lost("t2"), saved("t3"), saved("t4")] });
  const brokenControl = summarizeD7({ controlResults: [ok, { ...ok, classification: "ACK_LOST" }], treatmentResults: [lost("t1")] });
  const withUncontrolled = summarizeD7({ controlResults: [ok, ok], treatmentResults: [lost("t1"), { question_id: "t2", classification: "UNCONTROLLED" }] });
  const withAnomaly = summarizeD7({ controlResults: [ok, ok], treatmentResults: [lost("t1"), { question_id: "t2", classification: "UNKNOWN" }] });
  record(
    "T43",
    "D7 summarize: UNCONTROLLED samples are excluded evidence (non-blocking); UNKNOWN anomalies block; broken controls block",
    { good: "LOCAL_UNSENT_LOST", unctrl: "LOCAL_UNSENT_LOST", anomaly: "UNKNOWN", ctrl: "UNKNOWN" },
    { good: sum.verdict, unctrl: withUncontrolled.verdict, anomaly: withAnomaly.verdict, ctrl: brokenControl.verdict },
    sum.verdict === "LOCAL_UNSENT_LOST" && withUncontrolled.verdict === "LOCAL_UNSENT_LOST" &&
      withAnomaly.verdict === "UNKNOWN" && brokenControl.verdict === "UNKNOWN",
  );
}

// ── T44–T45 D6 restore comparator ─────────────────────────────────
{
  const mkManifest = (qid, type = "fill_blank") => ({ question_id: qid, order: 1, type, expected_gen1: "pre", expected_gen2: null });
  const pre = (v) => ({ serverVersion: 1, answer_value: v, evidence_ref: "synthetic" });
  const post = (v) => ({ serverVersion: 2, answer_value: v, evidence_ref: "synthetic" });
  const row = (answers) => ({ id: "a", answers });

  // T44: faithful old snapshot — pre retained, post missing.
  const r44 = compareD6({
    manifestQuestions: [mkManifest("q1"), mkManifest("q2")],
    scratchRow: row([
      { questionId: "q1", answer: "pre", version: 1, savedAt: "x" },
      { questionId: "q2", answer: "pre", version: 1, savedAt: "x" },
    ]),
    ackStatePre: { q1: pre("pre"), q2: pre("pre") },
    ackStatePost: { q2: post("post") },
  });
  const t44ok = r44[0].classification === "PRE_DUMP_RETAINED" && r44[1].classification === "POST_DUMP_MISSING";

  // T45a: restore lost even the pre-dump answer → RESTORE_INTEGRITY_FAILURE.
  const r45a = compareD6({
    manifestQuestions: [mkManifest("q1"), mkManifest("q2")],
    scratchRow: row([{ questionId: "q2", answer: "pre", version: 1, savedAt: "x" }]),
    ackStatePre: { q1: pre("pre"), q2: pre("pre") },
    ackStatePost: { q2: post("post") },
  });
  // T45b: restored DB somehow holds the post-dump value → DUMP_WINDOW_VIOLATED.
  const r45b = compareD6({
    manifestQuestions: [mkManifest("q1"), mkManifest("q2")],
    scratchRow: row([
      { questionId: "q1", answer: "pre", version: 1, savedAt: "x" },
      { questionId: "q2", answer: "post", version: 2, savedAt: "x" },
    ]),
    ackStatePre: { q1: pre("pre"), q2: pre("pre") },
    ackStatePost: { q2: post("post") },
  });
  const rpo = measureRpo({
    dumpReceipt: { completed_at: "2026-10-26T00:00:00.000Z" },
    ackStatePost: { q2: { serverVersion: 2, at: "2026-10-26T00:01:30.000Z" } },
  });
  record(
    "T45",
    "D6 comparator: integrity failure and dump-window violation are distinct classifications; RPO window measured",
    { a: "RESTORE_INTEGRITY_FAILURE", b: "DUMP_WINDOW_VIOLATED", rpo_ms: 90000, lost: 1 },
    { a: r45a[0].classification, b: r45b[1].classification, rpo_ms: rpo.per_answer[0].rpo_ms, lost: rpo.lost_answer_count },
    r45a[0].classification === "RESTORE_INTEGRITY_FAILURE" && r45b[1].classification === "DUMP_WINDOW_VIOLATED" &&
      rpo.per_answer[0].rpo_ms === 90000 && rpo.lost_answer_count === 1,
  );
  record(
    "T44",
    "D6 comparator: faithful old snapshot → PRE_DUMP_RETAINED + POST_DUMP_MISSING (the RPO fact)",
    { pre: "PRE_DUMP_RETAINED", post: "POST_DUMP_MISSING" },
    { pre: r44[0].classification, post: r44[1].classification },
    t44ok,
  );
}

// ── T46 D8 submitted-answers gate ─────────────────────────────────
{
  const manifest = [
    { question_id: "q1", order: 1, type: "fill_blank", expected_gen1: "a", expected_gen2: null },
    { question_id: "q2", order: 2, type: "single_choice", expected_gen1: "B", expected_gen2: null },
  ];
  const answers = [
    { questionId: "q1", answer: "a", version: 1, savedAt: "x" },
    { questionId: "q2", answer: "B", version: 1, savedAt: "x" },
  ];
  const good = compareSubmittedAnswers({ answers, submitted: { schemaVersion: 1, answers: [{ questionId: "q1", value: "a" }, { questionId: "q2", value: "B" }] }, manifestQuestions: manifest });
  const bad = compareSubmittedAnswers({ answers, submitted: { schemaVersion: 1, answers: [{ questionId: "q1", value: "WRONG" }, { questionId: "q2", value: "B" }] }, manifestQuestions: manifest });
  const malformed = compareSubmittedAnswers({ answers, submitted: { schemaVersion: 1, answers: [{ q: "q1", v: "a" }] }, manifestQuestions: manifest });
  const accepts = (r) => r.comparable && r.mismatches.length === 0;
  record(
    "T46",
    "D8 submitted-answers gate: shape-aware value comparison; mismatch fails via mismatches[], malformed via comparable=false",
    { good: true, bad: false, malformed: false },
    { good: accepts(good), bad: accepts(bad), malformed: accepts(malformed) },
    accepts(good) && !accepts(bad) && !accepts(malformed),
  );
}

// ── T47 R3 oracle mutation cross-checks stay intact ───────────────
{
  const mu = oracleMutationRedTest();
  record(
    "T47",
    "R3: oracle mutation RED/GREEN unchanged after valuesEqual export",
    { red: true, green: true },
    { red: mu.red, green: mu.green },
    mu.red === true && mu.green === true,
  );
}

// ── Receipt + events ──────────────────────────────────────────────
const allPass = results.every((r) => r.pass);
const receipt = {
  schema_version: SCHEMA_VERSION,
  kind: "exam817/r0-receipt",
  run_id: runId,
  trial_id: trialId,
  source_sha: "1bd86027650edb083b315ea1eed73308968ef932",
  generated_at: new Date().toISOString(),
  total: results.length,
  passed: results.filter((r) => r.pass).length,
  failed: results.filter((r) => !r.pass).length,
  gate: allPass ? "R0_PASS" : "R0_FAIL",
  tests: results,
};

const receiptPath = path.join(mailboxRunDir, "r0-receipt.json");
atomicWriteJson(receiptPath, receipt);

for (const r of results) {
  emit("R0_TEST_RESULT", {
    test_id: r.id,
    pass: r.pass,
    description: r.description,
    evidence: JSON.stringify(r.evidence).slice(0, 512),
  });
}
emit("R0_COMPLETE", {
  gate: receipt.gate,
  passed: receipt.passed,
  total: receipt.total,
  receipt_ref: "r0-receipt.json",
  receipt_sha256: sha256Hex(fs.readFileSync(receiptPath)),
});

console.log(`\nR0 gate: ${receipt.gate} (${receipt.passed}/${receipt.total})`);
console.log(`Receipt: ${receiptPath}`);
process.exit(allPass ? 0 : 1);
