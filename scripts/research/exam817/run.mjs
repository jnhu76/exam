#!/usr/bin/env node
// Exam #817 — WSL Reliability Harness orchestrator.
//
// One run_id per trial (maximum isolation + replay safety). Lifecycle:
//   init → deploy → seed → publish(scenario + ENV_READY) → wait
//   [CHECKPOINT_READY → FAULT_INTENT → fault → recovery → SERVICE_RECOVERED
//    → BROWSER_VERIFIED → verdict] → cleanup → report
//
// RESEARCH ONLY: never touches containers outside this run's compose
// project; never writes candidate answers directly to the DB.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { atomicWriteJson, EventWriter, JsonlFileReader, dedupKey, SCHEMA_VERSION, sha256Hex } from "./mailbox.mjs";
import {
  BASE_SHA,
  captureDeploymentEvidence,
  composeUp,
  generateEnvFile,
  preflight,
  runContainers,
  runPaths,
  waitForHealthy,
} from "./stack.mjs";
import { seedExamData, ApiClient } from "./seed.mjs";
import {
  capturePgSettings,
  captureWalRecoveryLog,
  classifyPerQuestion,
  oracleMutationRedTest,
  parsePsqlJsonRows,
  pgQuery,
  snapshotAttempt,
  writePgSnapshotEvidence,
} from "./oracle.mjs";
import { executeFault, FAULT_PLAN, probeRecovery, resolveInterruptedFault, captureServiceLogs, composeStartService, containerDetails, resolveTarget, D3_APP_AUTO_RECOVERY_WINDOW_MS } from "./fault.mjs";
import { startFaultWindowProbe, summarizeProbeFile } from "./probe.mjs";
import { BrowserSchemaError, browserResultContract, parseBrowserVerified } from "./browser-schema.mjs";
import { faultStatePath } from "./fault.mjs";

const execFileP = promisify(execFile);

const MAILBOX_ROOT = "/mnt/c/Users/fred1/exam-817/mailbox";
const RUNS_ROOT = "/home/hoo/exam817-runs";

const WINDOWS_EVENTS = "windows.events.jsonl";

// ── run state ─────────────────────────────────────────────────────

function statePath(runId) {
  return path.join(RUNS_ROOT, runId, "wsl.state.json");
}

function loadState(runId) {
  const st = JSON.parse(fs.readFileSync(statePath(runId), "utf8"));
  st.dispatched = new Set(st.dispatched_keys ?? []);
  return st;
}

function saveState(runId, st) {
  const s = { ...st, dispatched_keys: [...st.dispatched] };
  delete s.dispatched;
  atomicWriteJson(statePath(runId), s);
}

function mailboxDir(runId) {
  return path.join(MAILBOX_ROOT, runId);
}

function newRunId(arm) {
  // Compose project names: lowercase alphanumerics, hyphens, underscores
  // only — timestamps are compact lowercase, plus a random suffix.
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").toLowerCase();
  return `e817-${arm.toLowerCase()}-${ts}${randomBytes(2).toString("hex")}`;
}

// ── commands ──────────────────────────────────────────────────────

function cmdInit(argv) {
  const armIdx = argv.indexOf("--arm");
  const arm = armIdx >= 0 ? argv[armIdx + 1] : null;
  if (!arm || !FAULT_PLAN[arm]) {
    console.error("usage: run.mjs init --arm D0|D1|D2|D3|D4|D5 [--run-id <id>]");
    process.exit(2);
  }
  const idIdx = argv.indexOf("--run-id");
  const runId = idIdx >= 0 ? argv[idIdx + 1] : newRunId(arm);
  const trialId = `t-${runId.split("-").slice(2).join("-")}`;
  const p = runPaths(runId);
  fs.mkdirSync(p.evidenceDir, { recursive: true });
  fs.mkdirSync(path.join(mailboxDir(runId), "artifacts", "wsl"), { recursive: true });
  const st = {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    trial_id: trialId,
    arm,
    source_sha: BASE_SHA,
    phase: "initialized",
    created_at: new Date().toISOString(),
    fault_plan: FAULT_PLAN[arm],
    dispatched: [],
    ack_state: {},
    fault_resolved: null,
    scenario_published_at: null,
    env_ready_event_id: null,
    port: null,
    origin: null,
    exam_id: null,
    attempt_id: null,
  };
  saveState(runId, st);
  console.log(`initialized run ${runId} (trial ${trialId}, arm ${arm}, sha ${BASE_SHA})`);
  console.log(`run dir: ${p.root}`);
  console.log(`mailbox: ${mailboxDir(runId)}`);
}

async function cmdDeploy(runId) {
  const st = loadState(runId);
  const port = 21000 + (fnv1a(st.run_id) % 9999);
  const subnet = `172.28.${100 + (fnv1a(st.run_id) % 100)}.0/24`;
  const hostAlias = "localhost"; // Windows Chrome reaches WSL via localhost
  console.log(`preflight: port=${port} subnet=${subnet} project=exam817-${runId}`);
  const pf = await preflight(runId, port, subnet);
  if (!pf.ok) {
    console.error("PREFLIGHT FAILED — closed:");
    for (const pr of pf.problems) console.error(`  - ${pr}`);
    process.exit(1);
  }
  console.log("preflight OK");

  const { origin, launchpadToken } = generateEnvFile(runId, port, subnet, hostAlias);
  console.log(`env file: ${runPaths(runId).envFile}`);

  console.log("compose up...");
  await composeUp(runId);
  const health = await waitForHealthy(runId);
  console.log(`stack healthy after ${health.waitedMs}ms at ${origin}`);

  const evidence = await captureDeploymentEvidence(runId);
  console.log(`db container: ${evidence.containers.db?.id}`);
  console.log(`pgdata mount: ${evidence.pgdata_mount?.source}`);

  st.phase = "deployed";
  st.port = port;
  st.origin = origin;
  st.launchpad_token_local = launchpadToken; // never published
  st.deployment_evidence = {
    project: evidence.project,
    db_container_id: evidence.containers.db?.id,
    app_container_id: evidence.containers.app?.id,
    web_container_id: evidence.containers.web?.id,
    pgdata_mount: evidence.pgdata_mount,
    images: evidence.images,
    image_repo_digests: evidence.image_repo_digests,
    filesystem: evidence.filesystem,
    subnet: evidence.subnet,
  };
  saveState(runId, st);
  console.log("phase: deployed");
}

async function cmdSeed(runId) {
  const st = loadState(runId);
  if (st.phase !== "deployed") throw new Error(`seed requires phase=deployed (got ${st.phase})`);
  const trialId = st.trial_id;
  // Resume support: every completed step is persisted before the next one
  // starts, so a mid-seed contract failure costs one API call, not a whole
  // deployment cycle. Credentials live only in the local run state.
  st.seed_progress = st.seed_progress ?? {};
  saveState(runId, st);
  console.log(`seeding exam data for trial ${trialId} via product API at ${st.origin}`);
  const seed = await seedExamData({
    origin: st.origin,
    launchpadToken: st.launchpad_token_local,
    runId: st.run_id,
    trialId,
    evidenceDir: runPaths(runId).evidenceDir,
    resume: st.seed_progress,
    persist: (progress) => {
      st.seed_progress = { ...st.seed_progress, ...progress };
      saveState(runId, st);
    },
  });

  // Credentials stay on the local channel only (mailbox file, never in
  // evidence, never committed).
  atomicWriteJson(path.join(mailboxDir(runId), "credentials.local.json"), {
    schema_version: SCHEMA_VERSION,
    run_id: st.run_id,
    trial_id: trialId,
    exam_url: st.origin,
    admin: seed.admin,
    candidate: seed.candidate,
    note: "LOCAL-ONLY credential channel for the paired harness. Never commit, never copy into events or evidence.",
  });

  st.phase = "seeded";
  st.exam_id = seed.examId;
  st.manifest_questions = seed.manifestQuestions;
  st.expected_question_count = seed.manifestQuestions.length;
  st.marker = seed.marker;
  saveState(runId, st);
  console.log(`exam ${seed.examId} ready; ${seed.manifestQuestions.length} questions in manifest`);
}

