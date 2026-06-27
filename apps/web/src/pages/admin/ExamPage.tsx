import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { RowActions } from "@/components/shared/RowActions";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClipboardList, Eye, Plus, Trash2 } from "lucide-react";
import {
  AdminShell,
  AdminShellHeader,
  AdminToolbar,
  AdminTableShell,
  AdminStatusTag,
} from "@/components/admin";

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
  deleteDisabledReason: string | null;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function ExamPage() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<PaginatedResponse<ExamRow>>("/api/exams");
      setExams(data.items);
    } catch {
      setError("加载考试列表失败");
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
      toast.success("考试已删除");
      await loadExams();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败，请稍后重试");
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadExams} />;

  return (
    <TooltipProvider>
      <AdminShell>
        <AdminShellHeader
          title="考试管理"
          description="创建、发布并管理组织内的考试场次。"
          actions={
            <Button
              variant="primary"
              onClick={() => void navigate("/admin/exams/new")}
            >
              <Plus data-icon="inline-start" />
              创建考试
            </Button>
          }
        />

        {exams.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="size-8" />}
            title="暂无考试"
            description="还没有创建任何考试，点击上方按钮创建。"
          />
        ) : (
          <>
            <AdminToolbar summary={`共 ${exams.length} 场考试`} />
            <AdminTableShell>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>考试名称</TableHead>
                    <TableHead className="w-28">状态</TableHead>
                    <TableHead className="w-56">时间窗口</TableHead>
                    <TableHead className="w-20 text-right">时长</TableHead>
                    <TableHead className="w-20 text-right">题目数</TableHead>
                    <TableHead className="w-20 text-right">参与人数</TableHead>
                    <TableHead className="w-24 text-right">及格分</TableHead>
                    <TableHead className="w-24 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exams.map((exam) => {
                    const deleteButton = (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="删除考试"
                        disabled={!exam.canDelete}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    );

                    return (
                      <TableRow key={exam.id}>
                        <TableCell className="font-medium text-foreground">
                          {exam.title}
                        </TableCell>
                        <TableCell>
                          <AdminStatusTag status={exam.status} />
                        </TableCell>
                        <TableCell className="tabular-nums text-sm text-muted-foreground">
                          {new Date(exam.openAt).toLocaleDateString()} -{" "}
                          {new Date(exam.closeAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {exam.durationMinutes}分钟
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {exam.questionIds.length}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {exam.participantCount}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {exam.passingScore}/{exam.totalScore}
                        </TableCell>
                        <TableCell>
                          <RowActions>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                void navigate(`/admin/exams/${exam.id}`)
                              }
                              aria-label="查看详情"
                            >
                              <Eye />
                            </Button>
                            {exam.canDelete ? (
                              <ConfirmDialog
                                trigger={deleteButton}
                                title="确认删除"
                                description={`确定要删除考试「${exam.title}」吗？`}
                                destructive
                                onConfirm={() => void handleDelete(exam.id)}
                              />
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span tabIndex={0} aria-label="删除考试">
                                    {deleteButton}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {exam.deleteDisabledReason ?? "当前不可删除"}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </RowActions>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </AdminTableShell>
          </>
        )}
      </AdminShell>
    </TooltipProvider>
  );
}
