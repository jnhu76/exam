import { Outlet } from "react-router";
import { BrandHeader } from "./BrandHeader";

export function ExamLayout() {
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
