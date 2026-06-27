import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  QuestionForm,
  type QuestionFormData,
} from "@/components/question/QuestionForm";
import { QuestionPreview } from "@/components/question/QuestionPreview";
import {
  AdminShell,
  AdminShellHeader,
  AdminPageCard,
} from "@/components/admin";

/** Minimal course representation used to populate the course selector. */
/** A course record used in the course selector dropdown. */
interface CourseRow {
  id: string;
  name: string;
  code: string;
}

/** Admin page for creating or editing a single question with live preview. */
/**
 * Admin page for creating or editing a question, with a side-by-side
 * form and live preview panel.
 */
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

  /** Loads available courses and, when editing, fetches the existing question data. */
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

  /** Persists the question (create or update) and navigates back to the list. */
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
    <AdminShell>
      <AdminShellHeader title={isEdit ? "编辑题目" : "新增题目"} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AdminPageCard>
          <QuestionForm
            courses={courses}
            initial={formData}
            onChange={setFormData}
          />
        </AdminPageCard>
        <AdminPageCard>
          <QuestionPreview
            type={formData.type}
            content={formData.content}
            options={formData.options}
            standardAnswer={formData.standardAnswer}
          />
        </AdminPageCard>
      </div>

      <Separator />
      {saveError && <InlineErrorBanner>{saveError}</InlineErrorBanner>}
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
    </AdminShell>
  );
}
