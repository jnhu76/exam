import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Read-only long-text presentation authority: server-provided / frozen /
 * submitted plain text shown in a read-only well — possibly multiline,
 * possibly very long (candidate answer, standard answer, rubric).
 *
 * Renders children as React text children only: no HTML/Markdown parsing and
 * no dangerouslySetInnerHTML, so markup-looking input always displays as
 * literal text. Owns the typography recipe (type-long-response, which owns
 * `white-space: pre-wrap`), the read-only well surface (surface-subtle), and
 * long-token containment (min-w-0 break-words). Rich answers keep their own
 * authority (ContentDocumentRenderer) and may render as children; callers own
 * layout-only extras (e.g. `min-h-*`) via `className`.
 */
export function ReadOnlyLongText({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "type-long-response surface-subtle min-w-0 rounded-md p-3 break-words",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
