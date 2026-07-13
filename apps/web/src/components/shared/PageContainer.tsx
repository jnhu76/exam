import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PageContainerRole =
  | "admin-standard"
  | "admin-wide"
  | "form"
  | "auth"
  | "exam-runtime";

const roleClasses: Record<PageContainerRole, string> = {
  "admin-standard": "max-w-7xl",
  "admin-wide": "max-w-screen-2xl",
  form: "max-w-4xl",
  auth: "max-w-md",
  "exam-runtime": "max-w-7xl",
};

export function PageContainer({
  role = "admin-standard",
  children,
  className,
}: {
  role?: PageContainerRole;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="page-container"
      data-role={role}
      className={cn("mx-auto w-full", roleClasses[role], className)}
    >
      {children}
    </div>
  );
}
