import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { PageHeader } from "@/components/shared/PageHeader";
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
  const { t } = useTranslation();
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
      const cData = await api.get<{ items: CourseRow[] }>(
        "/api/courses?pageSize=100",
      );
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
          rubric?: string | null;
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
          // P3-MOD-P2-1C: echo the frozen grading basis; never overwrite with
          // an empty value on edit.
          rubric: q.rubric ?? null,
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
          rubric: null,
        });
      }
    } catch {
      setError(t("admin.questionEdit.loadDataFailed"));
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

    // P3-MOD-P2-1C: text_response requires a non-empty rubric before save.
    // Mirror publish validation (publishExam rejects empty/placeholder rubric)
    // so the author gets immediate feedback instead of a publish-time failure.
    if (
      formData.type === "text_response" &&
      (formData.rubric == null || formData.rubric.trim() === "")
    ) {
      setSaveError(t("admin.questionEdit.rubricRequired"));
      return;
    }

    // Normalize so incompatible fields never leak into the payload:
    // - objective types carry rubric: null;
    // - text_response keeps its rubric verbatim (newlines preserved) with
    //   options: []. Its standardAnswer is an OPTIONAL reference answer:
    //   a non-empty plain-text string is forwarded as-is, while a blank /
    //   whitespace-only value is normalized to null so no meaningless "   "
    //   is persisted.
    const referenceAnswer =
      formData.type === "text_response" &&
      typeof formData.standardAnswer === "string" &&
      formData.standardAnswer.trim() !== ""
        ? formData.standardAnswer
        : null;
    const payload: QuestionFormData = {
      ...formData,
      rubric: formData.type === "text_response" ? formData.rubric : null,
      ...(formData.type === "text_response"
        ? { options: [], standardAnswer: referenceAnswer }
        : {}),
    };

    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/api/questions/${id}`, payload);
      } else {
        await api.post("/api/questions", payload);
      }
      void navigate("/admin/questions");
    } catch (err) {
      setSaveError(getApiErrorMessage(err, t("admin.questionEdit.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;
  if (!formData) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          isEdit
            ? t("admin.questionEdit.editTitle")
            : t("admin.questionEdit.newTitle")
        }
      />

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
      {saveError && <InlineErrorBanner>{saveError}</InlineErrorBanner>}
      <div className="flex justify-end gap-3 pt-4">
        <Button
          variant="outline"
          onClick={() => void navigate("/admin/questions")}
          disabled={saving}
        >
          {t("admin.questionEdit.actions.cancel")}
        </Button>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving
            ? t("admin.questionEdit.actions.saving")
            : t("admin.questionEdit.actions.save")}
        </Button>
      </div>
    </div>
  );
}
