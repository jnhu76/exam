/**
 * UI-MULTIMODAL-PATROL-1 — visual patrol harness.
 *
 * Runs as a serial Playwright test under playwright.patrol.config.ts.
 * Uses the canonical run-wsl lifecycle (DB/Redis/migrate/seed/api server).
 * Each role persona is set up via Admin product APIs, logged in via real UI.
 *
 * Output: .tmp/ui-patrol/<sha>/ with manifest.json, screenshots, findings.
 */
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// ── Shared lib imports ──
import { loginAsAdmin, loginViaUi } from "../lib/login";
import {
  seedExam,
  createProctorAssignmentFixture,
  type SeededExam,
  type SeededCandidate,
} from "../lib/seed";
import { createTeacherViaApi } from "../lib/teacher";
import {
  candidateApiToken,
  startAndSubmitAttempt,
  closeExamApi,
} from "../lib/flow";
import {
  PATROL_BASE_URL,
  collectShellFacts,
  createUserViaApi,
  assignUserToCourse,
  progressLog,
  type NavShellFacts,
  type TableShellFacts,
} from "./patrol-fixtures";

// ── Constants ──
const BASE_URL = PATROL_BASE_URL;
const BASE_SHA = execSync("git rev-parse --short HEAD", {
  cwd: join(import.meta.dirname, "../../.."),
})
  .toString()
  .trim();
const RUN_ID = `${BASE_SHA}-${Date.now()}`;
const OUTPUT_DIR = join(import.meta.dirname, "../../../.tmp/ui-patrol", RUN_ID);
const SCREENSHOTS_DIR = join(OUTPUT_DIR, "screenshots");

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };
const BREAKPOINTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "1100", width: 1100, height: 800 },
  { name: "1023", width: 1023, height: 800 },
  { name: "320", width: 320, height: 800 },
];

// ── Types ──
interface ManifestEntry {
  role: string;
  persona: string;
  route: string;
  resolvedUrl: string;
  pageTitle: string;
  documentTitle: string;
  viewport: { width: number; height: number };
  screenshot: string;
  document: {
    clientWidth: number;
    scrollWidth: number;
    horizontalOverflow: boolean;
  };
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  interactiveElements: number;
  tables: TableShellFacts[];
  /** NAV-1…NAV-5 shell facts (#494 §33/§42); null on non-admin layouts. */
  shell: NavShellFacts | null;
  links: string[];
}

interface RuntimeFinding {
  id: string;
  role: string;
  persona: string;
  route: string;
  viewport: string;
  screenshot: string;
  observation: string;
  failureClass: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  why: string;
}

interface RouteCoverageEntry {
  route: string;
  page: string;
  roles: Record<
    string,
    | "VISITED"
    | "DENIED_AS_EXPECTED"
    | "NOT_REACHABLE_FOR_ROLE"
    | "REQUIRES_DYNAMIC_FIXTURE"
    | "PATROL_COVERAGE_GAP"
  >;
}

// ── Global state ──
const manifest: ManifestEntry[] = [];
const findings: RuntimeFinding[] = [];
const routeCoverage: RouteCoverageEntry[] = [];
let adminToken = "";
let exams: SeededExam[] = [];
let teacherFixture: {
  username: string;
  password: string;
  name: string;
  userId: string;
} | null = null;
let graderFixture: {
  username: string;
  password: string;
  name: string;
  userId: string;
} | null = null;
let proctorFixture: {
  username: string;
  password: string;
  name: string;
  userId: string;
} | null = null;

// ── Helpers ──

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function routeSlug(route: string): string {
  return (
    route
      .replace(/^\/+/, "")
      .replace(/\/+/g, "-")
      .replace(/[^a-zA-Z0-9-]/g, "") || "root"
  );
}

async function collectRuntimeFacts(page: Page) {
  return await page.evaluate(() => {
    // Interactive elements
    const interactive = document.querySelectorAll(
      "button, a[href], input, select, textarea, [role=button], [tabindex]",
    );

    // Same-origin links
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((href) => {
        try {
          const u = new URL(href);
          return u.origin === window.location.origin;
        } catch {
          return false;
        }
      });

    return {
      interactiveElements: interactive.length,
      links,
    };
  });
}

