import { readFile } from "node:fs/promises";

const ACTIVE_CONTAINER_FILES = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.dev.yml",
  ".github/workflows/ci.yml",
  "scripts/e2e/run.sh",
];

const violations = [];

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

if (violations.length > 0) {
  process.stderr.write(`Container runtime violations:\n${violations.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Container runtime checks passed (no active Alpine/musl image references).\n");
