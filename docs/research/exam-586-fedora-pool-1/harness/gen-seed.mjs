#!/usr/bin/env node
/**
 * EXAM-586 RESEARCH ONLY fixture generator (host-side, plain node).
 *
 * Emits candidates.json (driver manifest) + candidates.sql (bulk INSERT run
 * through `docker compose exec -T db psql`; PostgreSQL is never published).
 * Fixtures mirror the #550 seeding law: users + candidate_profiles +
 * user_role_assignments (isPrimary — zero-primary identities cannot
 * authenticate) + exam_enrollments(assigned). One shared argon2id hash for
 * the experiment-only password (no real credentials, §21).
 *
 * Usage: gen-seed.mjs <runDir> <orgId> <examId> <warmupExamId> <N>
 */
import { randomUUID } from "node:crypto";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validateUuid = (s) => UUID_RE.test(s);
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [runDir, orgId, examId, warmupExamId, nArg] = process.argv.slice(2);
const N = Number(nArg);
if (!runDir || !orgId || !examId || !warmupExamId || !N) {
  console.error(
    "usage: gen-seed.mjs <runDir> <orgId> <examId> <warmupExamId> <N>",
  );
  process.exit(2);
}
for (const id of [orgId, examId, warmupExamId]) {
  if (!validateUuid(id)) {
    console.error(`not a uuid: ${id}`);
    process.exit(2);
  }
}

/** Shared argon2id hash of the experiment-only password "pass-586-cap". */
const PASSWORD_HASH = process.env.EXAM586_PASSWORD_HASH ?? "";
if (!PASSWORD_HASH.startsWith("$argon2")) {
  console.error("EXAM586_PASSWORD_HASH missing (must be an argon2id hash)");
  process.exit(2);
}

const stamp = Date.now();
const mk = () => {
  const id = randomUUID();
  return {
    id,
    userId: randomUUID(),
    username:
      `586S${N}c${String(0).padStart(0, "")}${id.slice(0, 6)}-${stamp}`.slice(
        0,
        50,
      ),
  };
};

// Measured candidates: usernames ≤ 50 chars (contract max), unique per run.
const candidates = Array.from({ length: N }, (_, i) => {
  const id = randomUUID();
  return {
    i,
    id,
    userId: randomUUID(),
    enrollmentId: randomUUID(),
    username:
      `586c${String(i).padStart(4, "0")}${id.slice(0, 8)}t${stamp}`.slice(
        0,
        50,
      ),
    password: "pass-586-cap",
    // Driver binds this candidate's sockets to this exam-net secondary IP.
    ip: `172.31.10.${i + 2}`,
  };
});
const warmupId = randomUUID();
const warmup = {
  id: warmupId,
  userId: randomUUID(),
  enrollmentId: randomUUID(),
  username: `586warm${warmupId.slice(0, 8)}t${stamp}`.slice(0, 50),
  password: "pass-586-cap",
};

const q = (s) => `'${s.replaceAll("'", "''")}'`;
const nowIso = new Date().toISOString();

function rows(entity) {
  const all = [...candidates, warmup];
  switch (entity) {
    case "users":
      return all.map(
        (c) =>
          `(${q(c.userId)}, ${q(orgId)}, ${q(c.username)}, ${q(PASSWORD_HASH)}, ${q("Candidate " + c.id.slice(0, 12))}, 'Candidate', true, '${nowIso}', '${nowIso}')`,
      );
    case "profiles":
      return all.map(
        (c) =>
          `(${q(c.id)}, ${q(orgId)}, ${q(c.userId)}, '{}', '${nowIso}', '${nowIso}')`,
      );
    case "roles":
      return all.map(
        (c) =>
          `(${q(randomUUID())}, ${q(orgId)}, ${q(c.userId)}, 'Candidate', true, true, '${nowIso}', '${nowIso}')`,
      );
    case "enrollments": {
      const main = candidates.map(
        (c) =>
          `(${q(c.enrollmentId)}, ${q(orgId)}, ${q(examId)}, ${q(c.id)}, 'assigned', 0, '${nowIso}', '${nowIso}')`,
      );
      const warm = `(${q(warmup.enrollmentId)}, ${q(orgId)}, ${q(warmupExamId)}, ${q(warmup.id)}, 'assigned', 0, '${nowIso}', '${nowIso}')`;
      return [...main, warm];
    }
  }
}

const sql = `
BEGIN;
INSERT INTO users (id, organization_id, username, password_hash, name, role, is_active, created_at, updated_at) VALUES
  ${rows("users").join(",\n  ")};
INSERT INTO candidate_profiles (id, organization_id, user_id, fields, created_at, updated_at) VALUES
  ${rows("profiles").join(",\n  ")};
INSERT INTO user_role_assignments (id, organization_id, user_id, role, is_primary, is_active, created_at, updated_at) VALUES
  ${rows("roles").join(",\n  ")};
INSERT INTO exam_enrollments (id, organization_id, exam_id, candidate_id, status, attempt_count, created_at, updated_at) VALUES
  ${rows("enrollments").join(",\n  ")};
COMMIT;
`;

writeFileSync(
  join(runDir, "candidates.json"),
  JSON.stringify(
    {
      candidates: candidates.map((c) => ({
        i: c.i,
        username: c.username,
        password: c.password,
        ip: c.ip,
        candidateId: c.id,
      })),
      warmup: { username: warmup.username, password: warmup.password },
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(join(runDir, "candidates.sql"), sql);
console.log(`GEN_SEED_OK candidates=${candidates.length}+warmup`);
