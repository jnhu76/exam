import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ExamConfigForm,
  type ExamConfigData,
} from "@/components/exam/ExamConfigForm";
import { BookOpen, Trash2 } from "lucide-react";
import { TYPE_LABELS } from "@/lib/constants";

interface CourseRow {
  id: string;
  name: string;
}

interface QuestionRow {
  id: string;
  type: string;
  content: string;
  score: number;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

export function ExamCreatePage() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [questionDialogOpen, setQuestionDialogOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<ExamConfigData>({
    title: "",
    description: "",
    courseId: "",
    durationMinutes: 60,
    openAt: "",
    closeAt: "",
    passingScore: 60,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: [],
    controlFlags: {
      shuffleQuestions: false,
      shuffleOptions: false,
      detectTabSwitch: false,
      disableCopyPaste: false,
      requireQueue: false,
      batchSize: 10,
      batchInterval: 3,
      restrictIp: false,
      requireLockdown: false,
      showResultImmediately: true,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 1,
  });

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [cData, qData] = await Promise.all([
        api.get<PaginatedResponse<CourseRow>>("/api/courses"),
        api.get<PaginatedResponse<QuestionRow>>("/api/questions"),
      ]);
      setCourses(cData.items);
      setQuestions(qData.items);
      if (cData.items.length > 0 && !config.courseId) {
        const first = cData.items[0];
        if (first) {
          setConfig((prev) => ({ ...prev, courseId: first.id }));
        }
      }
    } catch {
      setError("加载数据失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function addQuestion(qId: string) {
    if (!config.questionIds.includes(qId)) {
      setConfig((prev) => ({
        ...prev,
        questionIds: [...prev.questionIds, qId],
      }));
    }
  }

  function removeQuestion(qId: string) {
    setConfig((prev) => ({
      ...prev,
      questionIds: prev.questionIds.filter((id) => id !== qId),
    }));
  }

  async function handleSave(asDraft: boolean) {
    const errors: Record<string, string> = {};
    if (!config.title.trim()) errors.title = "请输入考试名称";
    if (!config.courseId) errors.courseId = "请选择课程";
    if (
      config.openAt &&
      config.closeAt &&
      new Date(config.closeAt) <= new Date(config.openAt)
    ) {
      errors.time = "结束时间必须晚于开始时间";
    }
    if (config.passingScore > config.totalScore) {
      errors.score = "及格分不能超过总分";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("请修正表单中的错误");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...config,
        openAt: config.openAt
          ? new Date(config.openAt).toISOString()
          : new Date().toISOString(),
        closeAt: config.closeAt
          ? new Date(config.closeAt).toISOString()
          : new Date(Date.now() + 86400000).toISOString(),
      };
      const exam = await api.post<{ id: string }>("/api/exams", payload);

      if (!asDraft) {
        await api.post(`/api/exams/${exam.id}/publish`);
      }

      if (!asDraft) {
        toast.success("考试创建并发布成功");
      } else {
        toast.success("考试已保存为草稿");
      }
      void navigate("/admin/exams");
    } catch {
      toast.error("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  const selectedQuestions = questions.filter((q) =>
    config.questionIds.includes(q.id),
  );
  const availableQuestions = questions.filter(
    (q) => !config.questionIds.includes(q.id),
  );

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;

  return (
    <div className="space-y-6">
      <PageHeader title="创建考试" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <ExamConfigForm
            courses={courses}
            questions={questions.map((q) => ({ id: q.id, score: q.score }))}
            data={config}
            onChange={setConfig}
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              已选题目 ({config.questionIds.length})
            </h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled title="Phase 2">
                随机选题 [Phase 2]
              </Button>
              <Button size="sm" onClick={() => setQuestionDialogOpen(true)}>
                手动选题
              </Button>
            </div>
          </div>

          {selectedQuestions.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="size-8" />}
              title="尚未选择题目"
              description="请点击「手动选题」按钮选择题目。"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">题型</TableHead>
                  <TableHead>题目内容</TableHead>
                  <TableHead className="w-16">分值</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedQuestions.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell>
                      <Badge variant="outline">
                        {TYPE_LABELS[q.type] ?? q.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[250px] truncate">
                      {q.content}
                    </TableCell>
                    <TableCell>{q.score}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeQuestion(q.id)}
                        aria-label="删除题目"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t pt-4">
        <Button variant="outline" onClick={() => void navigate("/admin/exams")}>
          取消
        </Button>
        <Button
          variant="outline"
          onClick={() => void handleSave(true)}
          disabled={saving}
        >
          {saving ? "保存中..." : "保存草稿"}
        </Button>
        <Button onClick={() => void handleSave(false)} disabled={saving}>
          {saving ? "发布中..." : "发布考试"}
        </Button>
      </div>

      <Dialog open={questionDialogOpen} onOpenChange={setQuestionDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>选择题目</DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">题型</TableHead>
                <TableHead>题目内容</TableHead>
                <TableHead className="w-16">分值</TableHead>
                <TableHead className="w-16">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {availableQuestions.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>
                    <Badge variant="outline">
                      {TYPE_LABELS[q.type] ?? q.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate">
                    {q.content}
                  </TableCell>
                  <TableCell>{q.score}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => addQuestion(q.id)}
                    >
                      添加
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setQuestionDialogOpen(false)}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
