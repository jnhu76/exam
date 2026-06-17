import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
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
 * page numbers, and previous/next navigation buttons.
 */
export function DataTablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
  "aria-label": ariaLabel = "表格分页",
}: DataTablePaginationProps) {
  const safePageSize = pageSize > 0 ? pageSize : 1;
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const startItem = total === 0 ? 0 : (currentPage - 1) * safePageSize + 1;
  const endItem = Math.min(total, currentPage * safePageSize);
  const visiblePages = buildVisiblePages(currentPage, pageCount);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div aria-live="polite">
        共 {total} 条，显示 {startItem}-{endItem} 条
      </div>
      <Pagination aria-label={ariaLabel} className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(currentPage - 1)}
            >
              <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
              上一页
            </Button>
          </PaginationItem>
          {visiblePages.map((pageNumber) => (
            <PaginationItem key={pageNumber}>
              <PaginationLink
                href="#"
                isActive={pageNumber === currentPage}
                aria-label={`第 ${pageNumber} 页`}
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
              下一页
              <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
