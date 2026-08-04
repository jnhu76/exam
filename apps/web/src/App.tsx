import { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { BrandProvider, useBranding } from "@/components/layout/BrandProvider";
import { ExamLayout } from "@/components/layout/ExamLayout";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/hooks/useAuth";
import { DateTimeProvider } from "@/contexts/DateTimeContext";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { getDocumentTitle } from "@/lib/pageMeta";
import { LoginPage } from "@/pages/LoginPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { SettingsPage } from "@/pages/admin/SettingsPage";
import { CandidateFieldsPage } from "@/pages/admin/CandidateFieldsPage";
import { UsersPage } from "@/pages/admin/UsersPage";
import { CandidatesPage } from "@/pages/admin/CandidatesPage";
import { CoursePage } from "@/pages/admin/CoursePage";
import { QuestionPage } from "@/pages/admin/QuestionPage";
import { QuestionEditPage } from "@/pages/admin/QuestionEditPage";
import { QuestionImportPage } from "@/pages/admin/QuestionImportPage";
import { ExamPage } from "@/pages/admin/ExamPage";
import { ExamCreatePage } from "@/pages/admin/ExamCreatePage";
import { ExamDetailPage } from "@/pages/admin/ExamDetailPage";
import { ExamEditPage } from "@/pages/admin/ExamEditPage";
import { ExamListPage } from "@/pages/exam/ExamListPage";
import { ExamSettingsPage } from "@/pages/exam/ExamSettingsPage";
import { StartExamPage } from "@/pages/exam/StartExamPage";
import { TakeExamPage } from "@/pages/exam/TakeExamPage";
import { ResultPage } from "@/pages/exam/ResultPage";
import { ScoreListPage } from "@/pages/admin/ScoreListPage";
import { ResultsOverviewPage } from "@/pages/admin/ResultsOverviewPage";
import { AttemptDetailPage } from "@/pages/admin/AttemptDetailPage";
import { ProctorDashboardPage } from "@/pages/admin/ProctorDashboardPage";
import { ExamMonitoringPage } from "@/pages/admin/ExamMonitoringPage";
import { ProctorWorkspacePage } from "@/pages/admin/ProctorWorkspacePage";
import { DashboardPage } from "@/pages/admin/DashboardPage";
import { SystemDiagnosticsPage } from "@/pages/admin/SystemDiagnosticsPage";
import { GradingQueuePage } from "@/pages/admin/GradingQueuePage";
import { GradingDetailPage } from "@/pages/admin/GradingDetailPage";
import { AuditLogPage } from "@/pages/admin/AuditLogPage";
import { ImportLogsPage } from "@/pages/admin/ImportLogsPage";
import { RecoveryQueuePage } from "@/pages/admin/RecoveryQueuePage";
import { RecoveryIncidentDetailPage } from "@/pages/admin/RecoveryIncidentDetailPage";
import { RecoveryAttemptDetailPage } from "@/pages/admin/RecoveryAttemptDetailPage";
import { adminLandingPath } from "@/lib/capabilities";

export function AdminIndexRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const landingPath = adminLandingPath(user);
  return landingPath ? (
    <Navigate to={landingPath} replace />
  ) : (
    <PlaceholderPage />
  );
}

/** Top-level route definitions for admin, candidate exam, and login views. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminIndexRoute />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="system" element={<SystemDiagnosticsPage />} />
        <Route
          path="diagnostics"
          element={<Navigate to="/admin/system" replace />}
        />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="candidate-fields" element={<CandidateFieldsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="candidates" element={<CandidatesPage />} />
        <Route path="courses" element={<CoursePage />} />
        <Route path="questions" element={<QuestionPage />} />
        <Route path="questions/new" element={<QuestionEditPage />} />
        <Route path="questions/:id/edit" element={<QuestionEditPage />} />
        <Route path="questions/import" element={<QuestionImportPage />} />
        <Route path="exams" element={<ExamPage />} />
        <Route path="exams/new" element={<ExamCreatePage />} />
        <Route path="exams/:id" element={<ExamDetailPage />} />
        <Route path="exams/:id/edit" element={<ExamEditPage />} />
        <Route path="exams/:id/scores" element={<ScoreListPage />} />
        <Route path="exams/:id/proctor" element={<ProctorDashboardPage />} />
        <Route path="proctor" element={<ProctorWorkspacePage />} />
        <Route
          path="exams/:id/proctor/monitor"
          element={<ExamMonitoringPage />}
        />
        <Route path="results" element={<ResultsOverviewPage />} />
        <Route path="grading-queue" element={<GradingQueuePage />} />
        <Route path="grading-queue/:id" element={<GradingDetailPage />} />
        <Route path="audit-logs" element={<AuditLogPage />} />
        <Route path="import-logs" element={<ImportLogsPage />} />
        <Route path="attempts/:id" element={<AttemptDetailPage />} />
        <Route path="recovery" element={<RecoveryQueuePage />} />
        <Route
          path="recovery/incidents/:incidentId"
          element={<RecoveryIncidentDetailPage />}
        />
        <Route
          path="recovery/attempts/:attemptId"
          element={<RecoveryAttemptDetailPage />}
        />
        <Route path="*" element={<PlaceholderPage />} />
      </Route>
      <Route path="/exam" element={<ExamLayout />}>
        <Route index element={<Navigate to="/exam/list" replace />} />
        <Route path="list" element={<ExamListPage />} />
        <Route path="settings" element={<ExamSettingsPage />} />
        <Route path=":examId/start" element={<StartExamPage />} />
        <Route path=":attemptId/take" element={<TakeExamPage />} />
        <Route path=":attemptId/result" element={<ResultPage />} />
        <Route path="*" element={<PlaceholderPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

/** Synchronizes the document title with the current route and branding. */
export function AppTitle() {
  const location = useLocation();
  const branding = useBranding();

  useEffect(() => {
    document.title = getDocumentTitle(location.pathname, branding.productName);
  }, [branding.productName, location.pathname]);

  return null;
}

/**
 * Root application component. Wraps the app in ErrorBoundary, BrowserRouter,
 * BrandProvider, and AuthProvider, then renders routes and the toast layer.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <BrandProvider loadRemote>
          <AuthProvider restoreSession>
            <DateTimeProvider>
              <AppTitle />
              <AppRoutes />
              <Toaster />
            </DateTimeProvider>
          </AuthProvider>
        </BrandProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
