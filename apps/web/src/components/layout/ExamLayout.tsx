import { Navigate, Outlet } from "react-router";
import { BrandHeader } from "./BrandHeader";
import { useAuth } from "@/hooks/useAuth";
import { LoadingState } from "@/components/shared/LoadingState";

export function ExamLayout() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingState />;
  if (!user || user.role !== "Candidate") {
    return <Navigate to="/login" replace />;
  }
  return (
    <div data-testid="exam-layout" className="min-h-screen bg-background">
      <header className="flex min-h-14 items-center border-b px-4">
        <BrandHeader />
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