function buildScenario(st) {
  const gen2Questions = st.manifest_questions.filter((q) => q.expected_gen2 !== null).map((q) => q.question_id);
  const signalForAction = {
    kill: "SIGKILL",
    stop_start: "SIGTERM (graceful compose stop, stop_grace_period from the frozen compose file)",
    down_up: null,
  };
  return {
    schema_version: SCHEMA_VERSION,
    kind: "exam817/scenario",
    run_id: st.run_id,
    trial_id: st.trial_id,
    source_sha: BASE_SHA,
    exam_url: st.origin,
    exam_id: st.exam_id,
    candidate_identity_ref: "credentials.local.json#candidate",
    expected_question_count: st.expected_question_count,
    fault: {
      arm: st.arm,
      action: st.fault_plan.action,
      target: st.fault_plan.target,
      signal: signalForAction[st.fault_plan.action] ?? null,
      trigger: "ALL_EXPECTED_SAVES_ACCEPTED",
      description: st.fault_plan.label,
    },
    // F7: the frozen BROWSER_VERIFIED contract. Both ends share this exact
    // shape; the WSL oracle validates strictly and rejects legacy layouts.
    browser_result_contract: browserResultContract(),
    answer_manifest: {
      marker: st.marker,
      save_order_gen1: st.manifest_questions.map((q) => q.question_id),
      re_save_order_gen2: gen2Questions,
      questions: st.manifest_questions,
      value_hints: {
        true_false: "boolean true(对)/false(错)",
        single_choice: "option id string, e.g. \"A\"",
        multiple_choice: "array of option ids, e.g. [\"A\",\"B\"]",
        fill_blank: "exact marker string, type it verbatim",
        // F1 (#819): a real textarea normalizes Enter to LF — the manifest's
        // multi-line values are authored in that canonical LF form, so typing
        // them verbatim produces exactly the ACKed expectation.
        text_response: "exact string; multi-line values already use LF (\\n) line breaks, type verbatim (the textarea's Enter produces the same LF)",
      },
    },
    answer_flow: {
      attempt_start: "browser: login as candidate → open exam → click start (real UI flow)",
      save_endpoint: "POST /api/attempts/:attemptId/answers/:questionId",
      ack_requires: ["accepted === true", "serverVersion present (HTTP 200 alone is not an ACK)"],
      debounce_note: "TakeExamPage flushes edits after a 1500ms in-memory debounce; wait for the SAVE_ACCEPTED per question before the next phase",
      windows_events_file: WINDOWS_EVENTS,
    },
    windows_instructions: [
      "1. Read credentials.local.json (local-only) and log in as the candidate in Chrome.",
      "2. Open the exam and start the attempt through the real UI.",
      "3. Fill EVERY question with answer_manifest.questions[*].expected_gen1, in save_order_gen1 order.",
      "4. For each observed save request, append a SAVE_ACCEPTED event (accepted + server_version + evidence refs).",
      "5. Re-edit ONLY re_save_order_gen2 questions with expected_gen2 values; append SAVE_ACCEPTED for those too.",
      "6. When every question's LAST save is ACKed, append CHECKPOINT_READY {arm, attempt_id, saves[]}.",
      "7. After the WSL side emits SERVICE_RECOVERED, reload the SAME candidate page (re-authenticate with",
      "   credentials.local.json if the session was dropped and set session_reauth_required=true), re-read",
      "   every answer, and append BROWSER_VERIFIED exactly per browser_result_contract:",
      "   browser_result_schema_version=2 + per_question[{question_id, browser_answer}]. Legacy field layouts",
      "   (browser_value / visible_value / browser_answers) are REJECTED and fail the trial.",
      "Do not write any other files in the run directory except windows.events.jsonl, windows-result.json",
      "and artifacts/windows/*.",
    ],
  };
}

async function cmdPublish(runId) {
  const st = loadState(runId);
  if (st.phase !== "seeded") throw new Error(`publish requires phase=seeded (got ${st.phase})`);
  const scenario = buildScenario(st);
  const scenarioPath = path.join(mailboxDir(runId), "scenario.json");
  atomicWriteJson(scenarioPath, scenario);
  st.phase = "scenario_published";
  st.scenario_published_at = new Date().toISOString();
  saveState(runId, st);

  const writer = new EventWriter(path.join(mailboxDir(runId), "wsl.events.jsonl"), path.join(runPaths(runId).evidenceDir, "wsl-seq.json"));
  const ev = writer.append("ENV_READY", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    exam_url: st.origin,
    exam_id: st.exam_id,
    expected_question_count: st.expected_question_count,
    scenario_ref: "scenario.json",
    scenario_sha256: sha256Hex(fs.readFileSync(scenarioPath)),
    arm: st.arm,
    fault_description: st.fault_plan.label,
  });
  st.env_ready_event_id = ev.event_id;
  saveState(runId, st);
  console.log(`scenario published + ENV_READY (${ev.event_id}). Waiting for Windows.`);
}

// ── wait loop / trial state machine ───────────────────────────────

// ── Windows event field resolution ────────────────────────────────

/**
 * Windows events carry business fields inside `payload` (envelope stays
 * flat). Merge for uniform lookup: envelope keys win, payload fills the
 * rest. The original payload object is preserved as ev.payload.
 */
function normalizeWindowsEvent(record) {
  const payload = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload) ? record.payload : {};
  return { ...payload, ...record, payload };
}

/** Convert a Windows-side artifact path (C:\…) to its WSL /mnt/c path. */
function artifactPath(winPath) {
  if (typeof winPath !== "string" || winPath.length === 0) return null;
  const m = winPath.match(/^([A-Za-z]):\\(.*)$/);
  if (!m) return fs.existsSync(winPath) ? winPath : null;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replaceAll("\\", "/")}`;
}

/**
 * Independently verify an ACK: read the referenced response artifact,
 * check its sha256, and require accepted===true + a serverVersion.
 * When a request artifact is referenced, also verify and load the ACKed
 * answer VALUE (the durability oracle compares PG against the ACKed
 * content, not the manifest).
 * Returns {ok, serverVersion, evidence_ref, answer_value?, answer_digest?}.
 */
function verifyAckArtifact(payload) {
  const ra = payload?.response_artifact;
  if (!ra || typeof ra.path !== "string") return { ok: false, reason: "no response_artifact reference" };
  const p = artifactPath(ra.path);
  if (!p || !fs.existsSync(p)) return { ok: false, reason: `response artifact missing: ${ra.path}` };
  const bytes = fs.readFileSync(p);
  const sha = sha256Hex(bytes);
  if (ra.sha256 && sha !== ra.sha256) {
    return { ok: false, reason: `response artifact sha256 mismatch (expected ${ra.sha256}, got ${sha})` };
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (e) {
    return { ok: false, reason: `response artifact not valid JSON: ${e.message}` };
  }
  if (body.accepted !== true || typeof body.serverVersion !== "number") {
    return { ok: false, reason: `artifact is not an ACK (accepted=${JSON.stringify(body.accepted)}, serverVersion=${JSON.stringify(body.serverVersion)})` };
  }
  const out = {
    ok: true,
    serverVersion: body.serverVersion,
    evidence_ref: `${path.basename(p)}#sha256:${sha}`,
    savedAt: body.savedAt ?? null,
  };
  // Resolve the request artifact to recover the ACKed answer VALUE.
  // Candidate order: the event's explicit reference, then derivations from
  // the response artifact name (resp-X-s2.json → req-X-s2.json → req-X.json;
  // Windows' naming correction renamed resp files but not all req files).
  // Values beat event-side answer_digest fields, which have been observed
  // to carry stale generations (Windows-side correction F2).
  // A candidate is valid only if its questionId matches and, when it has a
  // baseVersion, the baseVersion→serverVersion chain is consistent
  // (baseVersion === serverVersion - 1 for the accepted version).
  const candidates = [];
  const qa = payload?.request_artifact;
  if (qa && typeof qa.path === "string") candidates.push({ path: artifactPath(qa.path), sha: qa.sha256 });
  if (typeof p === "string" && path.basename(p).startsWith("resp-")) {
    const base = path.basename(p).replace(/^resp-/, "req-");
    candidates.push({ path: path.join(path.dirname(p), base), sha: undefined });
    const stripped = base.replace(/-s\d+\.json$/, ".json");
    if (stripped !== base) candidates.push({ path: path.join(path.dirname(p), stripped), sha: undefined });
  }
  let best = null; // {value, quality, ref}
  for (const cand of candidates) {
    if (!cand.path || !fs.existsSync(cand.path)) continue;
    const qbytes = fs.readFileSync(cand.path);
    const qsha = sha256Hex(qbytes);
    if (cand.sha && qsha !== cand.sha) continue;
    let req;
    try {
      req = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(qbytes));
    } catch {
      continue;
    }
    if ("answer" in req) {
      if (payload?.question_id && req.questionId !== payload.question_id) continue; // cross-question guard
      const chainOk = typeof req.baseVersion === "number" && req.baseVersion === body.serverVersion - 1;
      const quality = chainOk ? 2 : 1;
      if (!best || quality > best.quality) {
        best = {
          value: req.answer,
          quality,
          ref: `${path.basename(cand.path)}+${path.basename(p)}#sha256:${qsha}/${sha}`,
        };
      }
      if (quality === 2) break; // chain-consistent value cannot be beaten
    }
  }
  if (best) {
    out.answer_value = best.value;
    out.evidence_ref = best.ref;
    delete out.answer_digest;
  }
  if (out.answer_value === undefined && typeof payload?.answer_digest === "string") {
    out.answer_digest = payload.answer_digest;
  }
  return out;
}

function requireFields(obj, fields, what) {
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === null);
  if (missing.length > 0) throw new Error(`${what} missing fields: ${missing.join(",")}`);
}

