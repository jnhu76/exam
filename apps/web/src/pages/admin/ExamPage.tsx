import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClipboardList, Eye, Plus, Trash2 } from "lucide-react";

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
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const statusLabels: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  open: "进行中",
  closed: "已结束",
  archived: "已归档",
};

const statusVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  published: "default",
  open: "default",
  closed: "secondary",
  archived: "outline",
};

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
    await api.delete(`/api/exams/${id}`);
    await loadExams();
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadExams} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="考试管理"
        actions={
          <Button onClick={() => void navigate("/admin/exams/new")}>
            <Plus className="size-4" />
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>考试名称</TableHead>
              <TableHead className="w-20">状态</TableHead>
              <TableHead>时间窗口</TableHead>
              <TableHead className="w-16">时长</TableHead>
              <TableHead className="w-16">题目数</TableHead>
              <TableHead className="w-16">参与人数</TableHead>
              <TableHead className="w-16">及格分</TableHead>
              <TableHead className="w-24">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exams.map((exam) => (
              <TableRow key={exam.id}>
                <TableCell className="font-medium">{exam.title}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant[exam.status] ?? "outline"}>
                    {statusLabels[exam.status] ?? exam.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(exam.openAt).toLocaleDateString()} -{" "}
                  {new Date(exam.closeAt).toLocaleDateString()}
                </TableCell>
                <TableCell>{exam.durationMinutes}分钟</TableCell>
                <TableCell>{exam.questionIds.length}</TableCell>
                <TableCell>{exam.participantCount}</TableCell>
                <TableCell>
                  {exam.passingScore}/{exam.totalScore}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void navigate(`/admin/exams/${exam.id}`)}
                    >
                      <Eye className="size-4" />
                    </Button>
                    {exam.status === "draft" && (
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="icon">
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        }
                        title="确认删除"
                        description={`确定要删除考试「${exam.title}」吗？`}
                        destructive
                        onConfirm={() => void handleDelete(exam.id)}
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
