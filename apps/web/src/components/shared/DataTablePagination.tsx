import { useTranslation } from "react-i18next";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppIcon } from "@/components/shared/AppIcon";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

/** Props for the DataTablePagination component. */
type DataTablePaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
  "aria-label"?: string;
};

/** Computes a window of up to 3 visible page numbers around the current page. */
function buildVisiblePages(page: number, pageCount: number) {
  const start = Math.max(1, page - 1);
  const end = Math.min(pageCount, start + 2);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

/**
 * Pagination controls for data tables, showing item count summary,
 * page numbers, and previous/next navigation buttons. All copy resolves from
 * `common.table.*` with interpolation; explicit `aria-label` wins over the
 * Page-number navigation for data tables.
 *
 * It owns the NAVIGATION only: page numbers plus previous/next. The count /
 * range line lives in DataViewFooter (the single footer/count composition
 * authority, issue 601 Phase F convergence) — a pagination control that also
 * rendered its own summary was a second, parallel count authority.
 *
 * All copy resolves from `common.table.*` with interpolation; explicit
 * `aria-label` wins over the default `common.table.paginationLabel`.
 */
export function DataTablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
  "aria-label": ariaLabel,
}: DataTablePaginationProps) {
  const { t } = useTranslation();
  const safePageSize = pageSize > 0 ? pageSize : 1;
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const visiblePages = buildVisiblePages(currentPage, pageCount);
  const label = ariaLabel ?? t("common.table.paginationLabel");

  return (
    <Pagination
      aria-label={label}
      className={cn("mx-0 w-auto justify-end", className)}
    >
      <PaginationContent>
        <PaginationItem>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            <AppIcon icon={ChevronLeftIcon} size="inline" />
            {t("common.table.prev")}
          </Button>
        </PaginationItem>
        {visiblePages.map((pageNumber) => (
          <PaginationItem key={pageNumber}>
            <PaginationLink
              href="#"
              isActive={pageNumber === currentPage}
              aria-label={t("common.table.pageLabel", { page: pageNumber })}
              onClick={(event) => {
                event.preventDefault();
                onPageChange(pageNumber);
              }}
            >
              {pageNumber}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage >= pageCount}
            onClick={() => onPageChange(currentPage + 1)}
          >
            {t("common.table.next")}
            <AppIcon icon={ChevronRightIcon} size="inline" />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
