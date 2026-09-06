import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PageSection } from "./PageSection";

/**
 * Grouped form-field section: a titled PageSection whose children lay out in
 * the shared form field grid. Composition, not a second chrome authority —
 * section border/header/description/actions come from PageSection alone.
 * Repeated field PAIRS inside a stack belong to FieldRow (the only
 * multi-column form primitive); a single full-span field declares
 * `col-span-full`.
 */
export function FormSection({
  title,
  description,
  children,
  actions,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <PageSection
      title={title}
      description={description}
      actions={actions}
      className={className}
      contentClassName={cn("grid gap-4", contentClassName)}
    >
      {children}
    </PageSection>
  );
}