async function cmdWait(runId, { timeoutSec = 7200, browserTimeoutSec = 900 } = {}) {
  const st = loadState(runId);
  // scenario_published: normal entry. service_recovered: post-fault resume —
  // the fault is already terminal (handleCheckpoint's fault_terminal guard
  // prevents re-execution); the loop just waits for BROWSER_VERIFIED again.
  if (!["scenario_published", "service_recovered"].includes(st.phase)) {
    throw new Error(`wait requires phase=scenario_published|service_recovered (got ${st.phase})`);
  }
  const mdir = mailboxDir(runId);
  const winEventsPath = path.join(mdir, WINDOWS_EVENTS);
  const cursorPath = path.join(runPaths(runId).evidenceDir, "windows-reader-cursor.json");
  const reader = new JsonlFileReader(winEventsPath, cursorPath);
  const writer = new EventWriter(path.join(mdir, "wsl.events.jsonl"), path.join(runPaths(runId).evidenceDir, "wsl-seq.json"));
  const deadline = Date.now() + timeoutSec * 1000;
  let browserDeadline = null;

  // Resume: an interrupted fault between INTENT and terminal event resolves
  // from the step journal + container evidence — never re-executed blindly.
  if (st.fault_intent_written && !st.fault_terminal) {
    console.log("resuming: FAULT_INTENT present without terminal receipt — resolving from container evidence");
    const res = await resolveInterruptedFault(runId, { arm: st.arm, trialId: st.trial_id });
    st.fault_resolved = res;
    saveState(runId, st);
    writer.append("FAULT_RESOLVED_UNKNOWN", { run_id: st.run_id, trial_id: st.trial_id, classification: res.classification, reason: res.reason });
    if (res.classification === "APPLIED") {
      st.fault_terminal = { kind: "FAULT_APPLIED", receipt: res.receipt ?? null };
      st.phase = "fault_done";
      saveState(runId, st);
      await runRecoveryPhase(runId, st, writer, res.receipt ?? { arm: st.arm, interrupted: true });
      if (st.phase === "incomplete") return;
    } else if (res.classification === "APPLIED_NOT_RECOVERED") {
      // The fault demonstrably fired but the target is left stopped. The
      // operator start is RECOVERY, not a re-fault — the mutating step has
      // already happened once and is journaled.
      st.fault_terminal = { kind: "FAULT_APPLIED", receipt: { arm: st.arm, interrupted: true, ...res } };
      st.phase = "fault_done";
      saveState(runId, st);
      writer.append("FAULT_RESOLVED_RECOVERY_PENDING", {
        run_id: st.run_id,
        trial_id: st.trial_id,
        reason: res.reason,
        container_id: res.container_id ?? null,
      });
      console.log(`fault fired but target left stopped — performing operator start (${st.fault_plan.target})`);
      const startRes = await composeStartService(runId, st.fault_plan.target);
      st.resume_recovery_action = { service: st.fault_plan.target, action: "compose start", ...startRes };
      saveState(runId, st);
      await runRecoveryPhase(runId, st, writer, st.fault_terminal.receipt);
      if (st.phase === "incomplete") return;
    } else if (res.classification === "NOT_APPLIED") {
      st.fault_terminal = null;
      st.fault_intent_written = false;
      st.phase = "scenario_published";
      console.log("fault NOT_APPLIED (container untouched) — checkpoint remains valid, fault will re-run on next CHECKPOINT_READY");
    } else {
      console.error(`fault resolution: ${res.classification} — ${res.reason}`);
      st.phase = "incomplete";
      saveState(runId, st);
      await writeVerdict(runId, st, writer, { verdict: "UNKNOWN", reason: `interrupted fault resolved as ${res.classification}: ${res.reason}` });
      return;
    }
    saveState(runId, st);
  }

  console.log(`polling ${winEventsPath} (phase=${st.phase}, arm=${st.arm})`);

  for (;;) {
    if (Date.now() > deadline) {
      st.phase = "incomplete";
      saveState(runId, st);
      await writeVerdict(runId, st, writer, { verdict: "INCOMPLETE", reason: `wait timeout after ${timeoutSec}s without trial completion` });
      return;
    }

    const { records, rejected, halted } = reader.poll();
    if (halted) {
      console.error(`READER HALTED: ${halted.reason} — refusing to skip bytes; stopping fault execution path.`);
      st.phase = "incomplete";
      saveState(runId, st);
      await writeVerdict(runId, st, writer, { verdict: "UNKNOWN", reason: `windows events reader halted: ${halted.reason}` });
      return;
    }
    for (const rej of rejected) {
      console.log(`  [rejected] line ${rej.lineNo}: ${rej.reason}`);
      writer.append("PROTOCOL_REJECTED", {
        run_id: st.run_id,
        trial_id: st.trial_id,
        file: WINDOWS_EVENTS,
        line_no: rej.lineNo,
        line_sha256: rej.lineSha256,
        reason: rej.reason,
      });
    }

    for (const rec of records) {
      const key = dedupKey(WINDOWS_EVENTS, rec);
      if (st.dispatched.has(key)) continue;
      st.dispatched.add(key);
      const ev = normalizeWindowsEvent(rec.value);

      if (ev.run_id !== st.run_id || ev.trial_id !== st.trial_id) {
        console.log(`  [ignored] ${ev.event} for ${ev.run_id}/${ev.trial_id} (not this run)`);
        continue;
      }
      saveState(runId, st);

      try {
        if (ev.event === "SAVE_ACCEPTED") {
          // A save without independently verified ACK evidence is recorded
          // as rejected and never counted — but it does NOT abort the trial;
          // CHECKPOINT validation still refuses an incomplete checkpoint.
          const attemptId = ev.attempt_id;
          const qid = ev.question_id;
          if (!attemptId || !qid) {
            writer.append("PROTOCOL_REJECTED", {
              run_id: st.run_id, trial_id: st.trial_id, file: WINDOWS_EVENTS,
              event_id: ev.event_id, reason: "SAVE_ACCEPTED without attempt_id/question_id",
            });
            console.log(`  [save-rejected] missing ids (seq ${ev.seq})`);
            saveState(runId, st);
            continue;
          }
          let ack;
          if (ev.accepted === true && Number.isSafeInteger(ev.server_version)) {
            ack = { ok: true, serverVersion: ev.server_version, evidence_ref: ev.evidence_ref ?? `event:${ev.event_id}` };
          } else {
            ack = verifyAckArtifact(ev.payload);
          }
          if (!ack.ok) {
            st.rejected_saves = st.rejected_saves ?? {};
            st.rejected_saves[qid] = { generation: ev.generation ?? null, reason: ack.reason };
            saveState(runId, st);
            writer.append("PROTOCOL_REJECTED", {
              run_id: st.run_id, trial_id: st.trial_id, file: WINDOWS_EVENTS,
              event_id: ev.event_id, question_id: qid, reason: `SAVE_ACCEPTED unverified: ${ack.reason}`,
            });
            console.log(`  [save-rejected] q=${qid.slice(0, 8)}: ${ack.reason}`);
            continue;
          }
          st.attempt_id = attemptId;
          st.last_save_at = ev.timestamp_utc ?? null;
          st.ack_state[qid] = {
            generation: ev.generation ?? null,
            serverVersion: ack.serverVersion,
            evidence_ref: ack.evidence_ref,
            answer_value: ack.answer_value, // may be undefined → digest path
            answer_digest: ack.answer_digest, // may be undefined
            at: ev.timestamp_utc,
          };
          saveState(runId, st);
          console.log(`  [save] q=${qid.slice(0, 8)} gen=${ev.generation} v=${ack.serverVersion} ACKED (artifact-verified)`);
        } else if (ev.event === "CHECKPOINT_READY") {
          requireFields(ev, ["arm", "attempt_id", "saves"], "CHECKPOINT_READY");
          await handleCheckpoint(runId, st, writer, ev, reader);
          if (st.phase === "incomplete") return;
        } else if (ev.event === "BROWSER_VERIFIED") {
          // F7: strict v2 validation. Legacy layouts (D0 browser_value /
          // as-built visible_value / D0 browser_answers[]) are REJECTED —
          // no alias chains. A schema violation fails the trial closed.
          const parsed = parseBrowserVerified(ev, {
            manifestQuestions: st.manifest_questions ?? [],
            attemptId: st.attempt_id ?? null,
          });
          st.browser_verified = {
            at: ev.timestamp_utc,
            attempt_id: parsed.attempt_id,
            schema_version: parsed.schema_version,
            reload_at: parsed.reload_at,
            identity_confirmed: parsed.identity_confirmed,
            session_reauth_required: parsed.session_reauth_required,
            evidence_ref: ev.evidence_ref ?? `event:${ev.event_id}`,
            raw_event_id: ev.event_id,
          };
          st.browser_state = parsed.browser_state;
          st.phase = "verdict_phase";
          saveState(runId, st);
          await writeVerdict(runId, st, writer, {});
          return;
        } else if (ev.event === "WINDOW_ERROR") {
          console.log(`  [window-error] ${JSON.stringify(ev.payload).slice(0, 300)}`);
          st.window_error = ev;
          saveState(runId, st);
        } else if (ev.event === "HELLO") {
          console.log(`  [hello] windows agent: ${JSON.stringify(ev.agent ?? ev.payload ?? {})}`.slice(0, 200));
        } else {
          console.log(`  [unhandled] ${ev.event} (logged, no action)`);
        }
      } catch (e) {
        const code = e.code ? ` [${e.code}]` : "";
        console.error(`  [dispatch-error] ${ev.event}${code}: ${e.message}`);
        writer.append("PROTOCOL_REJECTED", {
          run_id: st.run_id,
          trial_id: st.trial_id,
          file: WINDOWS_EVENTS,
          event_id: ev.event_id,
          reason: `dispatch error on ${ev.event}${code}: ${e.message}`,
        });
        // Structural errors on checkpoint/browser events are trial-fatal
        // (fail closed); nothing was executed, so the trial ends UNKNOWN —
        // except SAVE_ACCEPTED which never reaches this path anymore.
        st.phase = "incomplete";
        saveState(runId, st);
        await writeVerdict(runId, st, writer, { verdict: "UNKNOWN", reason: `dispatch error on ${ev.event}${code}: ${e.message}` });
        return;
      }
    }

    // Browser-verified watchdog: SERVICE_RECOVERED sent but no browser result.
    if (st.phase === "service_recovered" && !st.browser_verified) {
      if (browserDeadline === null) browserDeadline = Date.now() + browserTimeoutSec * 1000;
      if (Date.now() > browserDeadline) {
        st.phase = "incomplete";
        saveState(runId, st);
        await writeVerdict(runId, st, writer, { verdict: "INCOMPLETE", reason: `no BROWSER_VERIFIED within ${browserTimeoutSec}s after SERVICE_RECOVERED` });
        return;
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }
}

async function handleCheckpoint(runId, st, writer, ev, reader) {
  // Replay-safety: a fault for this trial has already been applied and
  // receipted (harness restarted after SERVICE_RECOVERED). Never re-execute;
  // recovery has already been emitted — just wait for the browser again.
  if (st.fault_terminal) {
    console.log(`  [checkpoint] fault_terminal already present (${st.fault_terminal.kind}) — skipping re-execution`);
    return;
  }
  // 1. Validate the checkpoint against the frozen plan.
  if (ev.arm !== st.arm) throw new Error(`CHECKPOINT_READY arm ${ev.arm} != frozen arm ${st.arm}`);
  const acked = new Set(Object.keys(st.ack_state));
  const saves = new Set((ev.saves ?? []).map((s) => s.question_id));
  const expected = new Set(st.manifest_questions.map((q) => q.question_id));
  const missing = [...expected].filter((q) => !acked.has(q) && !saves.has(q));
  if (missing.length > 0) {
    throw new Error(`CHECKPOINT_READY lacks ACKed saves for ${missing.length} questions: ${missing.slice(0, 3).join(",")}`);
  }
  // Fold the checkpoint's save receipts into ack state (authoritative last
  // write). Each entry may carry flat fields or artifact references — the
  // same artifact verification applies; unverified entries do NOT count.
  for (const s of ev.saves ?? []) {
    const se = normalizeWindowsEvent(typeof s === "object" && s !== null ? s : {});
    const qid = se.question_id;
    if (!qid) continue;
    let ack;
    if (se.accepted === true && Number.isSafeInteger(se.server_version)) {
      ack = { ok: true, serverVersion: se.server_version, evidence_ref: se.evidence_ref ?? `event:${ev.event_id}` };
    } else {
      ack = verifyAckArtifact(se.payload);
    }
    if (ack.ok) {
      st.ack_state[qid] = {
        generation: se.generation ?? st.ack_state[qid]?.generation ?? null,
        serverVersion: ack.serverVersion,
        evidence_ref: ack.evidence_ref,
        answer_value: ack.answer_value,
        answer_digest: ack.answer_digest,
        at: ev.timestamp_utc,
      };
    } else {
      st.rejected_saves = st.rejected_saves ?? {};
      st.rejected_saves[qid] = { generation: se.generation ?? null, reason: `checkpoint save unverified: ${ack.reason}` };
    }
  }
  st.attempt_id = ev.attempt_id;

  // 2. Cross-check attempt identity in PG (exactly one in_progress attempt
  // for this exam — maxAttempts=1, single candidate).
  const sql =
    `SELECT row_to_json(t) FROM (SELECT id, status FROM exam_attempts WHERE exam_id = '${st.exam_id}') t;`;
  const { stdout } = await pgQuery(runId, sql);
  const attempts = parsePsqlJsonRows(stdout, { what: "checkpoint attempt identity" }).rows;
  const active = attempts.filter((a) => a.status === "in_progress");
  if (active.length !== 1 || active[0].id !== ev.attempt_id) {
    throw new Error(
      `attempt identity mismatch: checkpoint says ${ev.attempt_id}, PG has ${active.length} in_progress attempt(s) for exam ${st.exam_id}: ${active.map((a) => a.id).join(",")}`,
    );
  }

  // 3. PRE-fault authoritative snapshot (read-only; latency recorded).
  const pre = await snapshotAttempt(runId, ev.attempt_id);
  if (!pre?.row) throw new Error("pre-fault snapshot: attempt row not found");
  const preEv = await writePgSnapshotEvidence(runId, st.trial_id, "pre", pre);
  writer.append("PG_SNAPSHOT_TAKEN", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    phase: "pre",
    attempt_id: ev.attempt_id,
    evidence_ref: path.basename(preEv.file),
    sha256: preEv.sha256,
    query_latency_ms: preEv.latencyMs,
  });
  console.log(`pre-fault snapshot taken (${preEv.latencyMs.toFixed(0)}ms)`);
  st.pre_snapshot = { ref: path.basename(preEv.file), sha256: preEv.sha256, latency_ms: preEv.latencyMs };
  st.pre_snapshot_row_status = pre.row.status;

  // 3b. Pre-fault consistency gate (§5): PostgreSQL must already hold every
  // ACKed answer BEFORE any fault. A divergence here is a harness/protocol
  // problem, not a fault result — STOP, never fire the fault on top of it.
  const preClassified = classifyPerQuestion({
    manifestQuestions: st.manifest_questions,
    attemptRow: pre.row,
    ackState: st.ack_state,
  });
  const preBad = preClassified.filter((q) => q.classification !== "ACK_MATCHED");
  st.pre_consistency = {
    classifications: Object.fromEntries(preClassified.map((q) => [q.question_id, q.classification])),
    scenario_deviations: preClassified.filter((q) => q.scenario_deviation).map((q) => q.question_id),
    last_save_to_checkpoint_ms:
      st.last_save_at && ev.timestamp_utc ? Date.parse(ev.timestamp_utc) - Date.parse(st.last_save_at) : null,
  };
  if (preBad.length > 0) {
    writer.append("CHECKPOINT_REJECTED", {
      run_id: st.run_id,
      trial_id: st.trial_id,
      attempt_id: ev.attempt_id,
      problems: preBad.map((q) => ({ question_id: q.question_id, classification: q.classification, pg_version: q.pg_version, expected_server_version: q.expected_server_version })),
      reason: "pre-fault PG state does not match the last verified ACKs — fault NOT fired (fail closed)",
    });
    st.phase = "checkpoint_rejected";
    saveState(runId, st);
    await writeVerdict(runId, st, writer, {
      verdict: "UNKNOWN",
      reason: `CHECKPOINT_REJECTED: ${preBad.length} question(s) not ACK_MATCHED pre-fault (${preBad.slice(0, 3).map((q) => `${q.question_id.slice(0, 8)}:${q.classification}`).join(",")})`,
    });
    return;
  }

  // 4. Persist FAULT_INTENT BEFORE touching Docker (replay-safety anchor).
  writer.append("FAULT_INTENT", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    arm: st.arm,
    checkpoint_event_id: ev.event_id,
    checkpoint_seq: ev.seq,
    attempt_id: ev.attempt_id,
    planned_action: st.fault_plan.action,
    planned_target: st.fault_plan.target,
    pre_consistency: st.pre_consistency,
  });
  st.fault_intent_written = true;
  st.phase = "fault_phase";
  saveState(runId, st);

  // 4b. F6: continuous fault-window probe — started BEFORE the fault action
  // and stopped only after recovery, so the outage is actually observed
  // (the D2 F6 finding: probes started after the fault cannot see it).
  // Samples stream to evidence as JSONL; the summary is recomputable.
  const probe = await startFaultWindowProbe({
    runId: st.run_id,
    origin: st.origin,
    evidenceDir: runPaths(runId).evidenceDir,
    trialId: st.trial_id,
  });
  st.probe_started_at = probe.startedAt;
  saveState(runId, st);

  // 5. Execute the fault (identity-gated inside). D2 freezes a 5s
  // auto-restart observation window; D1/D3/D5 freeze their dwell windows
  // (experiment conditions, not SLAs).
  let receipt;
  try {
    receipt = await executeFault(runId, {
      arm: st.arm,
      trialId: st.trial_id,
      autoRestartWindowMs: st.arm === "D2" ? 5000 : undefined,
    });
    st.fault_terminal = { kind: "FAULT_APPLIED", receipt };
  } catch (e) {
    await probe.stop().catch(() => {});
    st.probe_stopped_at = new Date().toISOString();
    st.fault_terminal = { kind: "FAULT_FAILED", reason: e.message };
    saveState(runId, st);
    writer.append("FAULT_FAILED", { run_id: st.run_id, trial_id: st.trial_id, arm: st.arm, reason: e.message });
    st.phase = "incomplete";
    saveState(runId, st);
    await writeVerdict(runId, st, writer, { verdict: "UNKNOWN", reason: `fault failed: ${e.message}` });
    return;
  }

  writer.append("FAULT_APPLIED", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    arm: st.arm,
    receipt: receipt,
  });
  st.phase = "fault_done";
  saveState(runId, st);
  console.log(`fault applied: ${st.arm} (${st.fault_plan.label})`);

  await runRecoveryPhase(runId, st, writer, receipt, probe);
}

