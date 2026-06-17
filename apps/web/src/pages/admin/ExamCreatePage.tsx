import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
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
import { Separator } from "@/components/ui/separator";
import { BookOpen, Trash2 } from "lucide-react";
import { TYPE_LABELS } from "@/lib/constants";

/** A course record used in the course selector dropdown. */
/** Minimal course representation used in the exam creation form. */
interface CourseRow {
  id: string;
  name: string;
}

/** A question record shown in the exam question picker dialog. */
/** Minimal question representation used in the exam creation form. */
interface QuestionRow {
  id: string;
  type: string;
  content: string;
  score: number;
}

/** Generic paginated API response wrapper. */
/** Paginated API response wrapper. */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

/**
 * Admin page for creating a new exam with configuration form,
 * manual question selection dialog, and draft/publish actions.
 */
/**
 * Admin page for creating a new exam.
 * Provides a two-column layout with the ExamConfigForm for metadata/settings
 * and a question picker for manual question selection, plus draft/publish actions.
 */
export function ExamCreatePage() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [questionDialogOpen, setQuestionDialogOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
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

  /** Fetches available courses and questions, defaulting to the first course. */
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

  /** Adds a question to the selected question list if not already present. */
  function addQuestion(qId: string) {
    if (!config.questionIds.includes(qId)) {
      setConfig((prev) => ({
        ...prev,
        questionIds: [...prev.questionIds, qId],
      }));
    }
  }

  /** Removes a question from the selected question list. */
  function removeQuestion(qId: string) {
    setConfig((prev) => ({
      ...prev,
      questionIds: prev.questionIds.filter((id) => id !== qId),
    }));
  }

  /** Validates the form, creates the exam, and optionally publishes it. */
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
    setSaveError(null);
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
    } catch (err) {
      const message = getApiErrorMessage(err, "保存失败，请稍后重试");
      setSaveError(message);
      toast.error(message);
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
    <div className="flex flex-col gap-6">
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

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              已选题目 ({config.questionIds.length})
            </h3>
            <Button size="sm" onClick={() => setQuestionDialogOpen(true)}>
              手动选题
            </Button>
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
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Separator />
      {saveError && <InlineErrorBanner>{saveError}</InlineErrorBanner>}
      <div className="flex justify-end gap-3 pt-4">
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
        <DialogContent
          aria-describedby={undefined}
          className="max-w-2xl max-h-[80vh] overflow-y-auto"
        >
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
