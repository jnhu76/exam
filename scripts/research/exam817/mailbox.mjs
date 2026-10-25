// Exam #817 WSL Reliability Harness — frozen mailbox protocol core.
//
// Encoding contract (RESEARCH-ONLY, frozen for issue #817):
//   - UTF-8, no BOM; strict decode (fatal), no replacement characters.
//   - JSONL records are separated ONLY by LF (0x0A); a record may not
//     contain a raw CR (0x0D). Escaped \r / \n inside JSON strings are
//     ordinary two-byte sequences and are preserved.
//   - Max record size 64 KiB (LF-terminated). Incomplete trailing bytes
//     (no LF yet) stay buffered and are never dispatched.
//   - JSON parsing rejects duplicate object keys, raw control characters
//     inside strings, and trailing garbage (stricter than JSON.parse).
//   - Envelope: schema_version, run_id, trial_id, seq, event_id, event,
//     timestamp_utc. Identity = writer-file + run_id + trial_id + seq.
//   - Single-writer append: one O_APPEND write of the whole line, then
//     fsync. Full documents (scenario/verdict/receipts) publish via
//     same-directory temp file + atomic rename, never partial in place.
//   - Reader progress (byte offset + dispatched dedup set) persists so a
//     harness restart resumes exactly where it stopped.

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = "exam817/1";
export const MAX_RECORD_BYTES = 64 * 1024;
export const MAX_JSON_DEPTH = 64;

// ── Strict JSON parsing ───────────────────────────────────────────

export class JsonParseError extends Error {}

/**
 * Strict recursive-descent JSON parser. Rejects duplicate keys, raw
 * control characters inside strings, and trailing garbage. Also rejects
 * any raw CR (0x0D) anywhere in the record — CR is never legal in this
 * protocol, not even as JSON whitespace.
 */
export function parseJsonStrict(text) {
  if (typeof text !== "string") throw new JsonParseError("input is not a string");
  if (text.includes("\r")) {
    throw new JsonParseError("raw CR (0x0D) is not allowed in a record");
  }
  let i = 0;
  const n = text.length;

  const fail = (msg) => {
    throw new JsonParseError(`${msg} at offset ${i}`);
  };
  const ws = () => {
    while (i < n && (text[i] === " " || text[i] === "\t" || text[i] === "\n")) i++;
  };
  const expect = (lit) => {
    if (text.startsWith(lit, i)) {
      i += lit.length;
      return;
    }
    fail(`expected '${lit}'`);
  };

  function value(depth) {
    if (depth > MAX_JSON_DEPTH) fail("nesting depth exceeds limit");
    ws();
    if (i >= n) fail("unexpected end of input");
    const c = text[i];
    if (c === "{") return object(depth);
    if (c === "[") return array(depth);
    if (c === '"') return str();
    if (c === "t") {
      expect("true");
      return true;
    }
    if (c === "f") {
      expect("false");
      return false;
    }
    if (c === "n") {
      expect("null");
      return null;
    }
    return number();
  }

  function object(depth) {
    i++; // {
    const out = {};
    const seen = new Set();
    ws();
    if (i < n && text[i] === "}") {
      i++;
      return out;
    }
    for (;;) {
      ws();
      if (i >= n || text[i] !== '"') fail("expected object key");
      const key = str();
      if (seen.has(key)) fail(`duplicate object key '${key}'`);
      seen.add(key);
      ws();
      if (i >= n || text[i] !== ":") fail("expected ':' after object key");
      i++;
      out[key] = value(depth + 1);
      ws();
      if (i >= n) fail("unterminated object");
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return out;
      }
      fail("expected ',' or '}' in object");
    }
  }

  function array(depth) {
    i++; // [
    const out = [];
    ws();
    if (i < n && text[i] === "]") {
      i++;
      return out;
    }
    for (;;) {
      out.push(value(depth + 1));
      ws();
      if (i >= n) fail("unterminated array");
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return out;
      }
      fail("expected ',' or ']' in array");
    }
  }

  function str() {
    i++; // opening quote
    let out = "";
    for (;;) {
      if (i >= n) fail("unterminated string");
      const c = text[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c === "\\") {
        i++;
        if (i >= n) fail("unterminated escape");
        const e = text[i];
        if (e === '"') out += '"';
        else if (e === "\\") out += "\\";
        else if (e === "/") out += "/";
        else if (e === "b") out += "\b";
        else if (e === "f") out += "\f";
        else if (e === "n") out += "\n";
        else if (e === "r") out += "\r";
        else if (e === "t") out += "\t";
        else if (e === "u") {
          if (i + 4 >= n) fail("truncated \\u escape");
          const hex = text.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("invalid \\u escape");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else fail(`invalid escape '\\${e}'`);
        i++;
        continue;
      }
      const code = c.charCodeAt(0);
      if (code < 0x20) fail(`raw control character 0x${code.toString(16)} inside string`);
      out += c;
      i++;
    }
  }

  function number() {
    const start = i;
    if (text[i] === "-") i++;
    if (i >= n) fail("truncated number");
    if (text[i] === "0") {
      i++;
    } else if (/[1-9]/.test(text[i])) {
      while (i < n && /[0-9]/.test(text[i])) i++;
    } else fail("invalid number");
    if (text[i] === ".") {
      i++;
      if (i >= n || !/[0-9]/.test(text[i])) fail("invalid number fraction");
      while (i < n && /[0-9]/.test(text[i])) i++;
    }
    if (text[i] === "e" || text[i] === "E") {
      i++;
      if (text[i] === "+" || text[i] === "-") i++;
      if (i >= n || !/[0-9]/.test(text[i])) fail("invalid number exponent");
      while (i < n && /[0-9]/.test(text[i])) i++;
    }
    return Number(text.slice(start, i));
  }

  const parsed = value(0);
  ws();
  if (i !== n) fail("trailing garbage after JSON value");
  return parsed;
}

