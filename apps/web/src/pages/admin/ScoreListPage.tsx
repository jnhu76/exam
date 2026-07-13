import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { DataToolbar } from "@/components/shared/DataToolbar";
import { RowActions } from "@/components/shared/RowActions";
import { StatsCard } from "@/components/shared/StatsCard";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { FileText } from "lucide-react";

/** Aggregate score statistics for an exam. */
interface ScoreListStats {
  averageScore: number;
  maxScore: number;
  minScore: number;
  passRate: number;
  totalGraded: number;
}

/** A single candidate's score record for an exam attempt. */
interface ScoreListItem {
  attemptId: string;
  candidateId: string;
  candidateName: string;
  candidateFields: Record<string, unknown>;
  examId: string;
  examTitle: string;
  score: number;
  passed: boolean;
  attemptNo: number;
  submittedAt?: string;
}

/** Paginated response containing score items and aggregate stats. */
interface ScoreListResponse {
  items: ScoreListItem[];
  stats: ScoreListStats;
  total: number;
  page: number;
  pageSize: number;
}

/** Admin page for viewing per-candidate scores, stats, and pass/fail filters for a specific exam. */
export function ScoreListPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [scores, setScores] = useState<ScoreListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const page = parseInt(searchParams.get("page") || "1", 10);
  const passFilter = (searchParams.get("passFilter") || "all") as
    | "all"
    | "passed"
    | "failed";

  /** Fetches the score list for the current exam with pagination and pass filter. */
  const loadScores = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("passFilter", passFilter);
      const data = await api.get<ScoreListResponse>(
        `/api/exams/${id}/scores?${params.toString()}`,
      );
      setScores(data);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("admin.scoreList.errors.loadFailed");
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [id, page, passFilter, t]);

  /** Downloads the scores CSV via the authenticated blob helper (cookie auth). */
  const exportScores = useCallback(async () => {
    if (!id || exporting) return;
    setExporting(true);
    try {
      await downloadFile(
        `/api/exams/${id}/export/scores`,
        `scores-exam-${id}.csv`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? t("admin.scoreList.errors.exportFailedWithMsg", {
              message: err.message,
            })
          : t("admin.scoreList.errors.exportFailed"),
      );
    } finally {
      setExporting(false);
    }
  }, [id, exporting, t]);

  useEffect(() => {
    loadScores();
  }, [loadScores]);

  if (isLoading) return <LoadingState />;
  if (error)
    return (
      <ErrorState
        message={error}
        onRetry={loadScores}
        extraAction={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void navigate("/admin/results")}
          >
            {t("admin.scoreList.backToResults")}
          </Button>
        }
      />
    );
  if (!scores)
    return (
      <ErrorState
        message={t("admin.scoreList.errors.dataLoadFailed")}
        onRetry={loadScores}
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${scores.items[0]?.examTitle || t("admin.scoreList.fallbackExamTitle")} - ${t("admin.scoreList.titleSuffix")}`}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void exportScores()}
              disabled={exporting}
            >
              {exporting
                ? t("admin.scoreList.actions.exporting")
                : t("admin.scoreList.actions.export")}
            </Button>
            <Button
              variant="outline"
              onClick={() => void navigate(`/admin/exams/${id}`)}
            >
              {t("admin.scoreList.actions.backToDetail")}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <StatsCard
          label={t("admin.scoreList.stats.average")}
          value={scores.stats.averageScore.toFixed(2)}
        />
        <StatsCard
          label={t("admin.scoreList.stats.max")}
          value={scores.stats.maxScore}
        />
        <StatsCard
          label={t("admin.scoreList.stats.min")}
          value={scores.stats.minScore}
        />
        <StatsCard
          label={t("admin.scoreList.stats.passRate")}
          value={`${(scores.stats.passRate * 100).toFixed(1)}%`}
        />
        <StatsCard
          label={t("admin.scoreList.stats.totalGraded")}
          value={scores.stats.totalGraded}
        />
      </div>

      <DataToolbar aria-label={t("admin.scoreList.filters.label")}>
        <Tabs
          value={passFilter}
          onValueChange={(v) => {
            const newParams = new URLSearchParams(searchParams);
            newParams.set("passFilter", v);
            newParams.delete("page");
            setSearchParams(newParams);
          }}
        >
          <TabsList>
            <TabsTrigger value="all">
              {t("admin.scoreList.filters.all")}
            </TabsTrigger>
            <TabsTrigger value="passed">
              {t("admin.scoreList.filters.passed")}
            </TabsTrigger>
            <TabsTrigger value="failed">
              {t("admin.scoreList.filters.failed")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </DataToolbar>

      <DataTableShell
        title={t("admin.scoreList.listTitle")}
        footer={
          scores.total > scores.pageSize ? (
            <Pagination>
              <PaginationContent>
                {page > 1 && (
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => {
                        const newParams = new URLSearchParams(searchParams);
                        newParams.set("page", String(page - 1));
                        setSearchParams(newParams);
                      }}
                    />
                  </PaginationItem>
                )}
                {Array.from(
                  { length: Math.ceil(scores.total / scores.pageSize) },
                  (_, i) => i + 1,
                ).map((p) => (
                  <PaginationItem key={p}>
                    <PaginationLink
                      isActive={p === page}
                      onClick={() => {
                        const newParams = new URLSearchParams(searchParams);
                        newParams.set("page", String(p));
                        setSearchParams(newParams);
                      }}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                {page < Math.ceil(scores.total / scores.pageSize) && (
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => {
                        const newParams = new URLSearchParams(searchParams);
                        newParams.set("page", String(page + 1));
                        setSearchParams(newParams);
                      }}
                    />
                  </PaginationItem>
                )}
              </PaginationContent>
            </Pagination>
          ) : undefined
        }
      >
        {scores.items.length === 0 ? (
          <EmptyState
            icon={<AppIcon icon={FileText} size="hero" />}
            title={t("admin.scoreList.empty.title")}
            description={t("admin.scoreList.empty.description")}
          />
        ) : (
          <Table>
            <DataTableColumns
              columns={[
                { role: "primary-text" },
                { role: "secondary-text" },
                { role: "score" },
                { role: "status" },
                { role: "date" },
                { role: "actions" },
              ]}
            />
            <TableHeader>
              <TableRow>
                <DataTableHead role="primary-text">
                  {t("admin.scoreList.columns.candidateName")}
                </DataTableHead>
                <DataTableHead role="secondary-text">
                  {t("admin.scoreList.columns.candidateInfo")}
                </DataTableHead>
                <DataTableHead role="score">
                  {t("admin.scoreList.columns.score")}
                </DataTableHead>
                <DataTableHead role="status">
                  {t("admin.scoreList.columns.status")}
                </DataTableHead>
                <DataTableHead role="date">
                  {t("admin.scoreList.columns.submittedAt")}
                </DataTableHead>
                <DataTableHead role="actions">
                  {t("admin.scoreList.columns.actions")}
                </DataTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scores.items.map((item) => (
                <TableRow key={item.attemptId}>
                  <DataTableCell role="primary-text" className="font-medium">
                    {item.candidateName}
                  </DataTableCell>
                  <DataTableCell role="secondary-text">
                    {Object.values(item.candidateFields)
                      .map(String)
                      .join(" / ") || "-"}
                  </DataTableCell>
                  <DataTableCell role="score" className="font-bold">
                    {item.score}
                  </DataTableCell>
                  <DataTableCell role="status">
                    <StatusBadge
                      status={item.passed ? "passed" : "not_passed"}
                    />
                  </DataTableCell>
                  <DataTableCell role="date">
                    {item.submittedAt
                      ? new Date(item.submittedAt).toLocaleString()
                      : "-"}
                  </DataTableCell>
                  <DataTableCell role="actions">
                    <RowActions>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void navigate(`/admin/attempts/${item.attemptId}`)
                        }
                      >
                        {t("admin.scoreList.actions.viewDetail")}
                      </Button>
                    </RowActions>
                  </DataTableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableShell>
    </div>
  );
}