/**
 * Recovery + post-fault evidence phase, shared by the normal checkpoint path
 * and the interrupted-fault resume path (one truth for recovery). Runs from
 * FAULT_APPLIED to SERVICE_RECOVERED: continuous-probe teardown, per-arm
 * recovery, D3 auto-reconnect observation, post snapshot, lifecycle guard,
 * API leg, RTO metrics, evidence files. `probe` is the live probe handle on
 * the normal path, null on the resume path (the loop died with the old
 * process; its persisted JSONL is the observation record).
 */
async function runRecoveryPhase(runId, st, writer, receipt, probe = null) {
  const ev = { attempt_id: st.attempt_id };

  // 6. Recovery. D3 first observes whether the APP reconnects on its own
  // once db is back — a predetermined 60s window (experiment condition, not
  // an SLA). Only after that window may the operator restart app, classified
  // OPERATOR_RECOVERY_REQUIRED; restarting earlier would mask the very
  // behavior this arm studies.
  let operatorRecovery = null;
  const recoveryTimeoutMs = st.arm === "D3" ? D3_APP_AUTO_RECOVERY_WINDOW_MS : 300000;
  const faultEndedAt = new Date().toISOString();
  let recovery = await probeRecovery(runId, { timeoutMs: recoveryTimeoutMs });
  if (!recovery.recovered && st.arm === "D3") {
    operatorRecovery = {
      required: true,
      classification: "OPERATOR_RECOVERY_REQUIRED",
      reason: `app did not reconnect within the observed ${D3_APP_AUTO_RECOVERY_WINDOW_MS}ms after db start`,
      observed_window_ms: D3_APP_AUTO_RECOVERY_WINDOW_MS,
    };
    const t0 = Date.now();
    const { stdout } = await execFileP(
      "docker",
      ["compose", "--env-file", runPaths(runId).envFile, "-f", "/home/hoo/Source/exam-817-harness/docker-compose.yml", "-p", `exam817-${st.run_id}`, "restart", "app"],
      { encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
    );
    operatorRecovery.action = "docker compose -p exam817-" + st.run_id + " restart app";
    operatorRecovery.action_at = new Date().toISOString();
    operatorRecovery.action_ms = Date.now() - t0;
    operatorRecovery.action_output = stdout.slice(-300);
    recovery = await probeRecovery(runId, { timeoutMs: 300000 });
  }
  if (!recovery.recovered) {
    st.phase = "incomplete";
    saveState(runId, st);
    await writeVerdict(runId, st, writer, { verdict: "RECOVERY_TIMEOUT", reason: `service did not recover within ${recoveryTimeoutMs}ms${operatorRecovery ? " (operator recovery also failed)" : " (operator recovery: n/a for this arm)"}` });
    return;
  }
  console.log(`service recovered in ${recovery.window_ms}ms${operatorRecovery ? " after OPERATOR_RECOVERY_REQUIRED restart" : ""}`);

  // Stop the F6 probe (after recovery, per brief) and summarize.
  const probeStop = probe
    ? await probe.stop()
    : { stopped_at: new Date().toISOString(), note: "probe process no longer alive (resume path); JSONL samples up to the interruption are the observation record", ticks: null };
  st.probe_stopped_at = probeStop.stopped_at;
  const probeSummary = summarizeProbeFile(path.join(runPaths(runId).evidenceDir, `probe-${st.trial_id}.jsonl`), {
    startedAtIso: st.probe_started_at,
    stoppedAtIso: probeStop.stopped_at,
  });
  st.fault_window_probe = probeSummary ? { ...probeSummary, stop: probeStop } : { error: "probe summary unavailable", stop: probeStop };

  // 7. POST snapshot + PG settings + WAL recovery logs (db arms only).
  const post = await snapshotAttempt(runId, st.attempt_id);
  if (!post?.row) {
    st.phase = "incomplete";
    saveState(runId, st);
    await writeVerdict(runId, st, writer, { verdict: "UNKNOWN", reason: "attempt row missing after fault — cannot classify" });
    return;
  }
  const postEv = await writePgSnapshotEvidence(runId, st.trial_id, "post", post);
  // 7b. Lifecycle guard (§8): the attempt must still exist in its original
  // status — no unexpected submit/void/disrupted transition from the fault.
  if (st.pre_snapshot_row_status && st.pre_snapshot_row_status !== post.row.status) {
    st.phase = "incomplete";
    saveState(runId, st);
    await writeVerdict(runId, st, writer, {
      verdict: "UNKNOWN",
      reason: `attempt lifecycle anomaly: status changed ${st.pre_snapshot_row_status} → ${post.row.status} across the fault`,
    });
    return;
  }

  // 7c. API third leg: fetch the authoritative Take Snapshot through the
  // REAL serving path (nginx → app → db) as the recovered candidate.
  // COMPLETE requires ACK → PG → API → Browser agreement (§8).
  let apiLeg = null;
  try {
    apiLeg = await captureApiTakeSnapshot(runId, st);
    st.api_snapshot = { ref: path.basename(apiLeg.file), sha256: apiLeg.sha256, attempt_status: apiLeg.attemptStatus };
    st.api_state = apiLeg.apiState;
  } catch (e) {
    st.api_snapshot_error = e.message.slice(0, 300);
  }

  const wal = st.arm.startsWith("D3") || st.arm.startsWith("D4") ? await captureWalRecoveryLog(runId, faultEndedAt) : { log: "", note: "not a db arm" };
  const pgSettings = st.arm.startsWith("D5") ? { note: "captured pre-fault in deployment evidence; db identity re-proven by the post snapshot" } : await capturePgSettings(runId);
  // Service logs across the fault window (graceful shutdown lines for D1,
  // pool errors for D3, boot/migration lines for D5's fresh containers).
  const logService = st.fault_plan.target ?? "app";
  const serviceLogs = {};
  for (const svc of st.arm === "D3" ? ["db", "app"] : [logService]) {
    try {
      const cap = await captureServiceLogs(runId, svc, receipt.started_at ?? st.probe_started_at ?? null);
      serviceLogs[svc] = saveLogEvidence(runId, st.trial_id, svc, cap);
    } catch (e) {
      serviceLogs[svc] = { error: e.message.slice(0, 200) };
    }
  }
  const recoveryRef = `pg-recovery-${st.trial_id}.json`;
  atomicWriteJson(path.join(runPaths(runId).evidenceDir, recoveryRef), {
    arm: st.arm,
    fault_receipt: receipt,
    recovery,
    operator_recovery: operatorRecovery,
    wal_recovery_log: wal,
    pg_settings: pgSettings,
    post_snapshot_ref: path.basename(postEv.file),
    api_snapshot_ref: st.api_snapshot?.ref ?? null,
    api_snapshot_error: st.api_snapshot_error ?? null,
    probe_summary_ref: `probe-summary-${st.trial_id}.json`,
    service_logs: serviceLogs,
  });

  // 7d. D5 identity: re-capture deployment evidence post-up and compare
  // PGDATA mount source + image lineage against the pre-fault capture.
  let d5Identity = null;
  if (st.arm === "D5") {
    const preIdPath = path.join(runPaths(runId).evidenceDir, "deployment-identity.json");
    if (fs.existsSync(preIdPath)) fs.copyFileSync(preIdPath, path.join(runPaths(runId).evidenceDir, "deployment-identity-pre.json"));
    const postEv2 = await captureDeploymentEvidence(runId);
    const pre = st.deployment_evidence;
    d5Identity = {
      pgdata_mount_source_pre: pre?.pgdata_mount?.source ?? null,
      pgdata_mount_source_post: postEv2.pgdata_mount?.source ?? null,
      pgdata_mount_source_same: pre?.pgdata_mount?.source != null && pre.pgdata_mount.source === postEv2.pgdata_mount?.source,
      image_ids_pre: Object.fromEntries(Object.entries(pre?.images ?? {}).map(([svc, i]) => [svc, i.image_id])),
      image_ids_post: Object.fromEntries(Object.entries(postEv2.images ?? {}).map(([svc, i]) => [svc, i.image_id])),
      image_ids_same: Object.fromEntries(
        Object.keys(postEv2.images ?? {}).map((svc) => [svc, pre?.images?.[svc]?.image_id != null && pre.images[svc].image_id === postEv2.images[svc].image_id]),
      ),
      container_ids_changed: receipt.container_ids_changed ?? null,
      filesystem_post: postEv2.filesystem,
      note: "container ID change across down/up is the expected fact; data continuity is judged by PGDATA mount, image lineage, and the oracle's attempt-row comparison",
    };
    st.d5_identity = d5Identity;
  }
  atomicWriteJson(path.join(runPaths(runId).evidenceDir, `probe-summary-${st.trial_id}.json`), st.fault_window_probe);

  st.post_snapshot = { ref: path.basename(postEv.file), sha256: postEv.sha256, latency_ms: postEv.latencyMs };
  st.post_snapshot_row_status = post.row.status;
  // ── RTO metrics (§8): each figure names its start/stop events and its
  // measurement method. No figure is inferred from Docker state alone.
  const faultStepAt = receipt.kill_at ?? receipt.stop_at ?? receipt.down_at ?? null;
  const recoveryActionAt = receipt.manual_start_at ?? receipt.start_at ?? receipt.up_at ?? null;
  const outageWindowMs =
    recovery.first_ok_at && faultStepAt ? Date.parse(recovery.first_ok_at) - Date.parse(faultStepAt) : null;
  st.rto = {
    // How long the fault COMMAND itself took (kill/stop/down).
    fault_command_duration_ms: receipt.fault_command_duration_ms ?? null,
    // F6: what the continuous probe actually SAW on the /api/ready channel.
    observed_api_outage: probeSummary?.observed_api_outage ?? "NOT_ESTABLISHED",
    observed_http_outage_ms: probeSummary?.api?.observed_outage_ms ?? null,
    observed_outage_note:
      probeSummary?.observed_api_outage === "OBSERVED"
        ? `first failed sample ${probeSummary.api.first_fail_at} → first OK sample ${probeSummary.api.first_ok_after_fail_at} (sampling resolution ${probeSummary.interval_ms}ms; the true outage began at most one interval earlier)`
        : "no failed /api/ready sample captured — outage window NOT established (never fabricated)",
    bounded_outage_ms: probeSummary?.api?.bounded_outage_ms ?? null,
    // Receipt-timestamp window: fault action → first chain-ready response
    // (includes any dwell/restart-policy window).
    outage_window_ms: outageWindowMs,
    outage_window_note:
      st.arm === "D2"
        ? "SIGKILL → chain /api/ready first OK (includes the 5s auto-restart observation window when no policy restart happened)"
        : st.arm === "D5"
          ? "compose down → chain /api/ready first OK (includes the observation dwell)"
          : "graceful stop → chain /api/ready first OK (includes the observation dwell)",
    fault_applied_at: faultStepAt ?? receipt.started_at ?? null,
    // Operator wait: fault action → the recovery action (start/up). Arms
    // whose service self-recovered have no operator wait.
    operator_wait_ms:
      recoveryActionAt && faultStepAt ? Date.parse(recoveryActionAt) - Date.parse(faultStepAt) : null,
    // Recovery action → first OK.
    service_recovery_ms: recovery.window_ms,
    probe_resolution_ms: probeSummary?.interval_ms ?? null,
    // D2 semantics: did the restart policy fire, or did the operator act?
    app_restart_mode:
      receipt.auto_restart === undefined
        ? st.arm === "D1"
          ? "operator_start_after_graceful_stop"
          : null
        : receipt.auto_restart
          ? "restart_policy"
          : "operator_manual_start",
    app_restart_started_at: receipt.restarted_started_at ?? receipt.manual_start_at ?? receipt.start_at ?? null,
    auto_restart_window_ms: receipt.auto_restart_window_ms ?? null,
    // D3: did the app reconnect by itself after db came back?
    app_recovery_mode: st.arm === "D3" ? (operatorRecovery ? "OPERATOR_RECOVERY_REQUIRED (operator restart)" : "auto_reconnect_observed") : null,
    operator_recovery: operatorRecovery,
    // D1: SIGTERM handling must finish inside stop_grace_period.
    graceful_stop_escalated: receipt.graceful_stop_escalated ?? null,
    post_stop_exit_code: receipt.post_stop_exit_code ?? null,
    // D5: container identity expectations.
    container_ids_changed: receipt.container_ids_changed ?? null,
    pgdata_mount_source_same: receipt.pgdata_mount_source_same ?? (d5Identity ? d5Identity.pgdata_mount_source_same : null),
    // F6 replaces the old single late static probe.
    static_page_observed: probeSummary?.static?.observed ?? null,
    bystanders_unchanged: receipt.bystanders_unchanged ?? null,
  };
  st.phase = "service_recovered";
  saveState(runId, st);

  writer.append("SERVICE_RECOVERED", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    arm: st.arm,
    rto_window_ms: recovery.window_ms,
    outage_window_ms: outageWindowMs,
    observed_api_outage: st.rto.observed_api_outage,
    observed_http_outage_ms: st.rto.observed_http_outage_ms,
    probe: recovery.url,
    app_restart_mode: st.rto.app_restart_mode,
    app_recovery_mode: st.rto.app_recovery_mode,
    graceful_stop_escalated: st.rto.graceful_stop_escalated,
    operator_recovery_required: operatorRecovery ? true : false,
    pg_recovery_evidence_ref: `../evidence/${recoveryRef}`,
    probe_evidence_ref: `../evidence/probe-${st.trial_id}.jsonl`,
    api_snapshot_ref: st.api_snapshot?.ref ?? null,
    note: "service chain healthy; browser reload may proceed",
  });
  console.log("SERVICE_RECOVERED emitted; waiting for BROWSER_VERIFIED");
}