/** Strict UTF-8 decode: throws on invalid bytes instead of replacing. */
export function decodeUtf8Strict(bytes) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
}

/** Decode that additionally refuses a leading BOM outright (not just skipping it). */
export function decodeRecordBytes(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new JsonParseError("BOM (EF BB BF) is not allowed");
  }
  return decodeUtf8Strict(bytes);
}

// ── Envelope validation ───────────────────────────────────────────

const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
export const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Validate the event envelope. Returns {ok:true} or {ok:false, reason}.
 * Unknown event names are NOT a protocol error at this layer — the
 * orchestrator logs them as unhandled; a malformed envelope is.
 */
export function validateEnvelope(record, { expectedRunId, expectedTrialId } = {}) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, reason: "envelope must be a JSON object" };
  }
  const required = ["schema_version", "run_id", "trial_id", "seq", "event_id", "event", "timestamp_utc"];
  for (const k of required) {
    if (!(k in record)) return { ok: false, reason: `missing required field '${k}'` };
  }
  if (record.schema_version !== SCHEMA_VERSION) {
    return { ok: false, reason: `schema_version mismatch: ${JSON.stringify(record.schema_version)}` };
  }
  for (const k of ["run_id", "trial_id", "event_id", "event"]) {
    if (typeof record[k] !== "string" || record[k].length === 0) {
      return { ok: false, reason: `field '${k}' must be a non-empty string` };
    }
  }
  if (!ID_RE.test(record.run_id)) return { ok: false, reason: "run_id charset/length invalid" };
  if (!ID_RE.test(record.trial_id)) return { ok: false, reason: "trial_id charset/length invalid" };
  if (record.event_id.length > 128) return { ok: false, reason: "event_id too long" };
  if (!Number.isSafeInteger(record.seq) || record.seq < 0) {
    return { ok: false, reason: "seq must be a non-negative safe integer" };
  }
  if (typeof record.timestamp_utc !== "string" || !ISO_UTC_RE.test(record.timestamp_utc)) {
    return { ok: false, reason: "timestamp_utc must be ISO-8601 UTC (…Z)" };
  }
  if (expectedRunId !== undefined && record.run_id !== expectedRunId) {
    return { ok: false, reason: `run_id mismatch: ${record.run_id}` };
  }
  if (expectedTrialId !== undefined && record.trial_id !== expectedTrialId) {
    return { ok: false, reason: `trial_id mismatch: ${record.trial_id}` };
  }
  return { ok: true };
}

