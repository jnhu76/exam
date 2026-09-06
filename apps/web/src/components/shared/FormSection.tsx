import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PageSection } from "./PageSection";

/**
 * Grouped form-field section: a titled PageSection whose children lay out in
 * the shared form field grid. Composition, not a second chrome authority —
 * section border/header/description/actions come from PageSection alone.
 *
 * `columns={2}` lays a whole homogeneous section out in two columns from the
 * sm breakpoint up (one column below); a single full-span field declares
 * `col-span-full`. Embedded field PAIRS inside a stack use FieldRow instead —
 * FormSection columns is not for mixed single/pair compositions.
 */
export function FormSection({
  title,
  description,
  children,
  actions,
  className,
  contentClassName,
  columns = 1,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
  /** 1 = single column (default); 2 = two columns at sm+ (FieldRow owns pairs). */
  columns?: 1 | 2;
}) {
  return (
    <PageSection
      title={title}
      description={description}
      actions={actions}
      className={className}
      contentClassName={cn(
        "grid gap-4",
        columns === 2 && "sm:grid-cols-2",
        contentClassName,
      )}
    >
      {children}
    </PageSection>
  );
}
