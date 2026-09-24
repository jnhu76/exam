import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * The single data-view footer authority (issue 601 Phase F convergence).
 *
 * The census found three footer/count homes across the 24 data-view routes —
 * `DataWorkbenchFooter`, `DataTableShell`'s footer prop, and `DataToolbar`'s
 * `summary` slot (one production consumer) — so a count could appear in a
 * toolbar band, in a title band, in a shell band, or nowhere, depending on the
 * page. This component owns the count/range placement, the footer spacing, the
 * footer surface and the navigation placement for EVERY data view; the
 * navigation BEHAVIOUR stays semantically distinct and is passed in as a slot
 * (page-number pagination, cursor prev/next, load-more) — there is no fake
 * unified pagination API.
 *
 *   band       — the standard shell's footer region: the shell draws the
 *                surface (border-t + tinted fill), this component draws the row.
 *   continuous — the workbench's continuous-surface variant: the same grammar
 *                as a region of the single shell (workbench.css draws the
 *                separator).
 *
 * A lone count is a summary, not a control: it belongs in this footer (or, for
 * a view whose count belongs with its title, in the shell's title-band `meta`
 * slot) — never in a toolbar controls band of its own.
 */
export function DataViewFooter({
  summary,
  range,
  navigation,
  variant = "band",
  className,
  "aria-label": ariaLabel,
}: {
  /** Count / range / summary line (left slot), for a count this footer does
   * not derive from a page range (a cursor feed's page info, a filter result
   * count). */
  summary?: ReactNode;
  /**
   * The paginated range to summarize ("第 1–20 条，共 43 条") — the ONE
   * formatter for a page range, so the copy cannot drift between pages.
   */
  range?: { page: number; pageSize: number; total: number };
  /** Navigation control (right slot) — page numbers, prev/next, or load-more. */
  navigation?: ReactNode;
  variant?: "band" | "continuous";
  className?: string;
  "aria-label"?: string;
}) {
  const { t } = useTranslation();
  let summaryNode = summary;
  if (range !== undefined) {
    const pageSize = range.pageSize > 0 ? range.pageSize : 1;
    const pageCount = Math.max(1, Math.ceil(range.total / pageSize));
    const page = Math.min(Math.max(range.page, 1), pageCount);
    const start = range.total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(range.total, page * pageSize);
    summaryNode = t("common.table.summary", {
      total: range.total,
      start,
      end,
    });
  }
  return (
    <div
      data-slot="data-view-footer"
      data-footer-variant={variant}
      aria-label={ariaLabel}
      className={cn(
        "flex flex-col gap-3 type-secondary sm:flex-row sm:items-center sm:justify-between",
        variant === "band" ? "px-4 py-3" : "px-3 py-2",
        className,
      )}
    >
      {summaryNode != null && <div aria-live="polite">{summaryNode}</div>}
      {navigation != null && (
        <div className="flex items-center justify-end gap-2">{navigation}</div>
      )}
    </div>
  );
}