// ── Writing ───────────────────────────────────────────────────────

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** Serialize one event line. JSON.stringify escapes \r\n inside strings. */
export function serializeEventLine(event) {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Append one complete UTF-8 line with a single O_APPEND write + fsync.
 * The whole record must land in one write call so a crash cannot leave a
 * partial JSON line that another side would mistake for a complete one.
 */
export function appendEventLine(filePath, line) {
  const buf = Buffer.from(line, "utf8");
  if (buf.length > MAX_RECORD_BYTES) {
    throw new Error(`event line exceeds ${MAX_RECORD_BYTES} bytes`);
  }
  const fd = fs.openSync(filePath, "a");
  try {
    fs.writeSync(fd, buf, 0, buf.length);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return sha256Hex(buf);
}

/** Event writer for one file: monotonic seq persisted in a sidecar state file. */
export class EventWriter {
  constructor(filePath, seqStatePath) {
    this.filePath = filePath;
    this.seqStatePath = seqStatePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.nextSeq = 0;
    if (fs.existsSync(seqStatePath)) {
      const st = JSON.parse(fs.readFileSync(seqStatePath, "utf8"));
      if (st.writer === path.basename(filePath) && Number.isSafeInteger(st.next_seq)) {
        this.nextSeq = st.next_seq;
      } else {
        throw new Error(`seq state file ${seqStatePath} does not match writer ${filePath}`);
      }
    }
  }

  append(event, payload = {}) {
    for (const k of ["run_id", "trial_id"]) {
      if (typeof payload[k] !== "string" || payload[k].length === 0) {
        throw new Error(`EventWriter.append requires payload.${k}`);
      }
    }
    const envelope = {
      schema_version: SCHEMA_VERSION,
      seq: this.nextSeq,
      event_id: `evt-${randomUUID()}`,
      event,
      timestamp_utc: new Date().toISOString(),
      ...payload,
    };
    const line = serializeEventLine(envelope);
    const sha = appendEventLine(this.filePath, line);
    this.nextSeq += 1;
    atomicWriteJson(this.seqStatePath, {
      writer: path.basename(this.filePath),
      next_seq: this.nextSeq,
      last_event_id: envelope.event_id,
      last_event_sha256: sha,
    });
    return envelope;
  }
}

// ── Atomic full-file publication ──────────────────────────────────

/**
 * Publish a full JSON document atomically: write to a temp file in the
 * SAME directory, fsync, rename over the target, fsync the directory.
 * Readers only ever see the complete old or complete new document.
 */
export function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${randomUUID()}`);
  const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, body, 0, body.length);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
  const dirFd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(dirFd);
  } catch {
    // Directory fsync is best-effort on platforms that refuse read-mode dirs.
  } finally {
    fs.closeSync(dirFd);
  }
}

/** Read a published JSON document; missing file → null. */
export function readPublishedJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return parseJsonStrict(decodeRecordBytes(fs.readFileSync(filePath)));
}

// ── Reading with resumable cursor ─────────────────────────────────

/**
 * JSONL reader with a persistent byte-offset cursor.
 *
 * poll() returns the validated records and rejections since the last
 * cursor, then advances the cursor ONLY past complete LF-terminated
 * records. A trailing partial line stays in the file (bytes remain
 * unread until its LF arrives). Invalid UTF-8 is fail-closed: the reader
 * halts at that offset and reports `halted` — it cannot know how far the
 * corruption extends, so it never silently skips bytes.
 */
export class JsonlFileReader {
  constructor(filePath, cursorPath, { maxRecordBytes = MAX_RECORD_BYTES } = {}) {
    this.filePath = filePath;
    this.cursorPath = cursorPath;
    this.maxRecordBytes = maxRecordBytes;
    this.offset = 0;
    this.processedCount = 0;
    this.halted = null; // {reason, offset} on fatal corruption
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
    this.loadCursor();
  }

  loadCursor() {
    if (!fs.existsSync(this.cursorPath)) return;
    const cur = JSON.parse(fs.readFileSync(this.cursorPath, "utf8"));
    if (cur.file !== path.basename(this.filePath)) {
      throw new Error(`cursor file ${this.cursorPath} belongs to ${cur.file}`);
    }
    if (!Number.isSafeInteger(cur.offset) || cur.offset < 0) {
      throw new Error(`cursor file ${this.cursorPath} has invalid offset`);
    }
    const size = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0;
    if (cur.offset > size) {
      // The file was truncated/rewritten underneath us: fail closed.
      this.halted = {
        reason: `cursor offset ${cur.offset} exceeds file size ${size}; file was truncated or replaced`,
        offset: cur.offset,
      };
      return;
    }
    this.offset = cur.offset;
    this.processedCount = cur.processed_count ?? 0;
  }

  saveCursor() {
    atomicWriteJson(this.cursorPath, {
      file: path.basename(this.filePath),
      offset: this.offset,
      processed_count: this.processedCount,
      saved_at: new Date().toISOString(),
    });
  }

  /**
   * Returns {records, rejected, halted}.
   *   records:  [{lineNo, bytes, value}] — envelope-validated JSON objects
   *   rejected: [{lineNo, offset, reason, lineSha256, raw?}]
   */
  poll() {
    const records = [];
    const rejected = [];
    if (this.halted) return { records, rejected, halted: this.halted };
    if (!fs.existsSync(this.filePath)) return { records, rejected, halted: null };

    let chunk;
    try {
      chunk = this.readFrom(this.offset);
    } catch (err) {
      this.halted = { reason: `read/decode failure: ${err.message}`, offset: this.offset };
      return { records, rejected, halted: this.halted };
    }

    let lineStart = 0;
    let lineNo = this.countLinesBefore(this.offset) + 1;
    for (;;) {
      const nl = chunk.indexOf(0x0a, lineStart);
      if (nl === -1) break; // no complete record beyond this point
      const lineBytes = chunk.subarray(lineStart, nl); // excludes LF
      const absOffset = this.offset + lineStart;
      try {
        if (lineBytes.length > this.maxRecordBytes) {
          throw new JsonParseError(
            `record size ${lineBytes.length} bytes exceeds limit ${this.maxRecordBytes}`,
          );
        }
        const text = decodeRecordBytes(lineBytes);
        const value = parseJsonStrict(text);
        const v = validateEnvelope(value);
        if (!v.ok) {
          rejected.push({
            lineNo,
            offset: absOffset,
            reason: v.reason,
            lineSha256: sha256Hex(lineBytes),
          });
        } else {
          records.push({ lineNo, offset: absOffset, bytes: lineBytes.length + 1, value });
        }
      } catch (err) {
        rejected.push({
          lineNo,
          offset: absOffset,
          reason: err.message,
          lineSha256: sha256Hex(lineBytes),
        });
      }
      lineStart = nl + 1;
      lineNo++;
    }
    this.offset += lineStart;
    this.processedCount += records.length;
    return { records, rejected, halted: null };
  }

  readFrom(offset) {
    const fd = fs.openSync(this.filePath, "r");
    try {
      const size = fs.fstatSync(fd).size;
      if (size <= offset) return Buffer.alloc(0);
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      // Strict UTF-8 validation of the whole unread region up front.
      new TextDecoder("utf-8", { fatal: true }).decode(buf);
      return buf;
    } finally {
      fs.closeSync(fd);
    }
  }

  countLinesBefore(byteOffset) {
    if (byteOffset === 0 || !fs.existsSync(this.filePath)) return 0;
    const fd = fs.openSync(this.filePath, "r");
    try {
      const buf = Buffer.alloc(byteOffset);
      fs.readSync(fd, buf, 0, byteOffset, 0);
      let count = 0;
      for (const b of buf) if (b === 0x0a) count++;
      return count;
    } finally {
      fs.closeSync(fd);
    }
  }
}

/** Dedup helper: identity = writer-file + run_id + trial_id + seq. */
export function dedupKey(writerFile, record) {
  return `${writerFile}|${record.value.run_id}|${record.value.trial_id}|${record.value.seq}`;
}
