#!/usr/bin/env node
// Exam #817 — exam data preparation over the REAL product API (R1).
//
// Creates, through existing product flows only (no direct DB writes):
//   Admin (launchpad bootstrap) → course → 10 questions (5 types) →
//   candidate → exam → enrollment → publish → deterministic Answer Manifest.
//
// The manifest is the single authority for what the candidate browser must
// enter; every value is derived from run_id + trial_id + question_id +
// generation so no random text replaces business-valid answers.

import fs from "node:fs";
import path from "node:path";

export class ApiClient {
  constructor(origin) {
    this.origin = origin;
    this.cookie = null;
  }

  async req(method, apiPath, body) {
    const headers = {
      "content-type": "application/json",
      origin: this.origin,
      accept: "application/json",
    };
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(`${this.origin}${apiPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const pair = c.split(";")[0];
      if (pair.startsWith("auth-token=")) this.cookie = pair;
    }
    let json = null;
    const text = await res.text();
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text.slice(0, 500) };
      }
    }
    return { status: res.status, ok: res.ok, json };
  }

  async must(method, apiPath, body, expect = [200, 201]) {
    const res = await this.req(method, apiPath, body);
    if (!expect.includes(res.status)) {
      throw new Error(`${method} ${apiPath} → ${res.status}: ${JSON.stringify(res.json).slice(0, 400)}`);
    }
    return res.json;
  }

  async login(username, password) {
    // Login replaces the cookie jar.
    this.cookie = null;
    return this.must("POST", "/api/auth/login", { username, password });
  }
}

// ── Question fixture design ───────────────────────────────────────
//
// 10 questions across all five supported types. Deterministic answers:
//   - choice/true_false: fixed option picks (discrete; uniqueness across
//     generations comes from the version + chosen option).
//   - fill_blank / text_response: free text carrying the full marker
//     `${runId}|${trialId}|q<order>|g<generation>` plus fixed prose, so PG
//     content comparison is marker-exact.
// Question 10 embeds a CRLF pair inside the answer text — the real PG row
// then exercises the same CRLF preservation semantics the mailbox was
// R0-tested for.

export function buildQuestionSpecs(markerFor) {
  return [
    {
      order: 1,
      type: "true_false",
      content: "#817-TF-1：容器化部署的 PostgreSQL 数据库在容器被强杀后，通过 WAL 日志可以恢复已提交事务。（正确答“对”）",
      standardAnswer: true,
      score: 10,
      gen1: true,
      gen2: false, // second-generation edit switches the answer
    },
    {
      order: 2,
      type: "single_choice",
      content: "#817-SC-2：下列哪一项是本实验观察的权威持久化位置？",
      options: [
        { id: "A", content: "浏览器内存（React state）" },
        { id: "B", content: "exam_attempts.answers（PostgreSQL）" },
        { id: "C", content: "IndexedDB" },
        { id: "D", content: "localStorage" },
      ],
      standardAnswer: "B",
      score: 10,
      gen1: "A",
      gen2: "C",
    },
    {
      order: 3,
      type: "single_choice",
      content: "#817-SC-3：保存答案接口返回 accepted:true 时，客户端还应校验哪个字段？",
      options: [
        { id: "A", content: "message" },
        { id: "B", content: "serverVersion" },
        { id: "C", content: "HTTP 状态码即可" },
        { id: "D", content: "savedAt" },
      ],
      standardAnswer: "B",
      score: 10,
      gen1: "B",
      gen2: null, // single generation
    },
    {
      order: 4,
      type: "single_choice",
      content: "#817-SC-4：docker compose down 会删除绑定挂载（bind mount）中的 PostgreSQL 数据吗？",
      options: [
        { id: "A", content: "会删除" },
        { id: "B", content: "不会删除" },
        { id: "C", content: "取决于 restart 策略" },
        { id: "D", content: "取决于镜像版本" },
      ],
      standardAnswer: "B",
      score: 10,
      gen1: "B",
      gen2: null,
    },
    {
      order: 5,
      type: "multiple_choice",
      content: "#817-MC-5：以下哪些属于 PostgreSQL 可靠性相关设置？（多选：fsync、synchronous_commit）",
      options: [
        { id: "A", content: "fsync" },
        { id: "B", content: "synchronous_commit" },
        { id: "C", content: "nginx worker 数" },
        { id: "D", content: "浏览器缓存" },
      ],
      standardAnswer: ["A", "B"],
      score: 10,
      gen1: ["A"],
      gen2: ["A", "B"],
    },
    {
      order: 6,
      type: "multiple_choice",
      content: "#817-MC-6：本实验中事件跨系统顺序必须依据什么建立？（多选：事件确认、单调 seq）",
      options: [
        { id: "A", content: "事件确认（ack）" },
        { id: "B", content: "写入方单调 seq" },
        { id: "C", content: "墙上时钟比较" },
      ],
      standardAnswer: ["A", "B"],
      score: 10,
      gen1: ["A", "B"],
      gen2: null,
    },
    {
      order: 7,
      type: "fill_blank",
      content: "#817-FB-7：请原样输入 scenario.json 中本题 gen1 的标记字符串：____",
      standardAnswer: null, // filled at seed time with the gen1 marker (exact match)
      score: 10,
      gen1: (m) => `${m}|q7|g1|primary`,
      gen2: (m) => `${m}|q7|g2|revised`,
      fillBlankMatchMode: "exact",
    },
    {
      order: 8,
      type: "fill_blank",
      content: "#817-FB-8：请原样输入 scenario.json 中本题 gen1 的标记字符串：____",
      standardAnswer: null, // filled at seed time with the gen1 marker (exact match)
      score: 10,
      gen1: (m) => `${m}|q8|g1`,
      gen2: null,
      fillBlankMatchMode: "exact",
    },
    {
      order: 9,
      type: "text_response",
      content: "#817-TR-9：简述：为什么服务端 ACK 才能确认答案已被服务器接受？（请保留 scenario.json 中给定的答案全文）",
      standardAnswer: null,
      rubric: "参考：只有服务器返回 accepted:true 与 serverVersion 才代表该版本已持久化。",
      score: 10,
      gen1: (m) =>
        `ACK 是服务器对已提交事务的确认。标记 ${m}|q9|g1。只有收到 accepted:true 与 serverVersion 才能认为该版本已持久化。`,
      gen2: null,
    },
    {
      order: 10,
      type: "text_response",
      content: "#817-TR-10：简述 CRLF 在本协议中的语义（答案内包含换行，请保留原文换行）",
      standardAnswer: null,
      rubric: "参考：记录只以 LF 结束；字符串内部的 CRLF 必须转义传输并原样保留。",
      score: 10,
      // Real CRLF inside the persisted answer — ties mailbox CRLF semantics
      // to actual PostgreSQL content.
      gen1: (m) => `第一行：标记 ${m}|q10|g1。\r\n第二行：本答案包含真实 CRLF，用于验证 PG 内容逐字节保留。`,
      gen2: null,
    },
  ];
}

export function manifestValueFor(spec, marker, generation) {
  const v = generation === 2 ? spec.gen2 : spec.gen1;
  if (v === null || v === undefined) return null;
  return typeof v === "function" ? v(marker) : v;
}

export async function seedExamData({ origin, launchpadToken, runId, trialId, evidenceDir, resume = {}, persist = () => {} }) {
  const client = new ApiClient(origin);
  const seedLog = [];
  const log = (step, detail) => {
    seedLog.push({ step, detail, at: new Date().toISOString() });
    console.log(`  [seed] ${step}: ${detail}`);
  };
  const done = (key) => resume[key] !== undefined;

  // 1. Launchpad bootstrap (first Admin + default organization). Resumable:
  // if a previous attempt already bootstrapped, its credentials are in the
  // resume state and we log in instead.
  let admin;
  if (done("admin") && resume.admin) {
    admin = resume.admin;
    await client.login(admin.username, admin.password);
    log("launchpad-resume", `admin=${admin.username}`);
  } else {
    const status = await client.must("GET", "/api/launchpad/status");
    if (status.initialized) {
      throw new Error(
        "installation already initialized but no seed credentials in resume state — this run cannot be resumed; abandon it",
      );
    }
    admin = {
      username: `e817admin_${trialId.replace(/-/g, "")}`.slice(0, 50),
      password: `Adm-${runId}-${trialId}-${Date.now().toString(36)}`,
    };
    await client.must("POST", "/api/launchpad/bootstrap", {
      organizationName: "Exam 817 Research Org",
      adminUsername: admin.username,
      adminPassword: admin.password,
      adminName: "E817 Research Admin",
      setupToken: launchpadToken,
    });
    await client.login(admin.username, admin.password);
    persist({ admin });
    log("launchpad", `admin=${admin.username}`);
  }

  // 2. Course.
  let course;
  if (done("course_id")) {
    course = { id: resume.course_id };
    log("course-resume", course.id);
  } else {
    course = await client.must("POST", "/api/courses", {
      name: `E817 Reliability Course ${trialId}`,
      code: `e817-${trialId}`.slice(0, 50),
      description: "Throwaway course for fault-injection research",
    });
    persist({ course_id: course.id });
    log("course", course.id ?? JSON.stringify(course).slice(0, 120));
  }

  // 3. Questions (resumable per question).
  const marker = `${runId}::${trialId}`;
  const specs = buildQuestionSpecs();
  const questionIds = [...(resume.question_ids ?? [])];
  const manifestQuestions = [...(resume.manifest_questions ?? [])];
  for (const spec of specs.slice(questionIds.length)) {
    const body = {
      courseId: course.id,
      type: spec.type,
      content: spec.content,
      score: spec.score,
      difficulty: 3,
      tags: ["e817-research"],
    };
    if (spec.options) body.options = spec.options.map((o) => ({ id: o.id, content: o.content }));
    if (spec.type === "fill_blank") {
      // Auto-graded exact match: standardAnswer IS the gen1 marker value
      // (gen2 edits intentionally diverge from it — grading is not exercised
      // in the D0–D5 phase; the oracle compares against the manifest).
      body.standardAnswer = manifestValueFor(spec, marker, 1);
      body.gradingRule = { fillBlankMatchMode: "exact", multiSelectScoring: "all_correct_full" };
    } else if (spec.standardAnswer !== null && spec.standardAnswer !== undefined) {
      body.standardAnswer = spec.standardAnswer;
    } else {
      // text_response: the key must be PRESENT (may be null) — omitting it
      // fails the write boundary's "standardAnswer is required" refine.
      body.standardAnswer = null;
      // Publish is the freeze gate: text_response requires a non-empty
      // rubric there even though standardAnswer stays null.
      body.rubric = spec.rubric;
    }
    const q = await client.must("POST", "/api/questions", body);
    questionIds.push(q.id);
    manifestQuestions.push({
      question_id: q.id,
      order: spec.order,
      type: spec.type,
      content: spec.content,
      options: spec.options ?? null,
      score: spec.score,
      expected_gen1: manifestValueFor(spec, marker, 1),
      expected_gen2: manifestValueFor(spec, marker, 2),
    });
    persist({ question_ids: questionIds, manifest_questions: manifestQuestions });
    log(`question ${spec.order}`, `${spec.type} id=${q.id}`);
  }

  // 4. Candidate.
  let candidate;
  if (done("candidate")) {
    candidate = resume.candidate;
    log("candidate-resume", `username=${candidate.username}`);
  } else {
    const candidateUsername = `e817cand_${trialId.replace(/-/g, "")}`.slice(0, 50);
    const candidatePassword = `Cand-${runId}-${trialId}-${Date.now().toString(36)}`;
    candidate = await client.must("POST", "/api/candidates", {
      username: candidateUsername,
      password: candidatePassword,
      name: `E817 Candidate ${trialId}`,
      fields: {},
    });
    candidate = { ...candidate, username: candidateUsername, password: candidatePassword };
    persist({ candidate });
    log("candidate", `username=${candidateUsername} profileId=${candidate.id}`);
  }

  // 5. Exam (long window, 240 min duration — the experiment controls its own
  // lifecycle; deadline pressure must not interfere).
  let exam;
  if (done("exam_id")) {
    exam = { id: resume.exam_id };
    log("exam-resume", exam.id);
  } else {
    const now = Date.now();
    exam = await client.must("POST", "/api/exams", {
      title: `E817 Fault Injection Exam ${trialId}`,
      description: `Research exam for run ${runId} trial ${trialId}`,
      courseId: course.id,
      durationMinutes: 240,
      openAt: new Date(now - 3600_000).toISOString(),
      closeAt: new Date(now + 14 * 24 * 3600_000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionIds,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: false,
      },
      retakePolicy: "max_attempts", // maxAttempts=1 ⇒ single attempt, no retakes
      maxAttempts: 1,
    });
    persist({ exam_id: exam.id });
    log("exam", `id=${exam.id}`);
  }

  // 6. Enrollment (candidate PROFILE id) + publish (idempotent on rerun:
  // enrolling twice and publishing an already-published exam are skipped).
  if (!done("enrolled")) {
    await client.must("POST", `/api/exams/${exam.id}/enrollments`, { candidateIds: [candidate.id] }, [200, 201]);
    persist({ enrolled: true });
  }
  if (!done("published")) {
    await client.must("POST", `/api/exams/${exam.id}/publish`, {});
    persist({ published: true });
  }
  log("publish", `exam ${exam.id} published for ${candidate.username}`);

  // 7. Candidate session smoke check (login only; attempt start is the
  // browser's real flow, driven by the Windows agent). As-built list item
  // shape: {examId, availabilityStatus: "available", primaryAction: "start"}.
  const candClient = new ApiClient(origin);
  await candClient.login(candidate.username, candidate.password);
  const candExams = await candClient.must("GET", "/api/candidate/exams");
  const list = Array.isArray(candExams) ? candExams : candExams.items ?? [];
  const mine = list.find((e) => e.examId === exam.id);
  if (!mine) throw new Error(`candidate cannot see exam ${exam.id}`);
  if (mine.availabilityStatus !== "available") {
    throw new Error(`exam ${exam.id} not available for candidate: ${mine.availabilityStatus}`);
  }
  log("candidate-smoke", `candidate sees exam, available=${mine.availabilityStatus}, action=${mine.primaryAction}`);

  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(
      path.join(evidenceDir, "seed-log.json"),
      JSON.stringify({ runId, trialId, examId: exam.id, adminUsername: admin.username, candidateUsername: candidate.username, steps: seedLog }, null, 2),
    );
  }

  return {
    examId: exam.id,
    course,
    questionIds,
    manifestQuestions,
    admin,
    candidate: { username: candidate.username, password: candidate.password },
    marker,
  };
}
