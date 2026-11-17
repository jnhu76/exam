import { readFile } from "node:fs/promises";

const ACTIVE_CONTAINER_FILES = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.dev.yml",
  ".github/workflows/ci.yml",
  "scripts/e2e/run.sh",
];

const NODE_WORKFLOWS = [
  ".github/workflows/ci.yml",
  ".github/workflows/commit-messages.yml",
];

const violations = [];
const nodeVersion = (await readFile(".nvmrc", "utf8")).trim();

if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) {
  violations.push(
    `.nvmrc: NODE_RUNTIME_VERSION_INVALID — expected an exact semver patch version, got "${nodeVersion}"`,
  );
}

for (const path of ACTIVE_CONTAINER_FILES) {
  const text = await readFile(path, "utf8");
  for (const [index, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/\balpine(?:[0-9.-]*)?\b/i.test(line)) {
      violations.push(
        `${path}:${index + 1}: CONTAINER_RUNTIME_ALPINE_FORBIDDEN — active container/runtime configuration must use a Debian/glibc image, not Alpine/musl`,
      );
    }
  }
}

const dockerfile = await readFile("Dockerfile", "utf8");
const expectedNodeBase = `FROM node:${nodeVersion}-bookworm-slim AS base`;
if (!dockerfile.includes(expectedNodeBase)) {
  violations.push(
    `Dockerfile: NODE_RUNTIME_VERSION_DRIFT — production Node base must match .nvmrc exactly (${expectedNodeBase})`,
  );
}

for (const path of NODE_WORKFLOWS) {
  const text = await readFile(path, "utf8");
  if (!text.includes('node-version-file: ".nvmrc"')) {
    violations.push(
      `${path}: NODE_RUNTIME_VERSION_DRIFT — actions/setup-node must consume .nvmrc instead of a floating or duplicated version`,
    );
  }
  if (/node-version:\s*["']?\d/.test(text)) {
    violations.push(
      `${path}: NODE_RUNTIME_FLOATING_VERSION_FORBIDDEN — use node-version-file: ".nvmrc"`,
    );
  }
}

if (violations.length > 0) {
  process.stderr.write(`Container runtime violations:\n${violations.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(
  `Container runtime checks passed (glibc images; Node ${nodeVersion} pinned via .nvmrc).\n`,
);
