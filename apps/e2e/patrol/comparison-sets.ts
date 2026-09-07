/**
 * UI-MULTIMODAL-PATROL comparison-set definitions (#494 §33-§42).
 *
 * Pure, dependency-free module: the patrol spec executes these definitions
 * (capture + metadata), and the historical false-negative regression pins
 * their shape. A comparison set holds persona, viewport, responsive shell
 * state, browser, and seed constant, and varies exactly one meaningful
 * dimension (route / persona / viewport / state) so multimodal differences
 * are interpretable. Contact-sheet rendering lives in contact-sheet.ts —
 * this module declares sets, it does not produce artifacts.
 */

export interface SequenceStop {
  /** Ordered display label used on contact sheets, e.g. "01 Dashboard". */
  id: string;
  label: string;
  route: string;
}

/** §35 Set A — Admin shell continuity: same persona+viewport, route varies.
 * Ordering is part of the contract (#492 cross-screenshot review walked this
 * sequence; #493 judged each screenshot independently and missed it). */
export const ADMIN_NAV_SEQUENCE: SequenceStop[] = [
  { id: "01", label: "Dashboard", route: "/admin/dashboard" },
  { id: "02", label: "Operations", route: "/admin/operations" },
  { id: "03", label: "System", route: "/admin/system" },
  { id: "04", label: "Courses", route: "/admin/courses" },
  { id: "05", label: "Questions", route: "/admin/questions" },
  { id: "06", label: "Exams", route: "/admin/exams" },
  { id: "07", label: "Grading Queue", route: "/admin/grading-queue" },
  { id: "08", label: "Results", route: "/admin/results" },
  { id: "09", label: "Proctor", route: "/admin/proctor" },
  { id: "10", label: "Recovery", route: "/admin/recovery" },
  { id: "11", label: "Users", route: "/admin/users" },
  { id: "12", label: "Candidates", route: "/admin/candidates" },
  { id: "13", label: "Audit Logs", route: "/admin/audit-logs" },
  { id: "14", label: "Settings", route: "/admin/settings" },
];

/** §37 Set B — responsive shell: same route, viewport band varies. */
export const RESPONSIVE_VIEWPORTS = [
  { id: "1440x900", width: 1440, height: 900 },
  { id: "1280x800", width: 1280, height: 800 },
  { id: "1100x800", width: 1100, height: 800 },
  { id: "1023x800", width: 1023, height: 800 },
  { id: "375x812", width: 375, height: 812 },
  { id: "320x800", width: 320, height: 800 },
] as const;

export const RESPONSIVE_ROUTE = "/admin/exams";

/** §38 Set C — role shell: same viewport, persona varies. The question is
 * whether capability filtering preserves the navigation grammar, not whether
 * every role sees the same destinations. */
export const ROLE_SURFACES = [
  { id: "admin", label: "Admin", route: "/admin/dashboard" },
  { id: "teacher", label: "Teacher", route: "/admin/exams" },
  { id: "grader", label: "Grader", route: "/admin/grading-queue" },
  { id: "proctor", label: "Proctor", route: "/admin/proctor" },
] as const;

/** §39 Set D — table siblings grouped by archetype, same viewport. Each
 * sibling owns a stable ordering id — comparison-set definitions own their
 * ordering ids, rendering never derives them from array positions (#494
 * corrective-2). */
export interface TableSiblingStop {
  id: string;
  label: string;
  route: string;
}

export interface TableSiblingSet {
  id: string;
  archetype: string;
  sheet: string;
  routes: TableSiblingStop[];
}

export const TABLE_SIBLING_SETS: readonly TableSiblingSet[] = [
  {
    id: "management",
    archetype: "management-list",
    sheet: "TABLE-COMPARE-management-1280.png",
    routes: [
      { id: "01", label: "Users", route: "/admin/users" },
      { id: "02", label: "Candidates", route: "/admin/candidates" },
      { id: "03", label: "Courses", route: "/admin/courses" },
      { id: "04", label: "Questions", route: "/admin/questions" },
      { id: "05", label: "Exams", route: "/admin/exams" },
      { id: "06", label: "Grading Queue", route: "/admin/grading-queue" },
    ],
  },
  {
    id: "diagnostic",
    archetype: "log-diagnostic",
    sheet: "TABLE-COMPARE-diagnostic-1280.png",
    routes: [
      { id: "01", label: "Audit Logs", route: "/admin/audit-logs" },
      { id: "02", label: "Import Logs", route: "/admin/import-logs" },
    ],
  },
];

