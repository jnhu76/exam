import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DesktopDataTable,
  type DataViewColumnDef,
} from "@/components/shared/DesktopDataTable";
import { MobileRecordList } from "@/components/shared/MobileRecordList";
import { PageContainer } from "@/components/shared/PageContainer";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { ListChecks } from "lucide-react";

interface GradingQueueItem {
  attemptId: string;
  examId: string;
  examTitle: string;
  candidateId: string;
  candidateName: string;
  submittedAt: string | null;
  gradingStatus: string;
  pendingQuestionCount: number;
}

interface GradingQueueResponse {
  items: GradingQueueItem[];
  total: number;
  page: number;
  pageSize: number;
}

export function GradingQueuePage() {
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();
  const navigate = useNavigate();
  const [data, setData] = useState<GradingQueueResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const loadQueue = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      const result = await api.get<GradingQueueResponse>(
        `/api/admin/grading-queue?${params}`,
      );
      setData(result);
    } catch {
      setError(t("admin.grading.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadQueue} />;
  if (!data || data.items.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t("admin.grading.title")}
          description={t("admin.grading.description")}
        />
        <EmptyState
          icon={<AppIcon icon={ListChecks} size="state" />}
          title={t("admin.grading.empty")}
          description={t("admin.grading.emptyDescription")}
        />
      </div>
    );
  }

  const totalPages = Math.ceil(data.total / pageSize);

  // Single-source column declarations (issue 457): desktop table and mobile
  // cards render from the same array; rows activate on click in both.
  const columns: DataViewColumnDef<GradingQueueItem>[] = [
    {
      id: "candidate",
      meta: { role: "primary-text" },
      header: t("admin.grading.columns.candidate"),
      cell: ({ row }) => row.original.candidateName,
    },
    {
      id: "exam",
      meta: { role: "secondary-text" },
      header: t("admin.grading.columns.exam"),
      cell: ({ row }) => row.original.examTitle,
    },
    {
      id: "submittedAt",
      meta: { role: "date" },
      header: t("admin.grading.columns.submittedAt"),
      cell: ({ row }) =>
        row.original.submittedAt
          ? formatDateTime(row.original.submittedAt)
          : "-",
    },
    {
      id: "pendingCount",
      meta: { role: "number" },
      header: t("admin.grading.columns.pendingCount"),
      cell: ({ row }) => row.original.pendingQuestionCount,
    },
    {
      id: "status",
      meta: { role: "status" },
      header: t("admin.grading.columns.status"),
      cell: ({ row }) => <StatusBadge status={row.original.gradingStatus} />,
    },
  ];

  return (
    <PageContainer role="admin-standard" className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.grading.title")}
        description={t("admin.grading.description")}
      />
      <DataTableShell
        mobile={
          <MobileRecordList
            columns={columns}
            rows={data.items}
            getRowId={(i) => i.attemptId}
            onRowClick={(item) =>
              navigate(`/admin/grading-queue/${item.attemptId}`)
            }
          />
        }
      >
        <DesktopDataTable
          columns={columns}
          data={data.items}
          rowCount={data.total}
          page={page}
          pageSize={pageSize}
          getRowId={(i) => i.attemptId}
          getRowTestId={(i) => `grading-queue-row-${i.attemptId}`}
          onRowClick={(item) =>
            navigate(`/admin/grading-queue/${item.attemptId}`)
          }
        />
      </DataTableShell>
      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-disabled={page === 1}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink
                  isActive={p === page}
                  onClick={() => setPage(p)}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-disabled={page === totalPages}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </PageContainer>
  );
}
