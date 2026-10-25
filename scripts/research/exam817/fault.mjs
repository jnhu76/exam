#!/usr/bin/env node
// Exam #817 — post-ACK controlled fault execution with identity gates.
//
// Replay safety: a fault is an unrepeatable side effect. The protocol is
//   CHECKPOINT_READY → validate against frozen plan → FAULT_INTENT (fsynced)
//   → identity gate (project label + container ID) → execute → FAULT_APPLIED
//   | FAULT_FAILED (fsynced).
// If the process dies between INTENT and the terminal event, restart logic
// resolves APPLIED / NOT_APPLIED / UNKNOWN from container state and receipts
// — it NEVER re-kills merely because no FAULT_APPLIED was logged.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { runProjectName, runPaths } from "./stack.mjs";

const execFileP = promisify(execFile);

export const FAULT_PLAN = {
  D0: { label: "no fault (baseline)", action: "none", target: null },
  D1: { label: "app graceful stop + start", action: "stop_start", target: "app" },
  D2: { label: "app SIGKILL", action: "kill", target: "app" },
  D3: { label: "db graceful stop + start", action: "stop_start", target: "db" },
  D4: { label: "db SIGKILL (WAL crash recovery)", action: "kill", target: "db" },
  D5: { label: "compose down/up, same PGDATA", action: "down_up", target: null },
};

// Experiment condition, not an SLA: how long observe_auto_restart waits for
// the restart policy before recording "no auto-restart" and recovering as the
// operator. D2 freezes 5s (#817 D2 brief); D4 keeps its historical 30s for
// comparability with #819.
const AUTO_RESTART_WINDOW_MS = { D1: 30000, D2: 5000, D3: 30000, D4: 30000 };

// Non-target services whose identity must stay untouched for a trial to
// count as a pure single-domain fault (FAULT_DOMAIN_CONTAMINATED otherwise).
const BYSTANDER_SERVICES = ["app", "db", "redis"];

function runRoot(runId) {
  return runPaths(runId).root;
}

export function faultStatePath(runId) {
  return path.join(runRoot(runId), "evidence", "fault-execution.json");
}