async function waitForPageStable(page: Page) {
  // Wait for network to settle (no pending requests for 500ms)
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
  // Wait a bit for any remaining animations
  await page.waitForTimeout(300);
}

async function capturePage(
  page: Page,
  role: string,
  persona: string,
  route: string,
  viewport: { width: number; height: number },
  state: string = "default",
): Promise<ManifestEntry> {
  const slug = routeSlug(route);
  const vpName = `${viewport.width}x${viewport.height}`;
  const filename = `${persona}--${slug}--${vpName}--${state}.png`;
  const filepath = join(SCREENSHOTS_DIR, role, filename);

  ensureDir(join(SCREENSHOTS_DIR, role));

  // Collect console errors
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("requestfailed", (req) =>
    failedRequests.push(`${req.failure()?.errorText} ${req.url()}`),
  );

  // Collect runtime facts
  const facts = await collectRuntimeFacts(page);
  // NAV-1…NAV-5 + table archetype/tier/overflow DOM facts (#494 §30/§42).
  const shell = await collectShellFacts(page);

  // Take screenshot
  await page.screenshot({ path: filepath, type: "png" });

  const title = await page.title();
  const resolvedUrl = page.url();

  const entry: ManifestEntry = {
    role,
    persona,
    route,
    resolvedUrl,
    pageTitle: title,
    documentTitle: title,
    viewport,
    screenshot: filepath,
    document: shell.document,
    consoleErrors,
    pageErrors,
    failedRequests,
    interactiveElements: facts.interactiveElements,
    tables: shell.tables,
    shell: shell.nav,
    links: facts.links,
  };

  manifest.push(entry);
  return entry;
}

async function navigateAndCapture(
  page: Page,
  role: string,
  persona: string,
  route: string,
  viewport: { width: number; height: number },
  state: string = "default",
  waitForStable: boolean = true,
) {
  await page.setViewportSize(viewport);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  if (waitForStable) await waitForPageStable(page);
  return capturePage(page, role, persona, route, viewport, state);
}

// ── Role setup helpers ──

// ── Route inventory (from routes.ts) ──
const ALL_ROUTES: Array<{ route: string; page: string; roles: string[] }> = [
  // Admin routes
  { route: "/admin/dashboard", page: "DashboardPage", roles: ["Admin"] },
  { route: "/admin/users", page: "UsersPage", roles: ["Admin"] },
  { route: "/admin/candidates", page: "CandidatesPage", roles: ["Admin"] },
  { route: "/admin/settings", page: "SettingsPage", roles: ["Admin"] },
  {
    route: "/admin/candidate-fields",
    page: "CandidateFieldsPage",
    roles: ["Admin"],
  },
  { route: "/admin/courses", page: "CoursesPage", roles: ["Admin", "Teacher"] },
  {
    route: "/admin/questions",
    page: "QuestionsPage",
    roles: ["Admin", "Teacher"],
  },
  {
    route: "/admin/questions/new",
    page: "QuestionEditPage",
    roles: ["Admin", "Teacher"],
  },
  { route: "/admin/exams", page: "ExamsPage", roles: ["Admin", "Teacher"] },
  { route: "/admin/exams/new", page: "ExamEditPage", roles: ["Admin"] },
  { route: "/admin/exam-profiles", page: "ExamProfilesPage", roles: ["Admin"] },
  {
    route: "/admin/exam-profiles/new",
    page: "ExamProfileEditPage",
    roles: ["Admin"],
  },
  {
    route: "/admin/grading-queue",
    page: "GradingQueuePage",
    roles: ["Admin", "Grader"],
  },
  { route: "/admin/results", page: "ResultsPage", roles: ["Admin", "Teacher"] },
  { route: "/admin/permissions", page: "PermissionsPage", roles: ["Admin"] },
  {
    route: "/admin/proctor",
    page: "ProctorWorkspacePage",
    roles: ["Admin", "Proctor"],
  },
  { route: "/admin/audit-logs", page: "AuditLogPage", roles: ["Admin"] },
  { route: "/admin/import-logs", page: "ImportLogPage", roles: ["Admin"] },
  { route: "/admin/recovery", page: "RecoveryPage", roles: ["Admin"] },
  { route: "/admin/operations", page: "OperationsPage", roles: ["Admin"] },
  // Candidate routes
  { route: "/exam/list", page: "ExamListPage", roles: ["Candidate"] },
  { route: "/exam/settings", page: "ExamSettingsPage", roles: ["Candidate"] },
];