/** Persist a service-log capture as run evidence (graceful-shutdown lines,
 *  pool errors, boot/migration output). */
function saveLogEvidence(runId, trialId, service, capture) {
  const file = path.join(runPaths(runId).evidenceDir, `service-logs-${trialId}-${service}.json`);
  fs.writeFileSync(file, JSON.stringify({ captured_at: new Date().toISOString(), ...capture }, null, 2));
  return { ref: path.basename(file), lines: capture.lineCount ?? null };
}

/**
 * API take-snapshot leg: log in as the candidate over the REAL serving path
 * and fetch GET /candidate/attempts/:attemptId/take (CandidateTakeSnapshot —
 * the frontend's business truth source). Credentials come from the local-only
 * channel; the snapshot is stored as evidence with its sha256, and a compact
 * apiState {questionId → {value, version, source}} is returned for the
 * three-way comparator.
 */
async function captureApiTakeSnapshot(runId, st) {
  const creds = JSON.parse(fs.readFileSync(path.join(mailboxDir(runId), "credentials.local.json"), "utf8"));
  const client = new ApiClient(st.origin);
  await client.login(creds.candidate.username, creds.candidate.password);
  const snap = await client.must("GET", `/api/candidate/attempts/${st.attempt_id}/take`, undefined, [200]);
  const apiState = {};
  for (const q of snap.questions ?? []) {
    apiState[q.id] = {
      value: q.answerValue ?? null,
      version: q.currentVersion ?? null,
      source: q.answerSource ?? null,
    };
  }
  const capturedAt = new Date().toISOString();
  const file = path.join(runPaths(runId).evidenceDir, `api-snapshot-${st.trial_id}.json`);
  const body = {
    schema_version: SCHEMA_VERSION,
    kind: "exam817/api-take-snapshot",
    run_id: st.run_id,
    trial_id: st.trial_id,
    attempt_id: st.attempt_id,
    captured_at: capturedAt,
    attempt_status: snap.attemptStatus,
    server_revision: snap.serverRevision,
    snapshot: snap,
    api_state: apiState,
  };
  atomicWriteJson(file, body);
  return {
    file,
    sha256: sha256Hex(fs.readFileSync(file)),
    attemptStatus: snap.attemptStatus,
    apiState,
    capturedAt,
  };
}

