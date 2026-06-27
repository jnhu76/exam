import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  AdminShell,
  AdminShellHeader,
  AdminTableShell,
} from "@/components/admin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { ClipboardCheck } from "lucide-react";

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
      setError("加载评分队列失败");
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
      <AdminShell>
        <AdminShellHeader title="待评分" description="管理需要手动评分的试卷" />
        <EmptyState
          icon={<ClipboardCheck className="size-8" />}
          title="暂无待评分的试卷"
          description="当前没有需要手动评分的试卷"
        />
      </AdminShell>
    );
  }

  const totalPages = Math.ceil(data.total / pageSize);

  return (
    <AdminShell>
      <AdminShellHeader title="待评分" description="管理需要手动评分的试卷" />
      <AdminTableShell>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>考生</TableHead>
              <TableHead>考试</TableHead>
              <TableHead>提交时间</TableHead>
              <TableHead>待评题数</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((item) => (
              <TableRow
                key={item.attemptId}
                data-testid={`grading-queue-row-${item.attemptId}`}
                className="cursor-pointer"
                onClick={() =>
                  navigate(`/admin/grading-queue/${item.attemptId}`)
                }
              >
                <TableCell className="font-medium">
                  {item.candidateName}
                </TableCell>
                <TableCell>{item.examTitle}</TableCell>
                <TableCell>
                  {item.submittedAt
                    ? new Date(item.submittedAt).toLocaleString("zh-CN")
                    : "-"}
                </TableCell>
                <TableCell>{item.pendingQuestionCount}</TableCell>
                <TableCell>
                  <StatusBadge status={item.gradingStatus} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminTableShell>
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
    </AdminShell>
  );
}
