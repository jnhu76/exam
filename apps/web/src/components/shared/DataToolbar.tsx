import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * Toolbar for data/list pages: optional search slot, filter children, action
 * buttons, and a summary line with responsive layout. The single toolbar
 * authority. Default accessible label resolves from `common.toolbar.dataLabel`;
 * explicit prop wins.
 */
export function DataToolbar({
  search,
  children,
  actions,
  summary,
  "aria-label": ariaLabel,
  className,
}: {
  search?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
  "aria-label"?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = ariaLabel ?? t("common.toolbar.dataLabel");
  return (
    <div
      role="toolbar"
      aria-label={label}
      data-toolbar-appearance="quiet"
      className={cn(
        "flex min-h-14 flex-col gap-3 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        {search != null && (
          <div
            data-slot="toolbar-search"
            className="w-full min-w-0 shrink-0 sm:w-72 lg:w-80"
          >
            {search}
          </div>
        )}
        {children != null && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {children}
          </div>
        )}
      </div>
      {(summary || actions) && (
        <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
          {summary && <div className="type-secondary">{summary}</div>}
          {actions}
        </div>
      )}
    </div>
  );
}
