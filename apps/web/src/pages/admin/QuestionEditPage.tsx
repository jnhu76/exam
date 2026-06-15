import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  QuestionForm,
  type QuestionFormData,
} from "@/components/question/QuestionForm";
import { QuestionPreview } from "@/components/question/QuestionPreview";

interface CourseRow {
  id: string;
  name: string;
  code: string;
}

export function QuestionEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined && id !== "new";

  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [formData, setFormData] = useState<QuestionFormData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const cData = await api.get<{ items: CourseRow[] }>("/api/courses");
      setCourses(cData.items);

      if (isEdit) {
        const q = await api.get<{
          courseId: string;
          type: string;
          content: string;
          options: Array<{ id: string; content: string; isCorrect?: boolean }>;
          standardAnswer: unknown;
          score: number;
          difficulty: number;
          tags: string[];
          gradingRule: {
            multiSelectScoring: string;
            fillBlankMatchMode: string;
          };
        }>(`/api/questions/${id}`);
        setFormData({
          courseId: q.courseId,
          type: q.type as QuestionFormData["type"],
          content: q.content,
          options: q.options,
          standardAnswer: q.standardAnswer,
          score: q.score,
          difficulty: q.difficulty,
          tags: q.tags,
          gradingRule: q.gradingRule as QuestionFormData["gradingRule"],
        });
      } else {
        setFormData({
          courseId: cData.items[0]?.id ?? "",
          type: "single_choice",
          content: "",
          options: [
            { id: "A", content: "" },
            { id: "B", content: "" },
          ],
          standardAnswer: "",
          score: 10,
          difficulty: 3,
          tags: [],
          gradingRule: {
            multiSelectScoring: "all_correct_full",
            fillBlankMatchMode: "exact",
          },
        });
      }
    } catch {
      setError("加载数据失败");
    } finally {
      setIsLoading(false);
    }
  }, [id, isEdit]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSave() {
    if (!formData || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/api/questions/${id}`, formData);
      } else {
        await api.post("/api/questions", formData);
      }
      void navigate("/admin/questions");
    } catch (err) {
      setSaveError(getApiErrorMessage(err, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;
  if (!formData) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={isEdit ? "编辑题目" : "新增题目"} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <QuestionForm
            courses={courses}
            initial={formData}
            onChange={setFormData}
          />
        </div>
        <div>
          <QuestionPreview
            type={formData.type}
            content={formData.content}
            options={formData.options}
            standardAnswer={formData.standardAnswer}
          />
        </div>
      </div>

      <Separator />
      {saveError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive"
        >
          {saveError}
        </div>
      )}
      <div className="flex justify-end gap-3 pt-4">
        <Button
          variant="outline"
          onClick={() => void navigate("/admin/questions")}
          disabled={saving}
        >
          取消
        </Button>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>
    </div>
  );
}