export const SHELL_COMPARISON_VIEWPORT = { width: 1280, height: 800 };
export const ROLE_COMPARISON_VIEWPORT = { width: 1440, height: 900 };

/**
 * §43 Set E — navigation hierarchy continuity (#494 corrective-1). The
 * varying dimension is the ROUTE INSIDE one navigation family; persona,
 * viewport (1280×800), browser and seed stay constant. Every tile of a
 * family must keep the SAME current destination (its family root), proving
 * the sidebar "looks like one navigation system" as routed descendants move.
 * Questions import is the negative control: 题目导入 is current, 题目管理 is
 * never current (exactly-one).
 */
export interface HierarchyIds {
  examId: string;
  questionId: string;
  profileId: string;
  attemptId: string;
  incidentId: string;
}

export interface HierarchyStop {
  id: string;
  label: string;
  buildRoute: (ids: HierarchyIds) => string;
  /** Expected current destination href for every tile in this family. */
  expectedHref: string;
  /** Optional exactly-one negative: this stop must NOT mark this href current. */
  notCurrentHref?: string;
}

export interface HierarchySet {
  id: string;
  sheetBase: string;
  title: string;
  /** zh-CN rendered destination label, for the review notes. */
  destinationLabel: string;
  stops: HierarchyStop[];
}

export const HIERARCHY_SETS: readonly HierarchySet[] = [
  {
    id: "exams",
    sheetBase: "NAV-HIERARCHY-exams-1280x800",
    title: "Exam family — route hierarchy @1280x800",
    destinationLabel: "考试管理",
    stops: [
      {
        id: "01",
        label: "Exams list",
        buildRoute: () => "/admin/exams",
        expectedHref: "/admin/exams",
      },
      {
        id: "02",
        label: "New exam",
        buildRoute: () => "/admin/exams/new",
        expectedHref: "/admin/exams",
      },
      {
        id: "03",
        label: "Exam detail",
        buildRoute: (i) => `/admin/exams/${i.examId}`,
        expectedHref: "/admin/exams",
      },
      {
        id: "04",
        label: "Exam edit",
        buildRoute: (i) => `/admin/exams/${i.examId}/edit`,
        expectedHref: "/admin/exams",
      },
      {
        id: "05",
        label: "Exam scores",
        buildRoute: (i) => `/admin/exams/${i.examId}/scores`,
        expectedHref: "/admin/exams",
      },
      {
        id: "06",
        label: "Exam proctor",
        buildRoute: (i) => `/admin/exams/${i.examId}/proctor`,
        expectedHref: "/admin/exams",
      },
      {
        id: "07",
        label: "Exam monitor",
        buildRoute: (i) => `/admin/exams/${i.examId}/proctor/monitor`,
        expectedHref: "/admin/exams",
      },
      {
        id: "08",
        label: "Attempt detail",
        buildRoute: (i) => `/admin/attempts/${i.attemptId}`,
        expectedHref: "/admin/exams",
      },
    ],
  },
  {
    id: "questions",
    sheetBase: "NAV-HIERARCHY-questions-1280x800",
    title: "Questions family — route hierarchy @1280x800",
    destinationLabel: "题目管理 / 题目导入 (exactly-one)",
    stops: [
      {
        id: "01",
        label: "Questions list",
        buildRoute: () => "/admin/questions",
        expectedHref: "/admin/questions",
      },
      {
        id: "02",
        label: "New question",
        buildRoute: () => "/admin/questions/new",
        expectedHref: "/admin/questions",
      },
      {
        id: "03",
        label: "Edit question",
        buildRoute: (i) => `/admin/questions/${i.questionId}/edit`,
        expectedHref: "/admin/questions",
      },
      {
        id: "04",
        label: "Question import",
        buildRoute: () => "/admin/questions/import",
        expectedHref: "/admin/questions/import",
        notCurrentHref: "/admin/questions",
      },
    ],
  },
  {
    id: "profiles",
    sheetBase: "NAV-HIERARCHY-profiles-1280x800",
    title: "Exam profiles family — route hierarchy @1280x800",
    destinationLabel: "策略模板",
    stops: [
      {
        id: "01",
        label: "Profiles list",
        buildRoute: () => "/admin/exam-profiles",
        expectedHref: "/admin/exam-profiles",
      },
      {
        id: "02",
        label: "New profile",
        buildRoute: () => "/admin/exam-profiles/new",
        expectedHref: "/admin/exam-profiles",
      },
      {
        id: "03",
        label: "Edit profile",
        buildRoute: (i) => `/admin/exam-profiles/${i.profileId}/edit`,
        expectedHref: "/admin/exam-profiles",
      },
    ],
  },
  {
    id: "recovery",
    sheetBase: "NAV-HIERARCHY-recovery-1280x800",
    title: "Recovery family — route hierarchy @1280x800",
    destinationLabel: "恢复中心",
    stops: [
      {
        id: "01",
        label: "Recovery queue",
        buildRoute: () => "/admin/recovery",
        expectedHref: "/admin/recovery",
      },
      {
        id: "02",
        label: "Incident detail",
        buildRoute: (i) => `/admin/recovery/incidents/${i.incidentId}`,
        expectedHref: "/admin/recovery",
      },
      {
        id: "03",
        label: "Attempt detail",
        buildRoute: (i) => `/admin/recovery/attempts/${i.attemptId}`,
        expectedHref: "/admin/recovery",
      },
      {
        id: "04",
        label: "Exam detail",
        buildRoute: (i) => `/admin/recovery/exams/${i.examId}`,
        expectedHref: "/admin/recovery",
      },
    ],
  },
  {
    id: "grading",
    sheetBase: "NAV-HIERARCHY-grading-1280x800",
    title: "Grading family — route hierarchy @1280x800",
    destinationLabel: "待评分",
    stops: [
      {
        id: "01",
        label: "Grading queue",
        buildRoute: () => "/admin/grading-queue",
        expectedHref: "/admin/grading-queue",
      },
      {
        id: "02",
        label: "Grading detail",
        buildRoute: (i) => `/admin/grading-queue/${i.examId}`,
        expectedHref: "/admin/grading-queue",
      },
    ],
  },
];

