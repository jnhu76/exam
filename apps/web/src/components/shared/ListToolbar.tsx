import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Props for the ListToolbar component. */
type ListToolbarProps = {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
  className?: string;
  "aria-label"?: string;
  appearance?: "default" | "quiet";
};

/**
 * Toolbar for list pages with slots for search input, filter controls,
 * action buttons, and a summary line. Responsive layout adapts to screen size.
 * Default accessible label resolves from `common.toolbar.listLabel`.
 */
export function ListToolbar({
  search,
  filters,
  actions,
  summary,
  className,
  "aria-label": ariaLabel,
  appearance = "quiet",
}: ListToolbarProps) {
  const { t } = useTranslation();
  const label = ariaLabel ?? t("common.toolbar.listLabel");
  return (
    <div
      role="toolbar"
      aria-label={label}
      data-toolbar-appearance={appearance}
      className={cn(
        "flex min-h-14 flex-col gap-3 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between",
        appearance === "quiet" && "px-3 py-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center">
        {search != null && (
          <div
            data-slot="toolbar-search"
            className="min-w-0 shrink-0 lg:w-72 lg:max-w-md xl:w-80"
          >
            {search}
          </div>
        )}
        {filters != null && (
          <div
            data-slot="toolbar-filters"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          >
            {filters}
          </div>
        )}
      </div>
      {(summary != null || actions != null) && (
        <div className="flex shrink-0 items-center justify-between gap-2 lg:justify-end">
          {summary != null && <div className="type-secondary">{summary}</div>}
          {actions != null && (
            <div className="flex items-center gap-2">{actions}</div>
          )}
        </div>
      )}
    </div>
  );
}
