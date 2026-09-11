import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Description-metadata presentation authority: a read-only label → value
 * definition list (exam facts, attempt facts, incident facts). Not a dashboard
 * metric (StatsCard), form field (FieldGroup), or table row (DataTableContract).
 *
 * Owns the HTML semantics (dl > div > dt + dd), the label/value typography
 * (type-metadata / type-body), and long-value containment (values wrap, never
 * silently truncate). Layout is page-owned structure, not a component opinion:
 * consumers pass their stack/grid utilities via `className`; per-row
 * structural overrides (full-span, inline row) go through the item's
 * `className`.
 */
export interface DefinitionListItem {
  label: ReactNode;
  value: ReactNode;
  /** Page-owned structural classes for the row wrapper (e.g. `sm:col-span-2`). */
  className?: string;
}

export function DefinitionList({
  items,
  className,
}: {
  items: DefinitionListItem[];
  className?: string;
}) {
  return (
    <dl className={className}>
      {items.map((item, index) => (
        // Index key: items are a static per-render declaration, not a
        // reordered collection.
        <div key={index} className={cn("min-w-0", item.className)}>
          <dt className="type-metadata break-words">{item.label}</dt>
          <dd className="type-body min-w-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