function readFaultState(runId) {
  const p = faultStatePath(runId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeFaultState(runId, state) {
  const p = faultStatePath(runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

async function dockerExec(args) {
  const { stdout, stderr } = await execFileP("docker", args, {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout, stderr };
}

/**
 * Identity gate: resolve the target container for a service and verify it
 * belongs to this run's compose project. Returns {id, name, startedAt,
 * restartCount} or throws.
 */
export async function resolveTarget(runId, service) {
  const project = runProjectName(runId);
  const { stdout } = await execFileP(
    "docker",
    ["ps", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}\t{{.Names}}\t{{.Labels}}"],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const rows = stdout.split("\n").filter(Boolean).map((l) => {
    const [id, name, labels] = l.split("\t");
    return { id, name, labels: labels ?? "" };
  });
  const matches = [];
  for (const r of rows) {
    if (r.labels.split(",").includes(`com.docker.compose.service=${service}`)) matches.push(r);
  }
  if (matches.length !== 1) {
    throw new Error(
      `identity gate: expected exactly 1 '${service}' container in project ${project}, found ${matches.length}`,
    );
  }
  const m = matches[0];
  const { stdout: inspRaw } = await execFileP("docker", ["inspect", m.id], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const insp = JSON.parse(inspRaw)[0];
  if (insp.Config?.Labels?.["com.docker.compose.project"] !== project) {
    throw new Error(`identity gate: inspect labels do not match project ${project}`);
  }
  if (insp.State?.Status !== "running") {
    throw new Error(`identity gate: container ${m.id} is not running (state=${insp.State?.Status})`);
  }
  return { id: m.id, name: m.name, startedAt: insp.State.StartedAt, restartCount: insp.RestartCount ?? 0 };
}

/**
 * Execute one fault. Returns a receipt. Throws only on unexpected harness
 * errors; the receipt itself records command success/failure honestly.
 */
export async function executeFault(runId, { arm, trialId, autoRestartWindowMs } = {}) {
  const plan = FAULT_PLAN[arm];
  if (!plan) throw new Error(`unknown arm ${arm}`);
  const restartWindowMs = autoRestartWindowMs ?? AUTO_RESTART_WINDOW_MS[arm] ?? 30000;
  const startedAt = new Date().toISOString();
  const state = {
    run_id: runId,
    trial_id: trialId,
    arm,
    plan: plan,
    started_at: startedAt,
    steps: [],
    terminal: null,
  };
  writeFaultState(runId, state);

  const step = async (name, fn) => {
    const s = { name, at: new Date().toISOString() };
    try {
      s.result = await fn();
      s.ok = true;
    } catch (e) {
      s.ok = false;
      s.error = e.message;
      state.steps.push(s);
      state.terminal = { kind: "FAULT_FAILED", reason: `${name}: ${e.message}` };
      writeFaultState(runId, state);
      throw e;
    }
    state.steps.push(s);
    writeFaultState(runId, state);
    return s.result;
  };

  const receipt = { arm, trial_id: trialId, started_at: startedAt };

  if (arm === "D0") {
    receipt.action = "none";
    receipt.note = "no-fault baseline arm";
    state.terminal = { kind: "FAULT_APPLIED", receipt };
    writeFaultState(runId, state);
    return receipt;
  }

  if (arm === "D5") {
    await step("pre_identity", async () => {
      receipt.pre = {};
      for (const svc of ["app", "web", "db"]) {
        receipt.pre[svc] = await resolveTarget(runId, svc);
      }
      return receipt.pre;
    });
    await step("compose_down", async () => {
      const p = runPaths(runId);
      const { stdout } = await execFileP(
        "docker",
        ["compose", "--env-file", p.envFile, "-f", "/home/hoo/Source/exam-817-harness/docker-compose.yml", "-p", runProjectName(runId), "down"],
        { encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
      );
      receipt.down_output = stdout.slice(-2000);
      receipt.down_at = new Date().toISOString();
      // Verify containers are gone.
      const { stdout: psOut } = await execFileP(
        "docker",
        ["ps", "-a", "--filter", `label=com.docker.compose.project=${runProjectName(runId)}`, "--format", "{{.ID}}"],
        { encoding: "utf8" },
      );
      if (psOut.trim().length > 0) {
        throw new Error(`containers still present after down: ${psOut.trim()}`);
      }
      return "containers removed";
    });
    await step("pgdata_survival", async () => {
      const p = runPaths(runId);
      if (!fs.existsSync(path.join(p.pgdata, "PG_VERSION"))) {
        throw new Error(`PG_VERSION missing after down — PGDATA did not survive`);
      }
      return { pgdata: p.pgdata, pg_version_file: fs.readFileSync(path.join(p.pgdata, "PG_VERSION"), "utf8").trim() };
    });
    await step("compose_up", async () => {
      const p = runPaths(runId);
      const { stdout } = await execFileP(
        "docker",
        ["compose", "--env-file", p.envFile, "-f", "/home/hoo/Source/exam-817-harness/docker-compose.yml", "-p", runProjectName(runId), "up", "-d"],
        { encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024 },
      );
      receipt.up_output = stdout.slice(-2000);
      receipt.up_at = new Date().toISOString();
      return "stack started";
    });
    await step("post_identity", async () => {
      receipt.post = {};
      for (const svc of ["app", "web", "db"]) {
        receipt.post[svc] = await resolveTarget(runId, svc);
      }
      receipt.container_ids_changed = Object.fromEntries(
        Object.keys(receipt.post).map((svc) => [svc, receipt.pre[svc].id !== receipt.post[svc].id]),
      );
      return receipt.post;
    });
    receipt.action = "down_up";
    state.terminal = { kind: "FAULT_APPLIED", receipt };
    writeFaultState(runId, state);
    return receipt;
  }

  // D1–D4: single-container fault on plan.target.
  const target = plan.target;
  const targetInfo = await step("pre_identity", async () => {
    const info = await resolveTarget(runId, target);
    receipt.container_id = info.id;
    receipt.container_name = info.name;
    receipt.pre_started_at = info.startedAt;
    receipt.pre_restart_count = info.restartCount;
    return info;
  });

  // Contamination evidence: identity of every non-target fault domain, taken
  // before the mutation. A post-fault id/StartedAt change on any bystander
  // marks the trial FAULT_DOMAIN_CONTAMINATED (not a pure single-domain arm).
  const bystanders = BYSTANDER_SERVICES.filter((s) => s !== target);
  if (bystanders.length > 0) {
    await step("bystanders_pre", async () => {
      receipt.bystanders_pre = {};
      for (const svc of bystanders) receipt.bystanders_pre[svc] = await resolveTarget(runId, svc);
      return receipt.bystanders_pre;
    });
  }

  if (plan.action === "stop_start") {
    await step("graceful_stop", async () => {
      const t0 = Date.now();
      const { stdout } = await dockerExec(["stop", "-t", "45", targetInfo.id]);
      receipt.stop_output = stdout.trim();
      receipt.stop_ms = Date.now() - t0;
      receipt.stop_at = new Date().toISOString();
      const { stdout: stRaw } = await execFileP("docker", ["inspect", "-f", "{{.State.Status}} exit={{.State.ExitCode}}", targetInfo.id], { encoding: "utf8" });
      receipt.post_stop_state = stRaw.trim();
      if (!receipt.post_stop_state.startsWith("exited")) {
        throw new Error(`container did not stop cleanly: ${receipt.post_stop_state}`);
      }
      return receipt.post_stop_state;
    });
    await step("manual_restart", async () => {
      // restart: unless-stopped does NOT restart a manually stopped container —
      // the harness performs the operator's start, recorded as its own step.
      const t0 = Date.now();
      await dockerExec(["start", targetInfo.id]);
      receipt.start_ms = Date.now() - t0;
      receipt.start_at = new Date().toISOString();
      return "started";
    });
  } else if (plan.action === "kill") {
    await step("sigkill", async () => {
      const t0 = Date.now();
      const { stdout } = await dockerExec(["kill", targetInfo.id]);
      receipt.kill_output = stdout.trim();
      receipt.kill_ms = Date.now() - t0;
      receipt.kill_at = new Date().toISOString();
      receipt.fault_command_duration_ms = receipt.kill_ms;
      receipt.signal = "SIGKILL";
      return receipt.kill_output;
    });
    await step("observe_auto_restart", async () => {
      // restart: unless-stopped SHOULD auto-restart a killed container.
      // Observe the real behavior for the arm's frozen window; never assume it.
      const deadline = Date.now() + restartWindowMs;
      let autoRestarted = false;
      let stateAfter = null;
      while (Date.now() < deadline) {
        const { stdout } = await execFileP("docker", ["inspect", "-f", "{{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}", targetInfo.id], { encoding: "utf8" });
        stateAfter = stdout.trim();
        if (stateAfter.startsWith("running")) {
          autoRestarted = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      receipt.auto_restart = autoRestarted;
      receipt.auto_restart_window_ms = restartWindowMs;
      receipt.state_after_kill_window = stateAfter;
      if (autoRestarted) {
        const { stdout: inspRaw } = await execFileP("docker", ["inspect", targetInfo.id], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
        const insp = JSON.parse(inspRaw)[0];
        receipt.restarted_started_at = insp.State.StartedAt;
        receipt.same_container_id_after_restart = insp.Id === targetInfo.id;
      } else {
        // Record honestly and bring the service back as part of recovery.
        const t0 = Date.now();
        await dockerExec(["start", targetInfo.id]);
        receipt.manual_start_after_no_autorestart_ms = Date.now() - t0;
        receipt.manual_start_at = new Date().toISOString();
      }
      return { autoRestarted, stateAfter };
    });
  } else {
    throw new Error(`unsupported action ${plan.action}`);
  }

  if (bystanders.length > 0) {
    await step("bystanders_post", async () => {
      receipt.bystanders_post = {};
      for (const svc of bystanders) receipt.bystanders_post[svc] = await resolveTarget(runId, svc);
      receipt.bystanders_unchanged = Object.fromEntries(
        bystanders.map((svc) => [
          svc,
          receipt.bystanders_pre[svc].id === receipt.bystanders_post[svc].id &&
            receipt.bystanders_pre[svc].startedAt === receipt.bystanders_post[svc].startedAt,
        ]),
      );
      return receipt.bystanders_unchanged;
    });
  }

  receipt.action = plan.action;
  receipt.completed_at = new Date().toISOString();
  state.terminal = { kind: "FAULT_APPLIED", receipt };
  writeFaultState(runId, state);
  return receipt;
}

/**
 * Resolve a fault that may have been interrupted mid-execution (harness
 * restart between FAULT_INTENT and the terminal event). Classifies APPLIED /
 * NOT_APPLIED / UNKNOWN from container identity + state + receipts.
 * NEVER executes or re-executes a fault.
 */
export async function resolveInterruptedFault(runId, { arm, trialId }) {
  const plan = FAULT_PLAN[arm];
  const state = readFaultState(runId);
  if (!state || state.trial_id !== trialId || state.arm !== arm) {
    return { classification: "NOT_APPLIED", reason: "no fault state for this run/trial" };
  }
  if (state.terminal?.kind === "FAULT_APPLIED") return { classification: "APPLIED", reason: "terminal FAULT_APPLIED receipt present", receipt: state.terminal.receipt };
  if (state.terminal?.kind === "FAULT_FAILED") return { classification: "FAILED", reason: state.terminal.reason, steps: state.steps };

  if (arm === "D0" || arm === "D5") {
    return { classification: "UNKNOWN", reason: "non-container arm interrupted without terminal receipt" };
  }

  const target = plan.target;
  try {
    const info = await resolveTarget(runId, target);
    // Compare StartedAt against the pre-fault recorded value.
    const pre = state.steps.find((s) => s.name === "pre_identity")?.result;
    if (pre?.startedAt && info.startedAt !== pre.startedAt) {
      return {
        classification: "APPLIED",
        reason: "container StartedAt changed after FAULT_INTENT (restart happened)",
        pre_started_at: pre.startedAt,
        now_started_at: info.startedAt,
      };
    }
    if (info.startedAt === pre?.startedAt) {
      return {
        classification: "NOT_APPLIED",
        reason: "container identity and StartedAt unchanged since pre-fault observation",
        container_id: info.id,
      };
    }
    return { classification: "UNKNOWN", reason: "StartedAt comparison inconclusive" };
  } catch (e) {
    return { classification: "UNKNOWN", reason: `identity/state probe failed: ${e.message}` };
  }
}

/**
 * Service recovery probe: poll the full chain (web → app → db) at
 * /api/ready until first success; return measured window.
 */
export async function probeRecovery(runId, { timeoutMs = 300000, pollMs = 500, sinceIso } = {}) {
  const p = runPaths(runId);
  const env = fs.readFileSync(p.envFile, "utf8");
  const port = Number(env.match(/^EXAM_PORT=(\d+)/m)[1]);
  const url = `http://127.0.0.1:${port}/api/ready`;
  const t0 = Date.now();
  let firstOkAt = null;
  const probes = [];
  for (;;) {
    const now = Date.now();
    if (now - t0 > timeoutMs) {
      return { recovered: false, url, window_ms: null, probes: probes.slice(-50), timeout_ms: timeoutMs };
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      const body = await res.text().catch(() => "");
      probes.push({ at: new Date().toISOString(), status: res.status, ms: Date.now() - now });
      if (res.ok && firstOkAt === null) {
        firstOkAt = now;
        return {
          recovered: true,
          url,
          window_ms: now - t0,
          first_ok_at: new Date(now).toISOString(),
          probe_count: probes.length,
          probes: probes.slice(-10),
          ready_body: body.slice(0, 200),
        };
      }
    } catch (e) {
      probes.push({ at: new Date().toISOString(), error: e.message.slice(0, 120) });
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
