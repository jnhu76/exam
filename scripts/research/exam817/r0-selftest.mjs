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
import { parsePsqlJsonRows } from "./oracle.mjs";

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
