import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Closed page role vocabulary (issue 445 P3 §4; issue 455; issue 601). Seven
 * roles, no aliases: a page that fits none of them is an architecture
 * decision, not a local width. Widths map to Tailwind max-w utilities: auth
 * 448 (max-w-md), form + candidate 896 (max-w-4xl), admin-standard +
 * exam-runtime 1280 (max-w-7xl), admin-dense 1440 (max-w-[90rem]), admin-wide
 * 1536 (max-w-screen-2xl).
 * INVARIANT: the former `admin-sparse` (1024) is merged into admin-standard —
 * re-adding a role requires vocabulary authority review. `admin-dense` is the
 * issue 601 Phase C bounded policy for the dense admin table routes
 * (users/questions/exams): 1440 is the selected cap, adopted as policy — the
 * evidence does not distinguish it from 1536 on wider viewports.
 */
export type PageContainerRole =
  | "admin-standard"
  | "admin-dense"
  | "admin-wide"
  | "form"
  | "auth"
  | "candidate"
  | "exam-runtime";

const roleClasses: Record<PageContainerRole, string> = {
  "admin-standard": "max-w-7xl",
  "admin-dense": "max-w-[90rem]",
  "admin-wide": "max-w-screen-2xl",
  form: "max-w-4xl",
  auth: "max-w-md",
  candidate: "max-w-4xl",
  "exam-runtime": "max-w-7xl",
};

export function PageContainer({
  role = "admin-standard",
  children,
  className,
  ...rest
}: {
  role?: PageContainerRole;
  children: ReactNode;
} & Omit<ComponentProps<"div">, "role" | "children">) {
  return (
    <div
      data-slot="page-container"
      data-role={role}
      className={cn("mx-auto w-full", roleClasses[role], className)}
      {...rest}
    >
      {children}
    </div>
  );
}