async function writeVerdict(runId, st, writer, { verdict, reason }) {
  // Per-question classification requires BOTH snapshots: with only the pre
  // snapshot a missing post row would masquerade as ACK_LOST.
  const perQuestion =
    st.pre_snapshot && st.post_snapshot
      ? classifyPerQuestion({
          manifestQuestions: st.manifest_questions,
          attemptRow: loadSnapshotRow(runId, st.post_snapshot?.ref),
          ackState: st.ack_state,
          // F11: an absent browser leg must surface as per-question NOT_RUN
          // (fail closed), never as an empty map that vacuously passes the
          // COMPLETE branch. Only the BROWSER_VERIFIED handler (phase
          // verdict_phase) populates st.browser_state.
          browserState: st.browser_state ?? {},
          apiState: st.api_state ?? null,
        })
      : null;
  // counts = PG durability leg (ACK−P), the D0/D4 vocabulary.
  const counts = {};
  for (const q of perQuestion ?? []) counts[q.classification] = (counts[q.classification] ?? 0) + 1;
  const browserCounts = {};
  for (const q of perQuestion ?? []) {
    if (q.browser_classification) browserCounts[q.browser_classification] = (browserCounts[q.browser_classification] ?? 0) + 1;
  }
  const apiCounts = {};
  for (const q of perQuestion ?? []) {
    if (q.api_classification) apiCounts[q.api_classification] = (apiCounts[q.api_classification] ?? 0) + 1;
  }
  const deviations = (perQuestion ?? []).filter((q) => q.scenario_deviation);

  // Fault-domain purity: any bystander id/StartedAt change poisons the trial.
  const bystanders = st.fault_terminal?.receipt?.bystanders_unchanged ?? null;
  const contaminated = bystanders !== null && Object.values(bystanders).some((v) => v === false);

  const mutation = oracleMutationRedTest();
  let finalVerdict = verdict;
  let finalReason = reason ?? null;
  if (!finalVerdict) {
    // Verdict vocabulary per #817 D2 brief §8. DATA_MISMATCH covers both the
    // PG durability leg and the API serving leg (LOSS_OBSERVED in the #819
    // D0/D4 vocabulary corresponds to DATA_MISMATCH here).
    if (contaminated) finalVerdict = "FAULT_DOMAIN_CONTAMINATED";
    else if ((counts.ACK_LOST ?? 0) > 0 || (counts.UNACKNOWLEDGED_UNKNOWN ?? 0) > 0) finalVerdict = "DATA_MISMATCH";
    else if ((apiCounts.API_MISMATCH ?? 0) > 0) finalVerdict = "DATA_MISMATCH";
    else if ((browserCounts.BROWSER_MISMATCH ?? 0) > 0) finalVerdict = "BROWSER_MISMATCH";
    else if (st.api_snapshot_error) {
      finalVerdict = "UNKNOWN";
      finalReason = `COMPLETE requires the API serving leg; take snapshot failed: ${st.api_snapshot_error}`;
    } else if ((apiCounts.NOT_RUN ?? 0) > 0 || (apiCounts.UNKNOWN ?? 0) > 0) {
      finalVerdict = "UNKNOWN";
      finalReason = `API leg incomplete for ${apiCounts.NOT_RUN ?? 0}/${apiCounts.UNKNOWN ?? 0} question(s)`;
    } else if ((browserCounts.NOT_RUN ?? 0) > 0 || (browserCounts.UNKNOWN ?? 0) > 0) {
      finalVerdict = "UNKNOWN";
      finalReason = `browser leg incomplete (NOT_RUN=${browserCounts.NOT_RUN ?? 0}, UNKNOWN=${browserCounts.UNKNOWN ?? 0})`;
    } else if (!st.browser_verified) {
      // Belt and suspenders: COMPLETE requires a received BROWSER_VERIFIED.
      finalVerdict = "UNKNOWN";
      finalReason = "browser leg never received (no BROWSER_VERIFIED event) — COMPLETE is not available";
    } else if (st.rto?.graceful_stop_escalated === true) {
      // D1 discipline (#817 D135 brief §6): a stop that ended in SIGKILL is
      // never reported as a pure graceful-stop success, even when every
      // answer reconciled.
      finalVerdict = "GRACEFUL_STOP_ESCALATED";
      finalReason = `stop escalated to SIGKILL (exit ${st.rto.post_stop_exit_code}) after stop_grace_period — data reconciled, but this is not a graceful-shutdown result`;
    } else finalVerdict = "COMPLETE";
  }

  const verdictBody = {
    schema_version: SCHEMA_VERSION,
    kind: "exam817/verdict",
    run_id: st.run_id,
    trial_id: st.trial_id,
    arm: st.arm,
    source_sha: BASE_SHA,
    verdict: finalVerdict,
    reason: finalReason,
    verdict_semantics:
      "COMPLETE requires real fault identity, 10/10 ACK_MATCHED on the PG leg, service recovery, and ACK→PG→API→Browser agreement; DATA_MISMATCH = server-side authority differs from the last ACK (PG or API leg); BROWSER_MISMATCH = server correct but candidate page diverges; FAULT_DOMAIN_CONTAMINATED = a non-target fault domain (db/redis) changed identity.",
    attempt_id: st.attempt_id,
    exam_id: st.exam_id,
    counts,
    browser_counts: browserCounts,
    api_counts: apiCounts,
    fault_domain_contaminated: contaminated,
    bystanders_unchanged: bystanders,
    scenario_deviations: deviations.map((d) => ({
      question_id: d.question_id,
      order: d.order,
      type: d.type,
      manifest_expected: d.manifest_expected_value,
      acked_value: d.acked_value,
      note: "ACKed content differs from the scenario manifest (authoring reality, not answer loss)",
    })),
    per_question: perQuestion,
    rto: st.rto ?? null,
    fault_window_probe: st.fault_window_probe ?? null,
    d5_identity: st.d5_identity ?? null,
    resume_recovery_action: st.resume_recovery_action ?? null,
    pre_consistency: st.pre_consistency ?? null,
    fault: st.fault_terminal ?? null,
    fault_resolved: st.fault_resolved ?? null,
    oracle_mutation_test: { red: mutation.red, green: mutation.green, detail: mutation.detail },
    evidence_refs: {
      pre_snapshot: st.pre_snapshot ?? null,
      post_snapshot: st.post_snapshot ?? null,
      api_snapshot: st.api_snapshot ?? null,
      api_snapshot_error: st.api_snapshot_error ?? null,
      browser: st.browser_verified?.evidence_ref ?? null,
      deployment_identity: "deployment-identity.json",
    },
    window_error: st.window_error ?? null,
    generated_at: new Date().toISOString(),
  };
  atomicWriteJson(path.join(mailboxDir(runId), "verdict.json"), verdictBody);
  writer.append("VERDICT_PUBLISHED", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    verdict: finalVerdict,
    counts,
    browser_counts: browserCounts,
    api_counts: apiCounts,
    fault_domain_contaminated: contaminated,
    verdict_ref: "verdict.json",
    oracle_mutation_test: { red: mutation.red, green: mutation.green },
  });
  console.log(`verdict: ${finalVerdict} ${JSON.stringify(counts)} browser=${JSON.stringify(browserCounts)} api=${JSON.stringify(apiCounts)}`);
}