/**
 * §40 — the permanent black-box multimodal comparison review prompt. The
 * patrol writes it into every run output; reviewers (human or multimodal
 * model) MUST compare equivalent states across a set instead of judging
 * screenshots independently. Discovery, not conviction: every HIGH/MEDIUM
 * candidate goes through deterministic DOM confirmation before it is called
 * a defect (§41).
 */
export const COMPARISON_REVIEW_PROMPT = `You are reviewing a sequence of screenshots from the SAME product.

Do not judge each screenshot independently.

The comparison set metadata tells you which dimensions are held constant
and which one changes.

Your job is to detect inconsistency across equivalent states.

For NAVIGATION comparisons, inspect ONLY:

1. shell/sidebar width and overall structure;
2. brand/header region;
3. navigation group ordering;
4. item ordering and vertical rhythm;
5. visibility and clarity of the active/current destination;
6. whether the current destination appears lost outside the visible nav;
7. unexpected scroll-state discontinuity;
8. orphan headings or separators;
9. footer/user/logout location;
10. capability-filtered navigation coherence.

A changed active item is EXPECTED.
A changed nav scrollTop may be EXPECTED if required to reveal the active item.

Do not report differences merely because page content changes.

For TABLE sibling comparisons, inspect:

1. outer table containment;
2. title/toolbar geometry;
3. header/row alignment;
4. action/status column behavior;
5. clipping or collision;
6. unexplained horizontal compression;
7. inconsistent local-scroll affordance;
8. sticky-column artifacts;
9. identical semantic roles appearing radically different;
10. hidden content with no discoverable indication.

Classify every candidate as:

HIGH
MEDIUM
LOW
EXPECTED_VARIATION

For each HIGH/MEDIUM candidate provide:

- screenshot ids;
- exact visual difference;
- why equivalent states should remain consistent;
- suspected failure class;
- which DOM fact should be measured to confirm it.

Do NOT call something a defect solely because it looks different.`;
