import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { MobileRecordList } from "@/components/shared/MobileRecordList";
import {
  DesktopDataTable,
  type DataViewColumnDef,
} from "@/components/shared/DesktopDataTable";
import {
  RowActions,
  type RowActionDeclaration,
} from "@/components/shared/RowActions";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClipboardList, Eye, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { canCreateExam, canDeleteExam } from "@/lib/capabilities";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { deleteDisabledReasonKey } from "@/lib/examDisabledReasons";
import type { DeleteDisabledReasonCode } from "@exam/contracts";

/** Row shape returned by the exams list API. */
interface ExamRow {
  id: string;
  title: string;
  status: string;
  openAt: string;
  closeAt: string;
  durationMinutes: number;
  passingScore: number;
  totalScore: number;
  questionIds: string[];
  participantCount: number;
  canDelete: boolean;
  deleteDisabledReasonCode: DeleteDisabledReasonCode | null;
  /** Legacy natural-language sibling — compatibility fallback only (D0.8). */
  deleteDisabledReason: string | null;
}

/** Generic paginated API response wrapper. */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Admin page for listing, viewing, and deleting exams.
 * UI-KOI-WEGENT-VISUAL-PIVOT-1: Removed empty count strip. Count moved into
 * toolbar summary. Admin table with distinct header, clear boundaries.
 */
export function ExamPage() {
  const { t } = useTranslation();
  const { formatDateRange } = useProductDateTime();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mayCreateExam = user ? canCreateExam(user) : false;
  const mayDeleteExam = user ? canDeleteExam(user) : false;

  /**
   * Tooltip explanation why deletion is blocked. The machine
   * DisabledReasonCode is authoritative (D0.8); the legacy natural-language
   * wire field only covers unknown future codes.
   */
  function deleteDisabledReasonPresentation(exam: ExamRow): string {
    const code = exam.deleteDisabledReasonCode;
    if (code) {
      const key = deleteDisabledReasonKey(code);
      if (key) return t(key);
    }
    return exam.deleteDisabledReason ?? t("admin.exams.deleteDisabled");
  }

  const loadExams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<PaginatedResponse<ExamRow>>("/api/exams");
      setExams(data.items);
    } catch {
      setError(t("admin.exams.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/exams/${id}`);
      toast.success(t("admin.exams.toast.deleted"));
      await loadExams();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.exams.toast.deleteFailed")),
      );
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadExams} />;

  // Single-source column declarations (issue 457): desktop table and mobile
  // cards render from the same array. The time window joins the meta line —
  // without the override it would be dropped (date-range defaults to low),
  // losing the exam's availability window on mobile.
  const columns: DataViewColumnDef<ExamRow>[] = [
    {
      id: "title",
      meta: { role: "primary-text" },
      header: t("admin.exams.columns.title"),
      cell: ({ row }) => row.original.title,
    },
    {
      id: "status",
      meta: { role: "status" },
      header: t("admin.exams.columns.status"),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "timeWindow",
      meta: { role: "date-range", priority: "normal" },
      header: t("admin.exams.columns.timeWindow"),
      cell: ({ row }) => (
        <span className="type-secondary">
          {formatDateRange(row.original.openAt, row.original.closeAt)}
        </span>
      ),
    },
    {
      id: "duration",
      meta: { role: "duration" },
      header: t("admin.exams.columns.duration"),
      cell: ({ row }) =>
        t("admin.exams.duration", { min: row.original.durationMinutes }),
    },
    {
      id: "questionCount",
      meta: { role: "number" },
      header: t("admin.exams.columns.questionCount"),
      cell: ({ row }) => row.original.questionIds.length,
    },
    {
      id: "participantCount",
      meta: { role: "number" },
      header: t("admin.exams.columns.participants"),
      cell: ({ row }) => row.original.participantCount,
    },
    {
      id: "passingScore",
      meta: { role: "score" },
      header: t("admin.exams.columns.passingScore"),
      cell: ({ row }) =>
        `${row.original.passingScore}/${row.original.totalScore}`,
    },
    {
      id: "actions",
      meta: { role: "actions" },
      header: t("admin.exams.columns.actions"),
      cell: ({ row }) => {
        const exam = row.original;
        return (
          <RowActions
            row={exam}
            actions={[
              {
                id: "view",
                label: t("admin.exams.viewDetail"),
                icon: Eye,
                onSelect: () => void navigate(`/admin/exams/${exam.id}`),
              },
              ...(mayDeleteExam
                ? ([
                    {
                      id: "delete",
                      label: t("admin.exams.deleteLabel"),
                      icon: Trash2,
                      tone: "destructive",
                      disabled: exam.canDelete
                        ? false
                        : {
                            reason: deleteDisabledReasonPresentation(exam),
                          },
                      confirm: {
                        title: t("admin.exams.confirmDelete"),
                        description: t("admin.exams.confirmDeleteDescription", {
                          title: exam.title,
                        }),
                        destructive: true,
                      },
                      onSelect: () => void handleDelete(exam.id),
                    },
                  ] as RowActionDeclaration<typeof exam>[])
                : []),
            ]}
          />
        );
      },
    },
  ];

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t("admin.exams.title")}
          actions={
            mayCreateExam ? (
              <Button onClick={() => void navigate("/admin/exams/new")}>
                <AppIcon icon={Plus} size="inline" />
                {t("admin.exams.createBtn")}
              </Button>
            ) : undefined
          }
        />

        {exams.length === 0 ? (
          <EmptyState
            icon={<AppIcon icon={ClipboardList} size="state" />}
            title={t("admin.exams.empty")}
            description={t("admin.exams.emptyDescription")}
          />
        ) : (
          <>
            <DataTableShell
              title={t("admin.exams.listTitle")}
              description={t("admin.exams.listDescription")}
              toolbar={
                <span className="type-secondary">
                  {t("admin.exams.summary", { count: exams.length })}
                </span>
              }
              mobile={
                <MobileRecordList
                  columns={columns}
                  rows={exams}
                  getRowId={(e) => e.id}
                />
              }
            >
              <DesktopDataTable
                columns={columns}
                data={exams}
                getRowId={(e) => e.id}
              />
            </DataTableShell>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