function loadSnapshotRow(runId, snapshotFile) {
  if (!snapshotFile) return null;
  const p = path.join(runPaths(runId).evidenceDir, snapshotFile);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")).row;
}

/**
 * Republish the trial verdict from persisted state (idempotent; no fault
 * execution, no mailbox dispatch — a fresh VERDICT_PUBLISHED with a unique
 * seq is appended, which the protocol already treats as normal). Used when
 * evidence parsing improved after a fail-closed verdict, or to bake the F5
 * RTO correction into the verdict body from the persisted fault receipt.
 */
async function cmdVerdict(runId) {
  const st = loadState(runId);
  if (!st.pre_snapshot || !st.post_snapshot) {
    throw new Error(`verdict requires both snapshots (pre=${!!st.pre_snapshot} post=${!!st.post_snapshot})`);
  }
  // F5 correction: if the live path failed to compute the true outage window
  // (receipt.steps lookup gap), recompute it from the persisted fault
  // receipt's own mutating-step timestamp + the probe's first_ok_at.
  if (st.rto && st.rto.outage_window_ms == null && st.rto.first_ok_at && st.fault_terminal?.receipt) {
    const r = st.fault_terminal.receipt;
    const appliedAt = r.kill_at ?? r.stop_at ?? r.down_at ?? null;
    if (appliedAt) {
      st.rto.outage_window_ms = Date.parse(st.rto.first_ok_at) - Date.parse(appliedAt);
      st.rto.outage_note = "recomputed at verdict time from the fault receipt timestamp + probe first_ok_at (F5)";
      saveState(runId, st);
    }
  }
  // F7: no alias-chain re-derivation. browser_state comes exclusively from
  // the strict v2 parse at BROWSER_VERIFIED dispatch time.
  const writer = new EventWriter(path.join(mailboxDir(runId), "wsl.events.jsonl"), path.join(runPaths(runId).evidenceDir, "wsl-seq.json"));
  await writeVerdict(runId, st, writer, {});
}

/**
 * Continue a trial whose fault FAILED after its mutating step completed
 * (F9/D5-01: a harness-side check aborted between `compose down` and
 * `compose up`). The fault itself demonstrably fired (journaled); this
 * command performs the DOCUMENTED REMAINING HALF — never a re-fault:
 *   D5         → compose up (same project, same PGDATA)
 *   stop_start → compose start <target>
 * The early UNKNOWN verdict stays in history (revision chain); the amended
 * FAULT_APPLIED receipt marks the continuation explicitly.
 */
