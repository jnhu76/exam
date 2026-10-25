#!/usr/bin/env node
// Exam #817 — isolated Docker deployment control (R1).
//
// Owns: run-scoped identity checks (FAIL CLOSED on any conflict), env-file
// generation, compose lifecycle for the REAL production service graph
// (docker-compose.yml, no topology overrides), health waits, and identity
// evidence capture. PGDATA must live on the WSL Linux filesystem — never
// under /mnt/c (DrvFs).
//
// Identity gates (all verified before any operation that touches containers):
//   - compose project label com.docker.compose.project == this run's project
//   - container ID recorded at first observation of this run
//   - PGDATA bind-mount source == this run's data root
// Fault targeting uses project label + container ID together (never service
// name alone).

import { execFileSync, execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { atomicWriteJson } from "./mailbox.mjs";

const execFileP = promisify(execFile);

export const BASE_SHA = "1bd86027650edb083b315ea1eed73308968ef932";
export const APP_IMAGE = "exam817-e817:app";
export const WEB_IMAGE = "exam817-e817:web";
export const COMPOSE_FILE = "/home/hoo/Source/exam-817-harness/docker-compose.yml";

export function runProjectName(runId) {
  return `exam817-${runId}`;
}

export function runPaths(runId) {
  const root = `/home/hoo/exam817-runs/${runId}`;
  return {
    root,
    dataRoot: path.join(root, "data"),
    pgdata: path.join(root, "data", "postgres"),
    deployDir: path.join(root, "deploy"),
    envFile: path.join(root, "deploy", "env.production"),
    evidenceDir: path.join(root, "evidence"),
  };
}

function sh(cmd, args, opts = {}) {
  return execFileP(cmd, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...opts });
}

function shOut(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

// ── Identity pre-checks ───────────────────────────────────────────

export async function checkPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "0.0.0.0");
  });
}

export async function preflight(runId, port, subnet) {
  const problems = [];
  const p = runPaths(runId);
  const project = runProjectName(runId);

  // 1. No existing compose project with this name (or any exam817- project).
  const psOut = await sh("docker", ["compose", "ls", "--format", "json"])
    .then((r) => r.stdout)
    .catch(() => "[]");
  const projList = (() => {
    const t = (psOut || "[]").trim();
    if (t.startsWith("[")) return JSON.parse(t);
    return t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  })();
  for (const proj of projList) {
    if (proj.Name === project) problems.push(`compose project '${project}' already exists`);
    if (proj.Name?.startsWith("exam817-") && proj.Name !== project) {
      // A sibling research stack is running: refuse to share the host's
      // Docker state with an experiment that may kill containers.
      problems.push(`another exam817 research project '${proj.Name}' is active`);
    }
  }

  // 2. Port must be free.
  if (!(await checkPortFree(port))) problems.push(`host port ${port} is in use`);

  // 3. Subnet must not collide with existing docker networks or host routes.
  const nets = await sh("docker", ["network", "ls", "--format", "{{.Name}}"])
    .then((r) => r.stdout)
    .catch(() => "");
  for (const n of nets.split("\n").filter(Boolean)) {
    const inspect = await sh("docker", ["network", "inspect", n, "--format", "{{json .IPAM.Config}}"])
      .then((r) => r.stdout)
      .catch(() => "");
    if (inspect.includes(subnet)) problems.push(`docker network '${n}' already uses subnet ${subnet}`);
  }
  const hostAddrs = await sh("ip", ["-4", "-o", "addr", "show"])
    .then((r) => r.stdout)
    .catch(() => "");
  const hostIps = new Set(hostAddrs.match(/inet (\d+\.\d+\.\d+\.\d+)/g)?.map((s) => s.slice(5)) ?? []);
  const subnetBase = subnet.split(".").slice(0, 2).join(".");
  for (const ip of hostIps) {
    if (ip.startsWith(`${subnetBase}.`)) {
      problems.push(`host address ${ip} overlaps exam-net subnet base ${subnetBase}.x`);
    }
  }

  // 4. PGDATA root must be free and on the Linux filesystem.
  if (fs.existsSync(p.pgdata) && fs.readdirSync(p.pgdata).length > 0) {
    problems.push(`PGDATA ${p.pgdata} already exists and is non-empty`);
  }
  if (p.root.startsWith("/mnt/")) problems.push(`run root ${p.root} is on a DrvFs mount (forbidden for PGDATA)`);

  // 5. Images must exist locally (built from frozen SHA).
  for (const img of [APP_IMAGE, WEB_IMAGE]) {
    try {
      shOut("docker", ["image", "inspect", img, "--format", "{{.Id}}"]);
    } catch {
      problems.push(`image ${img} not present locally`);
    }
  }

  // 6. Compose file must exist at the frozen SHA's worktree.
  if (!fs.existsSync(COMPOSE_FILE)) problems.push(`compose file missing: ${COMPOSE_FILE}`);

  return { ok: problems.length === 0, problems, project, paths: p };
}

// ── Env file ──────────────────────────────────────────────────────

