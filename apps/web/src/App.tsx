import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ExamLayout } from "@/components/layout/ExamLayout";
import { AuthProvider } from "@/contexts/AuthContext";
import { LoginPage } from "@/pages/LoginPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { SettingsPage } from "@/pages/admin/SettingsPage";
import { OrganizationsPage } from "@/pages/admin/OrganizationsPage";
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
import { ExamListPage } from "@/pages/exam/ExamListPage";
import { StartExamPage } from "@/pages/exam/StartExamPage";
import { TakeExamPage } from "@/pages/exam/TakeExamPage";
import { ResultPage } from "@/pages/exam/ResultPage";
import { ScoreListPage } from "@/pages/admin/ScoreListPage";
import { AttemptDetailPage } from "@/pages/admin/AttemptDetailPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="organizations" element={<OrganizationsPage />} />
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
        <Route path="exams/:id/scores" element={<ScoreListPage />} />
        <Route path="attempts/:id" element={<AttemptDetailPage />} />
        <Route path="*" element={<PlaceholderPage />} />
      </Route>
      <Route path="/exam" element={<ExamLayout />}>
        <Route path="list" element={<ExamListPage />} />
        <Route path=":examId/start" element={<StartExamPage />} />
        <Route path=":attemptId/take" element={<TakeExamPage />} />
        <Route path=":attemptId/result" element={<ResultPage />} />
        <Route path="*" element={<PlaceholderPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <BrandProvider loadRemote>
        <AuthProvider restoreSession>
          <AppRoutes />
          <Toaster />
        </AuthProvider>
      </BrandProvider>
    </BrowserRouter>
  );
}