// Dynamic routes that need IDs
const DYNAMIC_ROUTES: Array<{
  buildRoute: (id: string) => string;
  page: string;
  roles: string[];
}> = [
  {
    buildRoute: (id) => `/admin/exams/${id}`,
    page: "ExamDetailPage",
    roles: ["Admin", "Teacher"],
  },
  {
    buildRoute: (id) => `/admin/exams/${id}/edit`,
    page: "ExamEditPage",
    roles: ["Admin"],
  },
  {
    buildRoute: (id) => `/admin/exams/${id}/scores`,
    page: "ScoreListPage",
    roles: ["Admin", "Teacher"],
  },
  {
    buildRoute: (id) => `/admin/grading-queue/${id}`,
    page: "GradingDetailPage",
    roles: ["Admin", "Grader"],
  },
  {
    buildRoute: (id) => `/admin/attempts/${id}`,
    page: "AttemptDetailPage",
    roles: ["Admin"],
  },
  {
    buildRoute: (id) => `/admin/exam-profiles/${id}/edit`,
    page: "ExamProfileEditPage",
    roles: ["Admin"],
  },
  {
    buildRoute: (id) => `/admin/exams/${id}/proctor`,
    page: "ProctorDetailPage",
    roles: ["Admin", "Proctor"],
  },
  {
    buildRoute: (id) => `/admin/questions/${id}/edit`,
    page: "QuestionEditPage",
    roles: ["Admin", "Teacher"],
  },
  {
    buildRoute: (id) => `/admin/recovery/incidents/${id}`,
    page: "RecoveryIncidentPage",
    roles: ["Admin"],
  },
  {
    buildRoute: (id) => `/admin/recovery/exams/${id}`,
    page: "RecoveryExamPage",
    roles: ["Admin"],
  },
];

// Candidate dynamic routes
const CANDIDATE_DYNAMIC_ROUTES: Array<{
  buildRoute: (id: string) => string;
  page: string;
}> = [
  { buildRoute: (id) => `/exam/${id}/start`, page: "ExamStartPage" },
  { buildRoute: (id) => `/exam/${id}/take`, page: "ExamTakePage" },
  { buildRoute: (id) => `/exam/${id}/result`, page: "ExamResultPage" },
];

// ══════════════════════════════════════════════════════════════════════════
// MAIN PATROL TEST
// ══════════════════════════════════════════════════════════════════════════

