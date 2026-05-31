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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="organizations" element={<OrganizationsPage />} />
        <Route path="*" element={<PlaceholderPage />} />
      </Route>
      <Route path="/exam" element={<ExamLayout />}>
        <Route path="*" element={<PlaceholderPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <BrandProvider>
        <AuthProvider>
          <AppRoutes />
          <Toaster />
        </AuthProvider>
      </BrandProvider>
    </BrowserRouter>
  );
}
