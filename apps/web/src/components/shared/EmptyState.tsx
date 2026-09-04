import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { AppIcon } from "@/components/shared/AppIcon";
import { cn } from "@/lib/utils";

/** Displays an empty-state placeholder with an icon, title, description, and optional action. */
export function EmptyState({
  icon = <AppIcon icon={Inbox} size="state" />,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center",
        className,
      )}
    >
      <div className="text-muted-foreground" aria-hidden="true">
        {icon}
      </div>
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="type-secondary">{description}</p>
      </div>
      {action}
    </div>
  );
}
