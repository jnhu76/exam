import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2 } from "lucide-react";
import { AppIcon } from "@/components/shared/AppIcon";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import {
  plainTextProjection,
  plainTextToDocument,
  type ContentDocumentV1,
} from "@exam/domain";
import { RichContentEditorLazy } from "@/components/shared/content/RichContentEditorLazy";
import { CourseSearchSelect } from "./CourseSearchSelect";

/** A single option within a question, with an ID, display content, and correctness flag. */
interface Option {
  id: string;
  content: string;
  contentDocument?: ContentDocumentV1 | null;
  isCorrect?: boolean;
}

/** Complete form data shape for creating or editing a question. */
export interface QuestionFormData {
  courseId: string;
  type:
    | "single_choice"
    | "multiple_choice"
    | "fill_blank"
    | "true_false"
    | "text_response";
  content: string;
  /**
   * Rich prompt document (issue 301). null → Plain mode (`content` is the
   * authority); non-null → Rich mode (`content` mirrors the plain-text
   * projection for search/display and is re-derived server-side on write).
   */
  contentDocument: ContentDocumentV1 | null;
  /**
   * text_response only: how candidates answer — plain text or the rich
   * editor. Independent of the prompt's Plain/Rich mode.
   */
  answerMode: "plain" | "rich";
  options: Option[];
  standardAnswer: unknown;
  score: number;
  difficulty: number;
  tags: string[];
  gradingRule: {
    multiSelectScoring: "all_correct_full" | "partial_half";
    fillBlankMatchMode: "exact" | "keyword";
    fillBlankCaseSensitive?: boolean;
  };
  // P3-MOD-P2-1C: text_response grading basis. null for objective types;
  // a non-empty, non-whitespace string required for text_response publish.
  rubric: string | null;
}

/** Props for the QuestionForm component. */
interface QuestionFormProps {
  courses: Array<{ id: string; name: string; code: string }>;
  initial?: Partial<QuestionFormData>;
  onChange: (data: QuestionFormData) => void;
}

/** Default form values for a new question. */
const defaultForm: QuestionFormData = {
  courseId: "",
  type: "single_choice",
  content: "",
  contentDocument: null,
  answerMode: "plain",
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
    fillBlankCaseSensitive: false,
  },
  rubric: null,
};

/**
 * True when the document carries anything the plain textarea cannot
 * represent (structure, math, marks). hardBreak projects to a newline, so it
 * is not lossy.
 */
function hasFormatting(document: ContentDocumentV1): boolean {
  return document.content.some((block) => {
    if (block.type !== "paragraph") return true;
    return block.content.some(
      (inline) =>
        inline.type === "inlineMath" ||
        (inline.type === "text" && (inline.marks?.length ?? 0) > 0),
    );
  });
}

/**
 * Full-featured form for creating or editing questions, supporting all five
 * question types with Plain/Rich content modes (issue 301), options, standard
 * answers, scoring, and grading rules. Rich mode edits the prompt/options in
 * a lazy WYSIWYG editor; the plain textarea remains the Plain-mode editor.
 */
