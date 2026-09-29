#!/usr/bin/env node
/**
 * EXAM-586 RESEARCH ONLY correctness oracles (protocol §30) — host-side.
 *
 * Reads PostgreSQL truth through `docker compose exec -T db psql` (the
 * database is never published) and verifies the run's durable state.
 * Usage: oracles.mjs <runDir>
 *
 * Exit 0 + correctness.json {pass:true} when every oracle holds; exit 1 with
 * findings when any fails (the performance result is then DISQUALIFIED, §30).
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validate as validateUuid } from "node:crypto";

const RUN_DIR = process.argv[2];
if (!RUN_DIR) {
  console.error("usage: oracles.mjs <runDir>");
  process.exit(2);
}
const COMPOSE_ARGS = process.env.COMPOSE_ARGS ?? "";
const N = Number(process.env.N);
if (!N) {
  console.error("N env required");
  process.exit(2);
}

const exams = JSON.parse(readFileSync(join(RUN_DIR, "exams.json"), "utf8"));
const manifest = JSON.parse(
  readFileSync(join(RUN_DIR, "candidates.json"), "utf8"),
);
const orgId = JSON.parse(readFileSync(join(RUN_DIR, "org.json"), "utf8")).orgId;
const examId = exams.examId;
for (const id of [examId, orgId]) {
  if (!validateUuid(id)) {
    console.error(`not a uuid: ${id}`);
    process.exit(2);
  }
}

/** Runs one SQL statement, returns TSV rows (first field = col name when header). */
function psqlRows(sql) {
  const out = execSync(
    `docker compose -p exam-586 ${COMPOSE_ARGS} exec -T db psql -U exam -d exam -At -F '|' -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`,
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.split("|"));
}

const findings = [];

// ── Deterministic expected scores (03-method.md workload) ──
// Candidate i: answer(i,q) = ((i+q) mod 2 === 0); standard(q) = (q mod 2 === 0).
const questionIds = exams.questionIds;
const expectedScoreOf = (i) => {
  let correct = 0;
  for (let q = 0; q < questionIds.length; q++) {
    if (((i + q) % 2 === 0) === (q % 2 === 0)) correct += 1;
  }
  return correct * 10;
};
const expectedAnswerOf = (i, qid) => (i + questionIds.indexOf(qid)) % 2 === 0;

// ── 1. Attempt status counts: exactly N graded ──
const statusRows = psqlRows(
  `SELECT status::text, count(*)::int FROM exam_attempts WHERE exam_id = '${examId}' GROUP BY status`,
);
const statusCounts = Object.fromEntries(
  statusRows.map((r) => [r[0], Number(r[1])]),
);
if ((statusCounts["graded"] ?? 0) !== N) {
  findings.push(`status counts not N graded: ${JSON.stringify(statusCounts)}`);
}

// ── 2. No duplicate active attempts per candidate ──
const dupActive = Number(
  psqlRows(
    `SELECT count(*)::int FROM (
       SELECT candidate_id FROM exam_attempts
       WHERE exam_id = '${examId}' AND status = 'in_progress'
       GROUP BY candidate_id HAVING count(*) > 1) d`,
  )[0][0],
);
if (dupActive !== 0) findings.push(`duplicate active attempts: ${dupActive}`);

// ── 3. No duplicate terminal transitions per (candidate, attemptNo) ──
const dupTerminal = Number(
  psqlRows(
    `SELECT count(*)::int FROM (
       SELECT candidate_id, attempt_no FROM exam_attempts
       WHERE exam_id = '${examId}' AND status IN ('submitted', 'graded', 'auto_submitted')
       GROUP BY candidate_id, attempt_no HAVING count(*) > 1) d`,
  )[0][0],
);
if (dupTerminal !== 0)
  findings.push(`duplicate terminal transitions: ${dupTerminal}`);

// ── 4. Per-candidate identity mapping + score + answers ──
// exam_enrollments pins candidateId ↔ userId; attempts must map 1:1 onto the
// seeded candidates with the deterministic score and answer content.
const attRows = psqlRows(
  `SELECT a.id::text, e.candidate_id::text, a.score::text,
          COALESCE(a.answers::text, '[]')
   FROM exam_attempts a
   JOIN exam_enrollments e ON e.candidate_id = a.candidate_id AND e.exam_id = a.exam_id
   WHERE a.exam_id = '${examId}'`,
);
const byCandidate = new Map(manifest.candidates.map((c) => [c.candidateId, c]));
const seenCandidates = new Set();
for (const [attemptId, candidateId, score, answersJson] of attRows) {
  const c = byCandidate.get(candidateId);
  if (!c) {
    findings.push(
      `attempt ${attemptId.slice(0, 8)} belongs to unknown candidate ${candidateId.slice(0, 8)}`,
    );
    continue;
  }
  if (seenCandidates.has(candidateId)) {
    findings.push(`candidate ${c.username} has more than one attempt row`);
  }
  seenCandidates.add(candidateId);
  const expected = expectedScoreOf(c.i);
  if (Number(score) !== expected) {
    findings.push(`${c.username}: score ${score} != expected ${expected}`);
  }
  let answers;
  try {
    answers =
      typeof answersJson === "string" ? JSON.parse(answersJson) : answersJson;
  } catch {
    findings.push(`${c.username}: answers unreadable`);
    continue;
  }
  if (!Array.isArray(answers) || answers.length !== questionIds.length) {
    findings.push(
      `${c.username}: ${Array.isArray(answers) ? answers.length : "non-array"} answers != ${questionIds.length}`,
    );
    continue;
  }
  for (const a of answers) {
    const qid = a.questionId;
    if (!questionIds.includes(qid)) {
      findings.push(
        `${c.username}: unknown question ${String(qid).slice(0, 8)}`,
      );
      continue;
    }
    if (a.answer !== expectedAnswerOf(c.i, qid)) {
      findings.push(`${c.username}: answer mismatch on ${qid.slice(0, 8)}`);
    }
  }
}
if (seenCandidates.size !== N) {
  findings.push(
    `attempts found for ${seenCandidates.size}/${N} seeded candidates`,
  );
}

// ── 5. Identity non-collapse: distinct login audit IPs ≥ N ──
const ipRows = psqlRows(
  `SELECT ip_address::text, count(*)::int FROM audit_logs
   WHERE organization_id = '${orgId}' AND action LIKE '%login%' AND ip_address IS NOT NULL
   GROUP BY ip_address`,
);
const distinctIps = ipRows.length;
const candidateIpCount = ipRows.filter(([ip]) =>
  ip.startsWith("172.31.10."),
).length;
if (candidateIpCount < N) {
  findings.push(
    `identity collapse: ${candidateIpCount} distinct candidate source IPs < ${N} (all audit IPs: ${distinctIps})`,
  );
}

const result = {
  run: process.env.RUN_ID ?? RUN_DIR,
  statusCounts,
  attemptsChecked: attRows.length,
  dupActive,
  dupTerminal,
  distinctAuditIps: distinctIps,
  distinctCandidateIps: candidateIpCount,
  findings: findings.slice(0, 20),
  pass: findings.length === 0,
  finished_at: new Date().toISOString(),
};
writeFileSync(
  join(RUN_DIR, "correctness.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  `ORACLE ${JSON.stringify({ pass: result.pass, findings: result.findings.length })}`,
);
process.exit(result.pass ? 0 : 1);