async function cmdResumeRecovery(runId) {
  const st = loadState(runId);
  if (st.phase !== "incomplete" || st.fault_terminal?.kind !== "FAULT_FAILED") {
    throw new Error(`resume-recovery requires phase=incomplete + FAULT_FAILED terminal (got phase=${st.phase}, terminal=${st.fault_terminal?.kind ?? "none"})`);
  }
  const originalFailure = st.fault_terminal.reason;
  const faultState = JSON.parse(fs.readFileSync(faultStatePath(runId), "utf8"));
  if (faultState.trial_id !== st.trial_id || faultState.arm !== st.arm) {
    throw new Error("resume-recovery: fault journal does not match run state");
  }
  const okSteps = new Set((faultState.steps ?? []).filter((s) => s.ok).map((s) => s.name));
  const writer = new EventWriter(path.join(mailboxDir(runId), "wsl.events.jsonl"), path.join(runPaths(runId).evidenceDir, "wsl-seq.json"));
  const receipt = {
    arm: st.arm,
    trial_id: st.trial_id,
    started_at: faultState.started_at,
    resumed_after_fault_failed: true,
    original_failure: originalFailure,
  };

  if (st.arm === "D5") {
    if (!okSteps.has("compose_down")) {
      throw new Error("resume-recovery: compose_down not journaled as complete — refusing (stack state unproven)");
    }
    receipt.pre = (faultState.steps ?? []).find((s) => s.name === "pre_identity")?.result ?? null;
    receipt.down_at =
      (faultState.steps ?? []).find((s) => s.name === "compose_down")?.result?.down_at ??
      (faultState.steps ?? []).find((s) => s.name === "compose_down")?.at ??
      null;
    receipt.down_ms = (faultState.steps ?? []).find((s) => s.name === "compose_down")?.result?.down_ms ?? null;
    receipt.fault_command_duration_ms = receipt.down_ms;
    console.log("resume-recovery: compose up (same project, same PGDATA)...");
    const upStart = Date.now();
    const { composeUp } = await import("./stack.mjs");
    await composeUp(runId);
    receipt.up_at = new Date().toISOString();
    receipt.up_ms = Date.now() - upStart;
    // Wait for Running state, then rebuild post identity.
    const deadline = Date.now() + 90000;
    let lastErr = null;
    for (;;) {
      try {
        for (const svc of ["app", "web", "db"]) await resolveTarget(runId, svc);
        break;
      } catch (e) {
        lastErr = e.message;
        if (Date.now() > deadline) throw new Error(`containers not running within 90s after resume up: ${lastErr}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    receipt.post = {};
    for (const svc of ["app", "web", "db"]) {
      const t = await resolveTarget(runId, svc);
      receipt.post[svc] = { ...t, ...(await containerDetails(t.id)) };
    }
    receipt.container_ids_changed = Object.fromEntries(
      Object.keys(receipt.post).map((svc) => [svc, receipt.pre?.[svc]?.id !== receipt.post[svc].id]),
    );
    receipt.pgdata_mount_source_same =
      receipt.pre?.db?.pgdata_mount_source != null && receipt.pre.db.pgdata_mount_source === receipt.post.db.pgdata_mount_source;
    receipt.image_ids_same = Object.fromEntries(
      Object.keys(receipt.post).map((svc) => [svc, receipt.pre?.[svc]?.image_id != null && receipt.pre[svc].image_id === receipt.post[svc].image_id]),
    );
  } else if (st.fault_plan.action === "stop_start") {
    if (!okSteps.has("graceful_stop")) {
      throw new Error("resume-recovery: graceful_stop not journaled as complete — refusing");
    }
    receipt.container_id = (faultState.steps ?? []).find((s) => s.name === "pre_identity")?.result?.id ?? null;
    receipt.stop_at = (faultState.steps ?? []).find((s) => s.name === "graceful_stop")?.at ?? null;
    console.log(`resume-recovery: compose start ${st.fault_plan.target}...`);
    const startRes = await composeStartService(runId, st.fault_plan.target);
    receipt.start_at = startRes.at;
    receipt.start_ms = startRes.ms;
    const post = await resolveTarget(runId, st.fault_plan.target);
    receipt.post_restart = { id: post.id, startedAt: post.startedAt, same_container_id: post.id === receipt.container_id };
  } else {
    throw new Error(`resume-recovery: no continuation defined for arm ${st.arm}`);
  }

  // Fresh probe segment for the continuation, appended to the same samples
  // file so the outage summary spans the full real down window.
  const probe = await startFaultWindowProbe({
    runId: st.run_id,
    origin: st.origin,
    evidenceDir: runPaths(runId).evidenceDir,
    trialId: st.trial_id,
  });

  st.fault_terminal = { kind: "FAULT_APPLIED", receipt };
  st.phase = "fault_done";
  saveState(runId, st);
  writer.append("RESUME_RECOVERY", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    arm: st.arm,
    original_failure: originalFailure,
    continuation: st.arm === "D5" ? "compose up (same PGDATA)" : `compose start ${st.fault_plan.target}`,
    up_at: receipt.up_at ?? receipt.start_at ?? null,
  });
  console.log("RESUME_RECOVERY journaled; running recovery phase");
  await runRecoveryPhase(runId, st, writer, receipt, probe);
}

// ── cleanup / report ──────────────────────────────────────────────

async function cmdCleanup(runId, { deleteData = false } = {}) {
  const p = runPaths(runId);
  const project = `exam817-${runId}`;
  const { stdout: beforePs } = await execFileP(
    "docker",
    ["ps", "-a", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}} {{.Names}} {{.Status}}"],
  ).catch(() => ({ stdout: "" }));
  if (beforePs.trim().length > 0) {
    const { stdout } = await execFileP("docker", [
      "compose",
      "--env-file",
      p.envFile,
      "-f",
      "/home/hoo/Source/exam-817-harness/docker-compose.yml",
      "-p",
      project,
      "down",
    ]);
    console.log(stdout.trim().split("\n").slice(-4).join("\n"));
  }
  const { stdout: afterPs } = await execFileP(
    "docker",
    ["ps", "-a", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}"],
  ).catch(() => ({ stdout: "" }));
  let dataDeleted = false;
  if (deleteData && afterPs.trim().length === 0) {
    // PGDATA files are owned by the container's postgres uid; deleting from
    // the host needs root. A throwaway container bind-mounts EXACTLY this
    // run's data root (never a parent) and removes its contents.
    await execFileP("docker", [
      "run",
      "--rm",
      "-v",
      `${p.dataRoot}:/target`,
      "alpine:latest",
      "sh",
      "-c",
      "rm -rf /target/postgres /target/redis && ls -A /target",
    ]).catch((e) => {
      throw new Error(`data cleanup container failed: ${e.message}`);
    });
    fs.rmSync(p.dataRoot, { recursive: true, force: true });
    dataDeleted = !fs.existsSync(p.dataRoot);
  }
  const receipt = {
    run_id: runId,
    cleaned_at: new Date().toISOString(),
    containers_before: beforePs.trim().split("\n").filter(Boolean),
    containers_after: afterPs.trim().split("\n").filter(Boolean),
    data_root_deleted: dataDeleted,
    data_root: deleteData ? p.dataRoot : "retained",
  };
  atomicWriteJson(path.join(p.evidenceDir, "cleanup-receipt.json"), receipt);
  console.log(JSON.stringify(receipt, null, 2));
}

function cmdStatus(runId) {
  const st = loadState(runId);
  const { run_id, trial_id, arm, phase, origin, exam_id, attempt_id } = st;
  console.log(JSON.stringify({ run_id, trial_id, arm, phase, origin, exam_id, attempt_id, acks: Object.keys(st.ack_state ?? {}).length }, null, 2));
}

function cmdReport(runId) {
  const st = loadState(runId);
  const vPath = path.join(mailboxDir(runId), "verdict.json");
  const verdict = fs.existsSync(vPath) ? JSON.parse(fs.readFileSync(vPath, "utf8")) : null;
  const ev = fs.existsSync(path.join(runPaths(runId).evidenceDir, "deployment-identity.json"))
    ? JSON.parse(fs.readFileSync(path.join(runPaths(runId).evidenceDir, "deployment-identity.json"), "utf8"))
    : null;
  console.log(JSON.stringify({
    BASE_SHA: BASE_SHA,
    RUN_ID: st.run_id,
    TRIAL_ID: st.trial_id,
    ARM: st.arm,
    PHASE: st.phase,
    TEST_PROJECT: ev?.project ?? `exam817-${st.run_id}`,
    PGDATA_IDENTITY: ev?.pgdata_mount ?? null,
    ORIGIN: st.origin,
    EXAM_ID: st.exam_id,
    RTO_MS: st.rto?.window_ms ?? null,
    VERDICT: verdict?.verdict ?? "NOT_READY",
    COUNTS: verdict?.counts ?? null,
  }, null, 2));
}

// ── main ──────────────────────────────────────────────────────────

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const [cmd, runId] = process.argv.slice(2);
const argv = process.argv.slice(2);
const getOpt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};

(async () => {
  switch (cmd) {
    case "init":
      cmdInit(argv.slice(1));
      break;
    case "deploy":
      await cmdDeploy(runId);
      break;
    case "seed":
      await cmdSeed(runId);
      break;
    case "publish":
      await cmdPublish(runId);
      break;
    case "verdict":
      await cmdVerdict(runId);
      break;
    case "wait":
      await cmdWait(runId, {
        timeoutSec: Number(getOpt("--timeout-sec", "7200")),
        browserTimeoutSec: Number(getOpt("--browser-timeout-sec", "900")),
      });
      break;
    case "resume-recovery":
      await cmdResumeRecovery(runId);
      break;
    case "status":
      cmdStatus(runId);
      break;
    case "cleanup":
      await cmdCleanup(runId, { deleteData: argv.includes("--delete-data") });
      break;
    case "report":
      cmdReport(runId);
      break;
    default:
      console.error(`usage: run.mjs <init|deploy|seed|publish|wait|resume-recovery|status|cleanup|report> <run_id> [options]`);
      process.exit(2);
  }
})().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  if (process.env.E817_DEBUG) console.error(e.stack);
  process.exit(1);
});