export function QuestionForm({
  courses,
  initial,
  onChange,
}: QuestionFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<QuestionFormData>({
    ...defaultForm,
    ...initial,
  });
  /**
   * Pending lossy downgrade awaiting confirmation: either the prompt going
   * plain, the prompt collapsing for a fill_blank switch (plain-only), or an
   * option index going plain.
   */
  const [pendingToPlain, setPendingToPlain] = useState<
    "content" | "fillBlankSwitch" | number | null
  >(null);

  function update(partial: Partial<QuestionFormData>) {
    const next = { ...form, ...partial };
    setForm(next);
    onChange(next);
  }

  function addOption() {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const nextId = letters[form.options.length] ?? `${form.options.length}`;
    update({ options: [...form.options, { id: nextId, content: "" }] });
  }

  function removeOption(index: number) {
    const next = form.options.filter((_, i) => i !== index);
    update({ options: next });
  }

  function updateOption(index: number, patch: Partial<Option>) {
    const next = form.options.map((o, i) =>
      i === index ? { ...o, ...patch } : o,
    );
    update({ options: next });
  }

  /** Plain → Rich: never lossy (textarea newlines become paragraphs). */
  function upgradePromptToRich() {
    update({ contentDocument: plainTextToDocument(form.content) });
  }

  function upgradeOptionToRich(index: number) {
    const opt = form.options[index];
    if (!opt) return;
    updateOption(index, {
      contentDocument: plainTextToDocument(opt.content),
    });
  }

  /** Rich → Plain: lossy when formatting exists → requires confirmation. */
  function requestPromptToPlain() {
    if (!form.contentDocument) return;
    if (hasFormatting(form.contentDocument)) {
      setPendingToPlain("content");
      return;
    }
    downgradePromptToPlain();
  }

  function downgradePromptToPlain() {
    if (!form.contentDocument) return;
    update({
      content: plainTextProjection(form.contentDocument),
      contentDocument: null,
    });
  }

  function requestOptionToPlain(index: number) {
    const opt = form.options[index];
    if (!opt?.contentDocument) return;
    if (hasFormatting(opt.contentDocument)) {
      setPendingToPlain(index);
      return;
    }
    downgradeOptionToPlain(index);
  }

  function downgradeOptionToPlain(index: number) {
    const opt = form.options[index];
    if (!opt?.contentDocument) return;
    updateOption(index, {
      content: plainTextProjection(opt.contentDocument),
      contentDocument: null,
    });
  }

  /** Applies the pending lossy downgrade after the user confirms. */
  function confirmPendingToPlain() {
    if (pendingToPlain === "content") {
      downgradePromptToPlain();
    } else if (pendingToPlain === "fillBlankSwitch") {
      const content = form.contentDocument
        ? plainTextProjection(form.contentDocument)
        : form.content;
      const type = "fill_blank" as const;
      update({
        type,
        content,
        contentDocument: null,
        options: [],
        standardAnswer: "",
        rubric: null,
      });
    } else if (typeof pendingToPlain === "number") {
      downgradeOptionToPlain(pendingToPlain);
    }
    setPendingToPlain(null);
  }

  function toggleCorrect(optionId: string) {
    if (form.type === "true_false") {
      update({ standardAnswer: optionId === "true" });
    } else if (form.type === "single_choice") {
      update({ standardAnswer: optionId });
    } else if (form.type === "multiple_choice") {
      const current = Array.isArray(form.standardAnswer)
        ? (form.standardAnswer as string[])
        : [];
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
      update({ standardAnswer: next });
    }
  }

  const optionTypesWithRich =
    form.type === "single_choice" || form.type === "multiple_choice";

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <Label>{t("admin.forms.question.course")}</Label>
          <CourseSearchSelect
            courses={courses}
            value={form.courseId}
            onChange={(v) => update({ courseId: v })}
            placeholder={t("admin.forms.question.coursePlaceholder")}
          />
        </Field>

        <Field>
          <Label>{t("admin.forms.question.type")}</Label>
          <Select
            value={form.type}
            onValueChange={(v) => {
              const type = v as QuestionFormData["type"];
              const defaults: Partial<QuestionFormData> = {};
              if (type === "single_choice" || type === "multiple_choice") {
                defaults.options = [
                  { id: "A", content: "" },
                  { id: "B", content: "" },
                ];
                defaults.standardAnswer = type === "single_choice" ? "" : [];
                // Objective types never carry a rubric.
                defaults.rubric = null;
              } else if (type === "fill_blank") {
                // fill_blank is Plain-only (issue 301): an in-flight rich prompt
                // degrades through the confirmation dialog, not silently.
                if (
                  form.contentDocument &&
                  hasFormatting(form.contentDocument)
                ) {
                  setPendingToPlain("fillBlankSwitch");
                  return;
                }
                defaults.content = form.contentDocument
                  ? plainTextProjection(form.contentDocument)
                  : form.content;
                defaults.contentDocument = null;
                defaults.options = [];
                defaults.standardAnswer = "";
                defaults.rubric = null;
              } else if (type === "true_false") {
                defaults.options = [
                  { id: "true", content: t("admin.forms.question.optionTrue") },
                  {
                    id: "false",
                    content: t("admin.forms.question.optionFalse"),
                  },
                ];
                defaults.standardAnswer = true;
                defaults.rubric = null;
              } else if (type === "text_response") {
                // text_response canonical form: no options, rubric is the
                // grading basis, standardAnswer is an OPTIONAL reference
                // answer (plain text | null). Always clear standardAnswer
                // on type switch — preserving it would carry objective
                // answers (e.g. "A" from single_choice) into the reference
                // field, leaking grading metadata. Rubric IS preserved
                // because it is text_response-specific and an in-flight
                // draft is valuable.
                defaults.options = [];
                defaults.standardAnswer = null;
                defaults.rubric = form.rubric ?? null;
              }
              update({ type, ...defaults });
            }}
          >
            <SelectTrigger aria-label={t("admin.forms.question.type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single_choice">
                {t("admin.forms.question.typeSingleChoice")}
              </SelectItem>
              <SelectItem value="multiple_choice">
                {t("admin.forms.question.typeMultipleChoice")}
              </SelectItem>
              <SelectItem value="fill_blank">
                {t("admin.forms.question.typeFillBlank")}
              </SelectItem>
              <SelectItem value="true_false">
                {t("admin.forms.question.typeTrueFalse")}
              </SelectItem>
              <SelectItem value="text_response">
                {t("admin.forms.question.typeTextResponse")}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field>
        <div className="flex items-center justify-between">
          <Label>{t("admin.forms.question.content")}</Label>
          {form.type !== "fill_blank" && (
            <Select
              value={form.contentDocument ? "rich" : "plain"}
              onValueChange={(v) => {
                if (v === "rich" && !form.contentDocument) {
                  upgradePromptToRich();
                } else if (v === "plain" && form.contentDocument) {
                  requestPromptToPlain();
                }
              }}
            >
              <SelectTrigger
                className="h-8 w-28 text-sm"
                aria-label={t("content.mode.label")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="plain">{t("content.mode.plain")}</SelectItem>
                <SelectItem value="rich">{t("content.mode.rich")}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        {form.type === "fill_blank" ? (
          <Textarea
            value={form.content}
            onChange={(e) => update({ content: e.target.value })}
            placeholder={t("admin.forms.question.contentFillBlankPlaceholder")}
            rows={3}
          />
        ) : form.contentDocument ? (
          <RichContentEditorLazy
            initialDocument={form.contentDocument}
            onChange={(document) =>
              update({
                contentDocument: document,
                content: plainTextProjection(document),
              })
            }
            ariaLabel={t("admin.forms.question.content")}
          />
        ) : (
          <Textarea
            value={form.content}
            onChange={(e) => update({ content: e.target.value })}
            placeholder={t("admin.forms.question.contentPlaceholder")}
            rows={3}
          />
        )}
      </Field>

      {(form.type === "single_choice" ||
        form.type === "multiple_choice" ||
        form.type === "true_false") && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>{t("admin.forms.question.options")}</Label>
            {form.type !== "true_false" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addOption}
              >
                <AppIcon icon={Plus} size="inline" />
                {t("admin.forms.question.addOption")}
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {form.options.map((opt, i) => (
              <div key={opt.id} className="flex items-center gap-2">
                {form.type === "single_choice" || form.type === "true_false" ? (
                  <RadioGroup
                    value={
                      typeof form.standardAnswer === "string" ||
                      typeof form.standardAnswer === "boolean"
                        ? String(form.standardAnswer)
                        : ""
                    }
                    onValueChange={toggleCorrect}
                  >
                    <RadioGroupItem value={opt.id} />
                  </RadioGroup>
                ) : (
                  <Checkbox
                    checked={
                      Array.isArray(form.standardAnswer) &&
                      form.standardAnswer.includes(opt.id)
                    }
                    onCheckedChange={() => toggleCorrect(opt.id)}
                  />
                )}
                <span className="w-8 text-sm text-muted-foreground">
                  {opt.id}.
                </span>
                {opt.contentDocument ? (
                  <div className="flex-1 flex flex-col gap-1">
                    <RichContentEditorLazy
                      initialDocument={opt.contentDocument}
                      onChange={(document) =>
                        updateOption(i, {
                          contentDocument: document,
                          content: plainTextProjection(document),
                        })
                      }
                      ariaLabel={t("admin.forms.question.optionContent", {
                        id: opt.id,
                      })}
                    />
                  </div>
                ) : (
                  <Input
                    value={opt.content}
                    onChange={(e) =>
                      updateOption(i, { content: e.target.value })
                    }
                    placeholder={t("admin.forms.question.optionPlaceholder", {
                      id: opt.id,
                    })}
                    disabled={form.type === "true_false"}
                  />
                )}
                {optionTypesWithRich && (
                  <Select
                    value={opt.contentDocument ? "rich" : "plain"}
                    onValueChange={(v) => {
                      if (v === "rich" && !opt.contentDocument) {
                        upgradeOptionToRich(i);
                      } else if (v === "plain" && opt.contentDocument) {
                        requestOptionToPlain(i);
                      }
                    }}
                  >
                    <SelectTrigger
                      className="h-8 w-20 text-sm"
                      aria-label={t("content.mode.optionLabel", { id: opt.id })}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="plain">
                        {t("content.mode.plain")}
                      </SelectItem>
                      <SelectItem value="rich">
                        {t("content.mode.rich")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {form.type !== "true_false" && form.options.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeOption(i)}
                  >
                    <AppIcon icon={Trash2} size="inline" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {form.type === "fill_blank" && (
        <Field>
          <Label>{t("admin.forms.question.standardAnswer")}</Label>
          <Input
            value={
              typeof form.standardAnswer === "string" ? form.standardAnswer : ""
            }
            onChange={(e) => update({ standardAnswer: e.target.value })}
            placeholder={t("admin.forms.question.standardAnswerPlaceholder")}
          />
          <p className="text-xs text-muted-foreground">
            {t("admin.forms.question.standardAnswerHint")}
          </p>
        </Field>
      )}

      {form.type === "text_response" && (
        <>
          <Field>
            <Label>{t("admin.forms.question.rubric")}</Label>
            <Textarea
              value={form.rubric ?? ""}
              onChange={(e) => update({ rubric: e.target.value })}
              placeholder={t("admin.forms.question.rubricPlaceholder")}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              {t("admin.forms.question.rubricHint")}
            </p>
          </Field>

          <Field>
            <Label>{t("admin.forms.question.answerMode")}</Label>
            <Select
              value={form.answerMode}
              onValueChange={(v) =>
                update({ answerMode: v as QuestionFormData["answerMode"] })
              }
            >
              <SelectTrigger aria-label={t("admin.forms.question.answerMode")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="plain">{t("content.mode.plain")}</SelectItem>
                <SelectItem value="rich">{t("content.mode.rich")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("admin.forms.question.answerModeHint")}
            </p>
          </Field>

          <Field>
            <Label>{t("admin.forms.question.referenceAnswer")}</Label>
            <Textarea
              value={
                typeof form.standardAnswer === "string"
                  ? form.standardAnswer
                  : ""
              }
              onChange={(e) => update({ standardAnswer: e.target.value })}
              placeholder={t("admin.forms.question.referenceAnswerPlaceholder")}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              {t("admin.forms.question.referenceAnswerHint")}
            </p>
          </Field>
        </>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Field>
          <Label>{t("admin.forms.question.score")}</Label>
          <Input
            type="number"
            value={form.score}
            onChange={(e) => update({ score: Number(e.target.value) })}
            min={1}
          />
        </Field>
        <Field>
          <Label>{t("admin.forms.question.difficulty")}</Label>
          <Select
            value={String(form.difficulty)}
            onValueChange={(v) => update({ difficulty: Number(v) })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <Label>{t("admin.forms.question.tags")}</Label>
          <Input
            value={form.tags.join(",")}
            onChange={(e) =>
              update({
                tags: e.target.value
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }
            placeholder={t("admin.forms.question.tagsPlaceholder")}
          />
        </Field>
      </div>

      {form.type === "multiple_choice" && (
        <Field>
          <Label>{t("admin.forms.question.multiSelectScoring")}</Label>
          <Select
            value={form.gradingRule.multiSelectScoring}
            onValueChange={(v) =>
              update({
                gradingRule: {
                  ...form.gradingRule,
                  multiSelectScoring: v as "all_correct_full" | "partial_half",
                },
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_correct_full">
                {t("admin.forms.question.allCorrectFull")}
              </SelectItem>
              <SelectItem value="partial_half">
                {t("admin.forms.question.partialHalf")}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}

      {form.type === "fill_blank" && (
        <div className="flex flex-col gap-4">
          <Label>{t("admin.forms.question.fillBlankMatchMode")}</Label>
          <Select
            value={form.gradingRule.fillBlankMatchMode}
            onValueChange={(v) =>
              update({
                gradingRule: {
                  ...form.gradingRule,
                  fillBlankMatchMode: v as "exact" | "keyword",
                },
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exact">
                {t("admin.forms.question.exactMatch")}
              </SelectItem>
              <SelectItem value="keyword">
                {t("admin.forms.question.keywordMatch")}
              </SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.gradingRule.fillBlankCaseSensitive ?? false}
              onCheckedChange={(checked) =>
                update({
                  gradingRule: {
                    ...form.gradingRule,
                    fillBlankCaseSensitive: checked === true,
                  },
                })
              }
            />
            {t("admin.forms.question.caseSensitive")}
          </label>
        </div>
      )}

      <AlertDialog
        open={pendingToPlain !== null}
        onOpenChange={(open) => {
          if (!open) setPendingToPlain(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("content.confirmToPlain.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("content.confirmToPlain.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("content.confirmToPlain.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingToPlain}>
              {t("content.confirmToPlain.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
