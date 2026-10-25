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
import { COMPOSE_FILE, runProjectName, runPaths } from "./stack.mjs";

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
// comparability with #819. Kill arms only — a manually stopped container is
// never policy-restarted.
const AUTO_RESTART_WINDOW_MS = { D1: 30000, D2: 5000, D3: 30000, D4: 30000 };

// Experiment condition, not an SLA: how long the faulted state is observed
// via the F6 continuous probe before the operator recovery action. The
// dwell gives the probe a real window onto the outage (D3: app running but
// /api/ready not_ready; D1: static up, API 502; D5: everything absent).
const POST_ACTION_DWELL_MS = { D1: 10000, D3: 10000, D5: 15000 };

// Experiment condition, not an SLA (#817 D135 brief §7): how long D3 waits
// for the APP to reconnect on its own after `compose start db` before any
// operator intervention is allowed. An intervention in this window would
// mask the very behavior the arm studies.
export const D3_APP_AUTO_RECOVERY_WINDOW_MS = 60000;

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
 * Bystander identity for a non-target fault domain. A service that is not
 * deployed in this run (e.g. redis lives behind the opt-in `redis` compose
 * profile — its #585 production role) cannot be contaminated; record that
 * fact instead of failing the fault.
 */
async function resolveBystander(runId, svc) {
  try {
    return { deployed: true, ...(await resolveTarget(runId, svc)) };
  } catch (e) {
    return { deployed: false, note: e.message.slice(0, 160) };
  }
}

/** Image id + PGDATA bind-mount source for a container (D5 identity evidence). */
export async function containerDetails(id) {
  const { stdout } = await execFileP("docker", ["inspect", id], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const insp = JSON.parse(stdout)[0];
  const pgMount = (insp.Mounts ?? []).find((m) => m.Destination === "/var/lib/postgresql");
  return {
    image_id: insp.Image,
    image_ref: insp.Config?.Image ?? null,
    pgdata_mount_source: pgMount?.Source ?? pgMount?.source ?? null,
  };
}

/**
 * Survival check shell (F9 regression, D5-01): the postgres:18 Debian image
 * puts PGDATA at /var/lib/postgresql/<major>/docker and every file is owned
 * by the container's postgres uid — the host process can neither assume the
 * unversioned <pgdata>/PG_VERSION path nor stat inside at all. The check
 * therefore runs INSIDE a throwaway read-only container bind-mounting
 * EXACTLY this run's postgres dir, and searches by layout, not by a fixed
 * path.
 */
export function pgdataSurvivalShell() {
  return 'found=0; for f in $(find /pgdata -maxdepth 3 -name PG_VERSION 2>/dev/null); do echo "FOUND $f version=$(cat "$f")"; found=1; done; test "$found" = "1"';
}

/** Compose-scoped command for THIS run's project only. */
function composeCmd(runId, extra) {
  const p = runPaths(runId);
  return ["compose", "--env-file", p.envFile, "-f", COMPOSE_FILE, "-p", runProjectName(runId), ...extra];
}

/** Last N log lines of a container since an ISO timestamp (evidence). */
export async function captureServiceLogs(runId, service, sinceIso, { tail = 400 } = {}) {
  const containers = await (await import("./stack.mjs")).runContainers(runId);
  const id = containers[service]?.id;
  if (!id) return { service, since: sinceIso, log: "", note: "container not found" };
  const args = ["logs", "--timestamps", "--tail", String(tail)];
  if (sinceIso) args.push("--since", sinceIso);
  args.push(id);
  const { stdout } = await execFileP("docker", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30000,
  });
  return { service, container_id: id, since: sinceIso, log: stdout, lineCount: stdout.split("\n").filter(Boolean).length };
}

function saveServiceLogs(runId, trialId, tag, capture) {
  const p = runPaths(runId);
  fs.mkdirSync(p.evidenceDir, { recursive: true });
  const file = path.join(p.evidenceDir, `service-logs-${trialId}-${tag}.json`);
  fs.writeFileSync(file, JSON.stringify({ captured_at: new Date().toISOString(), ...capture }, null, 2));
  return path.basename(file);
}

function bystanderUnchanged(pre, post) {
  if (!pre.deployed && !post.deployed) return true; // not part of the run either time
  if (pre.deployed !== post.deployed) return false; // appeared/vanished across the fault
  return pre.id === post.id && pre.startedAt === post.startedAt;
}

/**
 * Execute one fault. Returns a receipt. Throws only on unexpected harness
 * errors; the receipt itself records command success/failure honestly.
 */
export async function executeFault(runId, { arm, trialId, autoRestartWindowMs, postActionDwellMs } = {}) {
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
        const t = await resolveTarget(runId, svc);
        receipt.pre[svc] = { ...t, ...(await containerDetails(t.id)) };
      }
      return receipt.pre;
    });
    await step("compose_down", async () => {
      const t0 = Date.now();
      const { stdout } = await execFileP("docker", composeCmd(runId, ["down"]), {
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
      });
      receipt.down_command = `docker compose -p ${runProjectName(runId)} down (this project only; no -v)`;
      receipt.down_output = stdout.slice(-2000);
      receipt.down_ms = Date.now() - t0;
      receipt.down_at = new Date().toISOString();
      receipt.fault_command_duration_ms = receipt.down_ms;
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
      // F9: host-side stat cannot reach the versioned, postgres-uid-owned
      // PGDATA (D5-01 failure). Verify from inside a throwaway read-only
      // container bind-mounting EXACTLY this run's postgres dir.
      const { stdout } = await execFileP(
        "docker",
        ["run", "--rm", "-v", `${p.pgdata}:/pgdata:ro`, "alpine:latest", "sh", "-c", pgdataSurvivalShell()],
        { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 },
      );
      return { pgdata: p.pgdata, findings: stdout.trim().split("\n").filter(Boolean) };
    });
    await step("observe_faulted_dwell", async () => {
      const dwell = postActionDwellMs ?? POST_ACTION_DWELL_MS[arm] ?? 0;
      receipt.post_action_dwell_ms = dwell;
      receipt.post_action_dwell_note =
        "experiment condition: the F6 probe samples the fully-torn-down state during this window; not an SLA";
      await new Promise((r) => setTimeout(r, dwell));
      receipt.dwell_completed_at = new Date().toISOString();
      return { dwell_ms: dwell };
    });
    await step("compose_up", async () => {
      const t0 = Date.now();
      const { stdout } = await execFileP("docker", composeCmd(runId, ["up", "-d"]), {
        encoding: "utf8",
        timeout: 180000,
        maxBuffer: 8 * 1024 * 1024,
      });
      receipt.up_command = `docker compose -p ${runProjectName(runId)} up -d (same PGDATA)`;
      receipt.up_output = stdout.slice(-2000);
      receipt.up_ms = Date.now() - t0;
      receipt.up_at = new Date().toISOString();
      return "stack started";
    });
    await step("wait_containers_running", async () => {
      // up -d returns when containers are created/started; web additionally
      // gates on app health. Identity resolution needs Running state, so
      // wait (bounded) instead of failing the identity gate spuriously.
      const deadline = Date.now() + 90000;
      let lastErr = null;
      for (;;) {
        try {
          for (const svc of ["app", "web", "db"]) await resolveTarget(runId, svc);
          return "all services running";
        } catch (e) {
          lastErr = e.message;
          if (Date.now() > deadline) throw new Error(`containers not running within 90s after up: ${lastErr}`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    });
    await step("post_identity", async () => {
      receipt.post = {};
      for (const svc of ["app", "web", "db"]) {
        const t = await resolveTarget(runId, svc);
        receipt.post[svc] = { ...t, ...(await containerDetails(t.id)) };
      }
      receipt.container_ids_changed = Object.fromEntries(
        Object.keys(receipt.post).map((svc) => [svc, receipt.pre[svc].id !== receipt.post[svc].id]),
      );
      // Container IDs changing is the EXPECTED down/up fact; what must hold
      // is the same image lineage and the same PGDATA mount source.
      receipt.pgdata_mount_source_same =
        receipt.pre.db.pgdata_mount_source != null &&
        receipt.pre.db.pgdata_mount_source === receipt.post.db.pgdata_mount_source;
      receipt.image_ids_same = Object.fromEntries(
        Object.keys(receipt.post).map((svc) => [svc, receipt.pre[svc].image_id === receipt.post[svc].image_id]),
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
      for (const svc of bystanders) receipt.bystanders_pre[svc] = await resolveBystander(runId, svc);
      return receipt.bystanders_pre;
    });
  }

  if (plan.action === "stop_start") {
    await step("graceful_stop", async () => {
      // Compose-scoped stop of THIS run's project only (brief §6/§7); the
      // container receives SIGTERM and compose honors the service's
      // stop_grace_period from the frozen compose file (app: 45s).
      const t0 = Date.now();
      const { stdout } = await execFileP("docker", composeCmd(runId, ["stop", target]), {
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
      });
      receipt.stop_command = `docker compose -p ${runProjectName(runId)} stop ${target}`;
      receipt.stop_output = stdout.trim();
      receipt.stop_ms = Date.now() - t0;
      receipt.stop_at = new Date().toISOString();
      receipt.fault_command_duration_ms = receipt.stop_ms;
      const { stdout: stRaw } = await execFileP(
        "docker",
        ["inspect", "-f", "{{.State.Status}} exit={{.State.ExitCode}} OOM={{.State.OOMKilled}}", targetInfo.id],
        { encoding: "utf8" },
      );
      receipt.post_stop_state = stRaw.trim();
      const exitMatch = receipt.post_stop_state.match(/exit=(\d+)/);
      receipt.post_stop_exit_code = exitMatch ? Number(exitMatch[1]) : null;
      // Escalation: exit 137 = the runtime SIGKILLed the container because
      // SIGTERM handling did not finish inside stop_grace_period. Such a
      // trial is GRACEFUL_STOP_ESCALATED — never reported as a pure
      // graceful-stop result.
      receipt.graceful_stop_escalated = receipt.post_stop_exit_code === 137;
      if (!receipt.post_stop_state.startsWith("exited")) {
        throw new Error(`container did not stop cleanly: ${receipt.post_stop_state}`);
      }
      // SIGTERM-handling evidence: the container's own log between its last
      // (pre-fault) start and the stop.
      const logs = await captureServiceLogs(runId, target, receipt.pre_started_at);
      receipt.shutdown_log_evidence = saveServiceLogs(runId, trialId, `${target}-post-stop`, logs);
      receipt.shutdown_log_lines = logs.lineCount;
      return receipt.post_stop_state;
    });
    await step("observe_faulted_dwell", async () => {
      const dwell = postActionDwellMs ?? POST_ACTION_DWELL_MS[arm] ?? 0;
      receipt.post_action_dwell_ms = dwell;
      receipt.post_action_dwell_note =
        "experiment condition: the F6 probe samples the faulted state during this window; not an SLA";
      await new Promise((r) => setTimeout(r, dwell));
      receipt.dwell_completed_at = new Date().toISOString();
      return { dwell_ms: dwell };
    });
    await step("manual_restart", async () => {
      // restart: unless-stopped does NOT restart a manually stopped container —
      // the harness performs the operator's start, recorded as its own step.
      const t0 = Date.now();
      const { stdout } = await execFileP("docker", composeCmd(runId, ["start", target]), {
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
      });
      receipt.start_command = `docker compose -p ${runProjectName(runId)} start ${target}`;
      receipt.start_output = stdout.trim();
      receipt.start_ms = Date.now() - t0;
      receipt.start_at = new Date().toISOString();
      return "started";
    });
    await step("post_start_identity", async () => {
      const post = await resolveTarget(runId, target);
      receipt.post_restart = {
        id: post.id,
        startedAt: post.startedAt,
        // docker start reuses the existing container: the ID must be the
        // same; StartedAt necessarily moves.
        same_container_id: post.id === targetInfo.id,
      };
      return receipt.post_restart;
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
      for (const svc of bystanders) receipt.bystanders_post[svc] = await resolveBystander(runId, svc);
      receipt.bystanders_unchanged = Object.fromEntries(
        bystanders.map((svc) => [
          svc,
          bystanderUnchanged(receipt.bystanders_pre[svc], receipt.bystanders_post[svc]),
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

/** Operator recovery primitive: compose-scoped start of one service. */
export async function composeStartService(runId, service) {
  const t0 = Date.now();
  const { stdout } = await execFileP("docker", composeCmd(runId, ["start", service]), {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { output: stdout.trim(), ms: Date.now() - t0, at: new Date().toISOString() };
}

async function inspectAnyState(runId, service) {
  const project = runProjectName(runId);
  const { stdout } = await execFileP(
    "docker",
    ["ps", "-a", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}\t{{.Names}}\t{{.Labels}}\t{{.State}}"],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  ).catch(() => ({ stdout: "" }));
  for (const line of stdout.split("\n").filter(Boolean)) {
    const [id, name, labels, state] = line.split("\t");
    if ((labels ?? "").split(",").includes(`com.docker.compose.service=${service}`)) {
      return { id, name, status: state };
    }
  }
  return null;
}

/**
 * Resolve a fault that may have been interrupted mid-execution (harness
 * restart between FAULT_INTENT and the terminal event). Classifies from the
 * persisted step journal + container reality:
 *   APPLIED                — fault fired AND recovery completed (container running)
 *   APPLIED_NOT_RECOVERED  — fault demonstrably fired, target left stopped;
 *                            the resume path performs the operator start
 *   NOT_APPLIED            — no mutating step began; checkpoint stays valid
 *   UNKNOWN                — unresolvable; never re-executes anything
 */
export async function resolveInterruptedFault(runId, { arm, trialId }) {
  const plan = FAULT_PLAN[arm];
  const state = readFaultState(runId);
  if (!state || state.trial_id !== trialId || state.arm !== arm) {
    return { classification: "NOT_APPLIED", reason: "no fault state for this run/trial" };
  }
  if (state.terminal?.kind === "FAULT_APPLIED") return { classification: "APPLIED", reason: "terminal FAULT_APPLIED receipt present", receipt: state.terminal.receipt };
  if (state.terminal?.kind === "FAULT_FAILED") return { classification: "FAILED", reason: state.terminal.reason, steps: state.steps };

  const mutating = (state.steps ?? []).find((s) => ["sigkill", "graceful_stop", "compose_down"].includes(s.name));
  if (!mutating) {
    return { classification: "NOT_APPLIED", reason: "FAULT_INTENT present but no mutating step began — container untouched" };
  }
  if (arm === "D5") {
    return {
      classification: "UNKNOWN",
      reason: "D5 interrupted mid down/up without a terminal receipt — stack state partially mutated; operator adjudication required (never re-down/re-up blindly)",
      journal_step: mutating.name,
    };
  }
  const target = plan.target;
  try {
    const info = await resolveTarget(runId, target);
    const pre = (state.steps ?? []).find((s) => s.name === "pre_identity")?.result;
    if (pre?.startedAt && info.startedAt !== pre.startedAt) {
      return {
        classification: "APPLIED",
        reason: "target running with changed StartedAt — fault fired and the container restarted (recovery completed)",
        pre_started_at: pre.startedAt,
        now_started_at: info.startedAt,
      };
    }
    return { classification: "UNKNOWN", reason: "target running with unchanged StartedAt despite a mutating journal step — inconclusive" };
  } catch {
    const anyState = await inspectAnyState(runId, target);
    if (anyState?.status === "exited") {
      return {
        classification: "APPLIED_NOT_RECOVERED",
        reason: "target container exists but is stopped — fault fired, recovery not performed",
        container_id: anyState.id,
        journal_step: mutating.name,
      };
    }
    return { classification: "UNKNOWN", reason: `target container state unresolvable: ${anyState ? `status=${anyState.status}` : "not found"}` };
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