export function generateEnvFile(runId, port, subnet, examUrlHost) {
  const p = runPaths(runId);
  fs.mkdirSync(p.deployDir, { recursive: true });
  const origin = `http://${examUrlHost}:${port}`;
  const env = [
    `# Exam #817 research run ${runId} — run-scoped deployment env (generated).`,
    `# Frozen source SHA: ${BASE_SHA}`,
    `EXAM_IMAGE=${APP_IMAGE}`,
    `EXAM_WEB_IMAGE=${WEB_IMAGE}`,
    `EXAM_PORT=${port}`,
    `EXAM_DATA_ROOT=${p.dataRoot}`,
    `EXAM_DOCKER_SUBNET=${subnet}`,
    `POSTGRES_USER=exam`,
    `POSTGRES_DB=exam`,
    `POSTGRES_PASSWORD=e817pg-${randomBytes(16).toString("hex")}`,
    `JWT_SECRET=e817jwt-${randomBytes(32).toString("hex")}`,
    `LAUNCHPAD_SETUP_TOKEN=e817lp-${randomBytes(24).toString("hex")}`,
    `CORS_ORIGIN=${origin}`,
    `PUBLIC_WEB_ORIGIN=${origin}`,
    `EXAM_HOST_ALIAS=${examUrlHost}`,
    `DEPLOYMENT_MODE=singleTenant`,
    `EMAIL_ENABLED=false`,
    `TZ=Asia/Shanghai`,
    `APP_TIMEZONE=Asia/Shanghai`,
    ``,
  ].join("\n");
  fs.writeFileSync(p.envFile, env, { mode: 0o600 });
  return { envFile: p.envFile, origin, launchpadToken: env.match(/LAUNCHPAD_SETUP_TOKEN=(.*)/)[1] };
}

// ── Compose lifecycle ─────────────────────────────────────────────

function composeArgs(runId, extra = []) {
  const p = runPaths(runId);
  return ["compose", "--env-file", p.envFile, "-f", COMPOSE_FILE, "-p", runProjectName(runId), ...extra];
}

export async function composeUp(runId) {
  const args = composeArgs(runId, ["up", "-d"]);
  const { stdout } = await sh("docker", args);
  return stdout;
}

export async function composePs(runId) {
  const { stdout } = await sh("docker", composeArgs(runId, ["ps", "--format", "json"])).catch(() => ({ stdout: "[]" }));
  const lines = stdout.trim().split("\n").filter(Boolean);
  try {
    return JSON.parse(`[${lines.join(",")}]`);
  } catch {
    // Docker compose versions emit one JSON object per line.
    return lines.map((l) => JSON.parse(l));
  }
}

export async function inspectContainer(containerId) {
  const { stdout } = await sh("docker", ["inspect", containerId]);
  return JSON.parse(stdout)[0];
}

/** Containers belonging to this run's compose project, keyed by service. */
export async function runContainers(runId) {
  const list = await composePs(runId);
  const out = {};
  for (const c of list) {
    const id = c.ID || c.Id;
    if (!id) continue;
    const insp = await inspectContainer(id);
    const labels = insp.Config?.Labels ?? {};
    if (labels["com.docker.compose.project"] !== runProjectName(runId)) {
      throw new Error(`container ${id} is not labeled for project ${runProjectName(runId)} — identity gate refused`);
    }
    out[labels["com.docker.compose.service"]] = {
      id,
      name: insp.Name,
      image: insp.Config?.Image,
      state: insp.State?.Status,
      startedAt: insp.State?.StartedAt,
      restartCount: insp.RestartCount,
      labels,
    };
  }
  return out;
}

export async function waitForHealthy(runId, { timeoutMs = 180000, pollMs = 1000 } = {}) {
  const p = runPaths(runId);
  const env = fs.readFileSync(p.envFile, "utf8");
  const port = Number(env.match(/^EXAM_PORT=(\d+)/m)[1]);
  const origin = `http://127.0.0.1:${port}`;
  const start = Date.now();
  let lastErr = null;
  for (;;) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`stack did not become healthy within ${timeoutMs}ms: ${lastErr}`);
    }
    try {
      const res = await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        return { healthy: true, waitedMs: Date.now() - start, origin };
      }
      lastErr = `status ${res.status}`;
    } catch (e) {
      lastErr = e.message;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// ── Evidence ──────────────────────────────────────────────────────

export async function captureDeploymentEvidence(runId) {
  const p = runPaths(runId);
  fs.mkdirSync(p.evidenceDir, { recursive: true });
  const containers = await runContainers(runId);
  const evidence = {
    captured_at: new Date().toISOString(),
    source_sha: BASE_SHA,
    project: runProjectName(runId),
    compose_file: COMPOSE_FILE,
    containers,
    images: {},
    pgdata_mount: null,
    filesystem: null,
    subnet: null,
  };
  for (const [svc, c] of Object.entries(containers)) {
    const insp = await inspectContainer(c.id);
    evidence.images[svc] = {
      image_ref: insp.Config?.Image,
      image_id: insp.Image,
    };
    if (svc === "db") {
      const mount = insp.Mounts?.find((m) => m.Destination === "/var/lib/postgresql");
      evidence.pgdata_mount = mount
        ? { type: mount.Type, source: mount.Source, destination: mount.Destination, mode: mount.Mode }
        : null;
    }
  }
  try {
    evidence.filesystem = shOut("stat", ["-f", "-c", "%T", p.dataRoot]);
  } catch (e) {
    evidence.filesystem = `stat failed: ${e.message}`;
  }
  try {
    evidence.subnet = shOut(
      "docker",
      ["network", "inspect", `${runProjectName(runId)}_exam-net`, "--format", "{{json .IPAM.Config}}"],
    );
  } catch {
    evidence.subnet = null;
  }
  const imgDigests = {};
  for (const [svc, ref] of Object.entries({ app: APP_IMAGE, web: WEB_IMAGE })) {
    try {
      imgDigests[svc] = JSON.parse(shOut("docker", ["image", "inspect", ref, "--format", "{{json .RepoDigests}}"]));
    } catch {
      imgDigests[svc] = [];
    }
  }
  evidence.image_repo_digests = imgDigests;
  atomicWriteJson(path.join(p.evidenceDir, "deployment-identity.json"), evidence);
  return evidence;
}

export async function snapshotAllContainers() {
  const { stdout } = await sh("docker", ["ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Labels}}"]).catch(
    () => ({ stdout: "" }),
  );
  return stdout.split("\n").filter(Boolean);
}
