import type { PageContainerRole } from "@/components/shared/PageContainer";

/**
 * Route→role fixture (issue 455 §28) — the authority-oriented proof that the
 * current routed page set maps onto declared page roles.
 *
 * This fixture does not duplicate routing: `pageGeometryContract.test.ts`
 * derives the actual routed page set from `App.tsx` (AST) and fails on drift
 * in BOTH directions — a routed page missing here, or an entry whose route no
 * longer exists. The `role` value must be one of the roles the page component
 * actually declares via `<PageContainer role="…">` (also AST-checked).
 *
 * `AccessDeniedPage` is rendered by `AdminLayout` (capability guard), not by a
 * route element; it is covered by the test's explicit extra-entries list.
 * `AdminIndexRoute` lives in `App.tsx` and only redirects (or renders
 * `PlaceholderPage`), so it declares no geometry of its own.
 */
export interface RoutePageRole {
  /** Route pattern as written in App.tsx (layout-relative for nested routes). */
  route: string;
  /** Routed page component name (imported from `@/pages/**` in App.tsx). */
  page: string;
  /** The page role the page component declares. */
  role: PageContainerRole;
}

export const ROUTE_PAGE_ROLES: readonly RoutePageRole[] = [
  // Top-level (no layout — auth pages self-center, gutter owner = page)
  { route: "/login", page: "LoginPage", role: "auth" },
  { route: "/launchpad", page: "LaunchpadPage", role: "auth" },
  { route: "/invite/accept", page: "InviteAcceptPage", role: "auth" },
  { route: "/forgot-password", page: "ForgotPasswordPage", role: "auth" },
  { route: "/reset-password", page: "ResetPasswordPage", role: "auth" },

  // /admin (AdminLayout owns the gutter; each page declares its role)
  { route: "/admin/dashboard", page: "DashboardPage", role: "admin-standard" },
  { route: "/admin/system", page: "SystemDiagnosticsPage", role: "admin-wide" },
  {
    route: "/admin/operations",
    page: "OperationsPage",
    role: "admin-standard",
  },
  { route: "/admin/settings", page: "SettingsPage", role: "form" },
  {
    route: "/admin/candidate-fields",
    page: "CandidateFieldsPage",
    role: "admin-standard",
  },
  { route: "/admin/users", page: "UsersPage", role: "admin-standard" },
  {
    route: "/admin/candidates",
    page: "CandidatesPage",
    role: "admin-standard",
  },
  { route: "/admin/courses", page: "CoursePage", role: "admin-standard" },
  { route: "/admin/questions", page: "QuestionPage", role: "admin-standard" },
  {
    route: "/admin/questions/new",
    page: "QuestionEditPage",
    role: "form",
  },
  {
    route: "/admin/questions/:id/edit",
    page: "QuestionEditPage",
    role: "form",
  },
  {
    route: "/admin/questions/import",
    page: "QuestionImportPage",
    role: "form",
  },
  { route: "/admin/exams", page: "ExamPage", role: "admin-standard" },
  { route: "/admin/exams/new", page: "ExamCreatePage", role: "form" },
  {
    route: "/admin/exams/:id",
    page: "ExamDetailPage",
    role: "admin-standard",
  },
  {
    route: "/admin/exams/:id/edit",
    page: "ExamEditPage",
    role: "form",
  },
  {
    route: "/admin/exams/:id/scores",
    page: "ScoreListPage",
    role: "admin-standard",
  },
  {
    route: "/admin/exam-profiles",
    page: "ExamProfilePage",
    role: "admin-standard",
  },
  {
    route: "/admin/exam-profiles/new",
    page: "ExamProfileEditPage",
    role: "admin-standard",
  },
  {
    route: "/admin/exam-profiles/:id/edit",
    page: "ExamProfileEditPage",
    role: "admin-standard",
  },
  {
    route: "/admin/exams/:id/proctor",
    page: "ProctorDashboardPage",
    role: "admin-standard",
  },
  {
    route: "/admin/proctor",
    page: "ProctorWorkspacePage",
    role: "admin-standard",
  },
  {
    route: "/admin/exams/:id/proctor/monitor",
    page: "ExamMonitoringPage",
    role: "admin-standard",
  },
  {
    route: "/admin/results",
    page: "ResultsOverviewPage",
    role: "admin-standard",
  },
  {
    route: "/admin/grading-queue",
    page: "GradingQueuePage",
    role: "admin-standard",
  },
  {
    route: "/admin/grading-queue/:id",
    page: "GradingDetailPage",
    role: "admin-standard",
  },
  {
    route: "/admin/audit-logs",
    page: "AuditLogPage",
    role: "admin-standard",
  },
  {
    route: "/admin/permissions",
    page: "PermissionRegistryPage",
    role: "admin-standard",
  },
  {
    route: "/admin/import-logs",
    page: "ImportLogsPage",
    role: "admin-standard",
  },
  {
    route: "/admin/attempts/:id",
    page: "AttemptDetailPage",
    role: "admin-standard",
  },
  {
    route: "/admin/recovery",
    page: "RecoveryQueuePage",
    role: "admin-standard",
  },
  {
    route: "/admin/recovery/incidents/:incidentId",
    page: "RecoveryIncidentDetailPage",
    role: "admin-standard",
  },
  {
    route: "/admin/recovery/attempts/:attemptId",
    page: "RecoveryAttemptDetailPage",
    role: "admin-standard",
  },
  {
    route: "/admin/recovery/exams/:examId",
    page: "RecoveryExamDetailPage",
    role: "admin-standard",
  },
  { route: "/admin/*", page: "PlaceholderPage", role: "admin-standard" },

  // /exam (ExamLayout owns the gutter; candidate pages declare `candidate`)
  { route: "/exam/list", page: "ExamListPage", role: "candidate" },
  { route: "/exam/settings", page: "ExamSettingsPage", role: "candidate" },
  { route: "/exam/:examId/start", page: "StartExamPage", role: "candidate" },
  {
    route: "/exam/:attemptId/take",
    page: "TakeExamPage",
    role: "exam-runtime",
  },
  {
    route: "/exam/:attemptId/result",
    page: "ResultPage",
    role: "candidate",
  },
  { route: "/exam/*", page: "PlaceholderPage", role: "admin-standard" },
];

/**
 * Pages that participate in page geometry but are NOT routed through an
 * `App.tsx` route element (rendered by a layout instead). Same declaration
 * duty as routed pages.
 */
export const LAYOUT_RENDERED_PAGES: readonly RoutePageRole[] = [
  {
    route: "/admin (layout guard)",
    page: "AccessDeniedPage",
    role: "admin-standard",
  },
];
