import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Closed page role vocabulary (authority: docs/standards/ui-system.md
 * "page container roles"). Seven roles, no aliases: a page that fits none of
 * them is an architecture decision, not a local width. The role→max-width
 * mapping is the `roleClasses` table below.
 * INVARIANT: the role vocabulary is closed and the retired `admin-sparse` must
 * not be re-added — re-adding a role requires vocabulary authority review.
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