test.describe.serial("UI-MULTIMODAL-PATROL-1", () => {
  let page: Page;

  test.beforeAll(async ({ browser, request }) => {
    ensureDir(OUTPUT_DIR);
    ensureDir(SCREENSHOTS_DIR);

    // ── Phase 0: Seed data via API ──
    // Login as admin via API
    const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { username: "admin", password: "admin123" },
    });
    const setCookie = loginRes.headers()["set-cookie"] ?? "";
    adminToken = setCookie.match(/auth-token=([^;]+)/)?.[1] ?? "";
    expect(adminToken).toBeTruthy();

    // Seed 3 exams with different states
    const exam1 = await seedExam(
      request as unknown as APIRequestContext,
      "patrol-open",
      {
        timingMode: "timed_window",
        durationMinutes: 60,
      },
    );
    exams.push(exam1);
    progressLog(OUTPUT_DIR, `[patrol] exam1 seeded: ${exam1.examId}`);

    const exam2 = await seedExam(
      request as unknown as APIRequestContext,
      "patrol-closed",
      {
        timingMode: "timed_window",
        durationMinutes: 60,
      },
    );
    exams.push(exam2);
    progressLog(OUTPUT_DIR, `[patrol] exam2 seeded: ${exam2.examId}`);
    // Close exam2
    await closeExamApi(
      request as unknown as APIRequestContext,
      adminToken,
      exam2.examId,
      "patrol cleanup",
    );

    // exam3: for grading detail page — seed, enroll a candidate, start+submit attempt
    let exam3: SeededExam | null = null;
    try {
      exam3 = await seedExam(
        request as unknown as APIRequestContext,
        "patrol-graded",
        {
          timingMode: "timed_window",
        },
      );
      exams.push(exam3);
      progressLog(OUTPUT_DIR, `[patrol] exam3 seeded: ${exam3.examId}`);
      const candToken = await candidateApiToken(
        request as unknown as APIRequestContext,
        exam3.candidate,
      );
      await startAndSubmitAttempt(
        request as unknown as APIRequestContext,
        candToken,
        exam3.examId,
      );
    } catch (e) {
      progressLog(OUTPUT_DIR, `[patrol] exam3 seed failed (non-fatal): ${e}`);
    }

    // Create Teacher
    teacherFixture = await createTeacherViaApi(
      request as unknown as APIRequestContext,
      {
        name: "Patrol教师",
        usernamePrefix: "patrol-teacher",
      },
    );
    // Assign teacher to exam1's course
    await assignUserToCourse(
      request as unknown as APIRequestContext,
      adminToken,
      teacherFixture.userId,
      exam1.courseId,
    );

    // Create Grader (role preset gives GradingQueueView; no per-exam assignment needed for patrol)
    graderFixture = await createUserViaApi(
      request as unknown as APIRequestContext,
      adminToken,
      "Grader",
      "grader",
    );

    // Create Proctor
    proctorFixture = await createUserViaApi(
      request as unknown as APIRequestContext,
      adminToken,
      "Proctor",
      "proctor",
    );
    await createProctorAssignmentFixture(
      request as unknown as APIRequestContext,
      adminToken,
      exam1.examId,
      proctorFixture.userId,
    );

    // Write initial manifest
    writeFileSync(
      join(OUTPUT_DIR, "manifest.json"),
      JSON.stringify(
        {
          runId: RUN_ID,
          baseSha: BASE_SHA,
          baseUrl: BASE_URL,
          startedAt: new Date().toISOString(),
          exams: exams.map((e) => ({
            id: e.examId,
            title: e.examTitle,
            courseId: e.courseId,
            candidate: e.candidate.username,
          })),
          teacher: teacherFixture?.username,
          grader: graderFixture?.username,
          proctor: proctorFixture?.username,
        },
        null,
        2,
      ),
    );

    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page?.close();

    // Write final outputs
    writeFileSync(
      join(OUTPUT_DIR, "manifest.json"),
      JSON.stringify(
        {
          runId: RUN_ID,
          baseSha: BASE_SHA,
          baseUrl: BASE_URL,
          completedAt: new Date().toISOString(),
          totalScreenshots: manifest.length,
          entries: manifest,
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(OUTPUT_DIR, "runtime-findings.json"),
      JSON.stringify(findings, null, 2),
    );

    writeFileSync(
      join(OUTPUT_DIR, "route-coverage.json"),
      JSON.stringify(routeCoverage, null, 2),
    );

    progressLog(
      OUTPUT_DIR,
      `[patrol] DONE: ${manifest.length} screenshots in ${OUTPUT_DIR}`,
    );
  });

  // ── Phase 1: Admin patrol ──
  test("Admin: login and traverse all admin pages", async () => {
    await loginAsAdmin(page, "admin", "admin123");
    expect(page.url()).toContain("/admin/dashboard");

    // Desktop pass (1440×900)
    for (const r of ALL_ROUTES.filter((r) => r.roles.includes("Admin"))) {
      const entry = await navigateAndCapture(
        page,
        "admin",
        "admin",
        r.route,
        DESKTOP,
      );
      // Check for console errors
      if (entry.consoleErrors.length > 0) {
        findings.push({
          id: `F-ADMIN-CONSOLE-${routeSlug(r.route)}`,
          role: "Admin",
          persona: "admin",
          route: r.route,
          viewport: "1440x900",
          screenshot: entry.screenshot,
          observation: `Console errors: ${entry.consoleErrors.join("; ")}`,
          failureClass: "RUNTIME_ERROR",
          confidence: "MEDIUM",
          why: "Console errors during normal page load",
        });
      }
    }

    // Dynamic admin routes (exam detail, edit, scores, grading detail)
    if (exams.length > 0 && exams[0]) {
      for (const dr of DYNAMIC_ROUTES.filter((r) =>
        r.roles.includes("Admin"),
      )) {
        const route = dr.buildRoute(exams[0].examId);
        const entry = await navigateAndCapture(
          page,
          "admin",
          "admin",
          route,
          DESKTOP,
        );
        if (entry.consoleErrors.length > 0) {
          findings.push({
            id: `F-ADMIN-CONSOLE-${routeSlug(route)}`,
            role: "Admin",
            persona: "admin",
            route,
            viewport: "1440x900",
            screenshot: entry.screenshot,
            observation: `Console errors: ${entry.consoleErrors.join("; ")}`,
            failureClass: "RUNTIME_ERROR",
            confidence: "MEDIUM",
            why: "Console errors during normal page load",
          });
        }
      }
      // Grading detail with exam3 (has submitted attempt, if available)
      if (exams.length > 2 && exams[2]) {
        await navigateAndCapture(
          page,
          "admin",
          "admin",
          `/admin/grading-queue/${exams[2].examId}`,
          DESKTOP,
        );
      }
    }

    // Mobile pass (375×812)
    for (const r of ALL_ROUTES.filter((r) => r.roles.includes("Admin")).slice(
      0,
      10,
    )) {
      await navigateAndCapture(page, "admin", "admin", r.route, MOBILE);
    }
  });

  // ── Phase 2: Teacher patrol ──
  test("Teacher: login and traverse teacher pages", async () => {
    if (!teacherFixture) return;
    await loginViaUi(
      page,
      teacherFixture.username,
      teacherFixture.password,
      /\/admin\/exams/,
    );

    // Teacher sees: courses, questions, exams (and their sub-pages)
    const teacherRoutes = [
      "/admin/courses",
      "/admin/questions",
      "/admin/exams",
      "/admin/results",
    ];

    for (const route of teacherRoutes) {
      await navigateAndCapture(page, "teacher", "teacher", route, DESKTOP);
      await navigateAndCapture(page, "teacher", "teacher", route, MOBILE);
    }

    // Dynamic: exam detail for exam1
    if (exams.length > 0 && exams[0]) {
      await navigateAndCapture(
        page,
        "teacher",
        "teacher",
        `/admin/exams/${exams[0].examId}`,
        DESKTOP,
      );
      await navigateAndCapture(
        page,
        "teacher",
        "teacher",
        `/admin/exams/${exams[0].examId}`,
        MOBILE,
      );
    }
  });

  // ── Phase 3: Grader patrol ──
  test("Grader: login and traverse grading pages", async () => {
    if (!graderFixture) return;
    await loginViaUi(
      page,
      graderFixture.username,
      graderFixture.password,
      /\/admin\/grading-queue/,
    );

    // Grader sees: grading queue + detail
    await navigateAndCapture(
      page,
      "grader",
      "grader",
      "/admin/grading-queue",
      DESKTOP,
    );
    await navigateAndCapture(
      page,
      "grader",
      "grader",
      "/admin/grading-queue",
      MOBILE,
    );

    // Grading detail for exam3 (has submitted attempt)
    if (exams.length > 2 && exams[2]) {
      await navigateAndCapture(
        page,
        "grader",
        "grader",
        `/admin/grading-queue/${exams[2].examId}`,
        DESKTOP,
      );
      await navigateAndCapture(
        page,
        "grader",
        "grader",
        `/admin/grading-queue/${exams[2].examId}`,
        MOBILE,
      );
    }
  });

  // ── Phase 4: Proctor patrol ──
  test("Proctor: login and traverse proctor pages", async () => {
    if (!proctorFixture) return;
    await loginViaUi(
      page,
      proctorFixture.username,
      proctorFixture.password,
      /\/admin\/proctor/,
    );

    // Proctor sees: proctor workspace + detail
    await navigateAndCapture(
      page,
      "proctor",
      "proctor",
      "/admin/proctor",
      DESKTOP,
    );
    await navigateAndCapture(
      page,
      "proctor",
      "proctor",
      "/admin/proctor",
      MOBILE,
    );

    // Proctor detail for exam1
    if (exams.length > 0 && exams[0]) {
      await navigateAndCapture(
        page,
        "proctor",
        "proctor",
        `/admin/exams/${exams[0].examId}/proctor`,
        DESKTOP,
      );
      await navigateAndCapture(
        page,
        "proctor",
        "proctor",
        `/admin/exams/${exams[0].examId}/proctor`,
        MOBILE,
      );
    }
  });

  // ── Phase 5: Candidate patrol (4 personas) ──
  test("Candidate.available: exam list", async () => {
    // candidate2 is "available" (has exam ready to start)
    await loginViaUi(page, "candidate2", "candidate123", /\/exam\/list/);
    await navigateAndCapture(
      page,
      "candidate",
      "candidate-available",
      "/exam/list",
      DESKTOP,
    );
    await navigateAndCapture(
      page,
      "candidate",
      "candidate-available",
      "/exam/list",
      MOBILE,
    );
    await navigateAndCapture(
      page,
      "candidate",
      "candidate-available",
      "/exam/settings",
      DESKTOP,
    );
    await navigateAndCapture(
      page,
      "candidate",
      "candidate-available",
      "/exam/settings",
      MOBILE,
    );
  });

  test("Candidate.inProgress: exam list (has in-progress exam)", async () => {
    // candidate1 has an in-progress exam
    await loginViaUi(page, "candidate1", "candidate123", /\/exam\/list/);
    await navigateAndCapture(
      page,
      "candidate",
      "candidate-inProgress",
      "/exam/list",
      DESKTOP,
    );
    await navigateAndCapture(
      page,
      "candidate",
      "candidate-inProgress",
      "/exam/list",
      MOBILE,
    );
  });

  test("Candidate.resumable: exam list (has resumable exam)", async () => {
    // candidate3 has a resumable exam
    await loginViaUi(page, "candidate3", "candidate123", /\/exam\/list/);
    await navigateAndCapture(
      page,
      "candidate",
      "candidate-resumable",
      "/exam/list",
      DESKTOP,
    );
    await navigateAndCapture(
      page,
      "candidate",
      "candidate-resumable",
      "/exam/list",
      MOBILE,
    );
  });

  test("Candidate.graded: exam list (has graded result)", async () => {
    // candidate4 has a graded result
    await loginViaUi(page, "candidate4", "candidate123", /\/exam\/list/);
    await navigateAndCapture(
      page,
      "candidate",
      "candidate-graded",
      "/exam/list",
      DESKTOP,
    );
    await navigateAndCapture(
      page,
      "candidate",
      "candidate-graded",
      "/exam/list",
      MOBILE,
    );
  });

  // ── Phase 6: Breakpoint probes ──
  test("Breakpoint probes on representative pages", async () => {
    await loginAsAdmin(page, "admin", "admin123");

    const probePages = [
      "/admin/dashboard",
      "/admin/exams",
      "/admin/grading-queue",
      "/admin/audit-logs",
      "/admin/courses",
    ];

    for (const route of probePages) {
      for (const bp of BREAKPOINTS) {
        await navigateAndCapture(
          page,
          "admin",
          "admin-breakpoint",
          route,
          { width: bp.width, height: bp.height },
          bp.name,
        );
      }
    }

    // Candidate at breakpoints
    await loginViaUi(page, "candidate2", "candidate123", /\/exam\/list/);
    for (const bp of BREAKPOINTS) {
      await navigateAndCapture(
        page,
        "candidate",
        "candidate-breakpoint",
        "/exam/list",
        { width: bp.width, height: bp.height },
        bp.name,
      );
    }
  });

  // ── Phase 7: Focus/keyboard probe ──
  test("Keyboard focus probe on representative pages", async () => {
    await loginAsAdmin(page, "admin", "admin123");
    await page.goto("/admin/dashboard");
    await waitForPageStable(page);

    // Tab through several elements and screenshot focus states
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(100);
    }
    await capturePage(
      page,
      "admin",
      "admin-focus",
      "/admin/dashboard",
      DESKTOP,
      "focus-5",
    );

    // Mobile candidate focus
    await page.setViewportSize(MOBILE);
    await loginViaUi(page, "candidate2", "candidate123", /\/exam\/list/);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(100);
    }
    await capturePage(
      page,
      "candidate",
      "candidate-focus",
      "/exam/list",
      MOBILE,
      "focus-3",
    );
  });
});
