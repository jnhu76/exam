import { useState } from "react";
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
import { Plus, Trash2 } from "lucide-react";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";

/** A single option within a question, with an ID, display content, and correctness flag. */
interface Option {
  id: string;
  content: string;
  isCorrect?: boolean;
}

/** Complete form data shape for creating or editing a question. */
export interface QuestionFormData {
  courseId: string;
  type: "single_choice" | "multiple_choice" | "fill_blank" | "true_false";
  content: string;
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
}

/** Props for the QuestionForm component. */
interface QuestionFormProps {
  courses: Array<{ id: string; name: string }>;
  initial?: Partial<QuestionFormData>;
  onChange: (data: QuestionFormData) => void;
}

/** Default form values for a new question. */
const defaultForm: QuestionFormData = {
  courseId: "",
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
    fillBlankCaseSensitive: false,
  },
};

/**
 * Full-featured form for creating or editing questions, supporting
 * single-choice, multiple-choice, fill-blank, and true/false types
 * with options, standard answers, scoring, and grading rules.
 */
export function QuestionForm({
  courses,
  initial,
  onChange,
}: QuestionFormProps) {
  const [form, setForm] = useState<QuestionFormData>({
    ...defaultForm,
    ...initial,
  });

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

  function updateOption(index: number, content: string) {
    const next = form.options.map((o, i) =>
      i === index ? { ...o, content } : o,
    );
    update({ options: next });
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

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <Label>所属课程</Label>
          <Select
            value={form.courseId}
            onValueChange={(v) => update({ courseId: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择课程" />
            </SelectTrigger>
            <SelectContent>
              {courses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <Label>题目类型</Label>
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
              } else if (type === "fill_blank") {
                defaults.options = [];
                defaults.standardAnswer = "";
              } else if (type === "true_false") {
                defaults.options = [
                  { id: "true", content: "是" },
                  { id: "false", content: "否" },
                ];
                defaults.standardAnswer = true;
              }
              update({ type, ...defaults });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single_choice">单选题</SelectItem>
              <SelectItem value="multiple_choice">多选题</SelectItem>
              <SelectItem value="fill_blank">填空题</SelectItem>
              <SelectItem value="true_false">判断题</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field>
        <Label>题目内容</Label>
        {form.type === "fill_blank" ? (
          <Textarea
            value={form.content}
            onChange={(e) => update({ content: e.target.value })}
            placeholder="输入题目内容，用 ____ 标记空格位置"
            rows={3}
          />
        ) : (
          <Textarea
            value={form.content}
            onChange={(e) => update({ content: e.target.value })}
            placeholder="输入题目内容"
            rows={3}
          />
        )}
      </Field>

      {(form.type === "single_choice" ||
        form.type === "multiple_choice" ||
        form.type === "true_false") && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>选项</Label>
            {form.type !== "true_false" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addOption}
              >
                <Plus className="size-3" />
                添加选项
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
                <Input
                  value={opt.content}
                  onChange={(e) => updateOption(i, e.target.value)}
                  placeholder={`选项 ${opt.id}`}
                  disabled={form.type === "true_false"}
                />
                {form.type !== "true_false" && form.options.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeOption(i)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {form.type === "fill_blank" && (
        <Field>
          <Label>标准答案</Label>
          <Input
            value={
              typeof form.standardAnswer === "string" ? form.standardAnswer : ""
            }
            onChange={(e) => update({ standardAnswer: e.target.value })}
            placeholder="输入标准答案，多个答案用 | 分隔"
          />
          <p className="text-xs text-muted-foreground">
            多个可接受答案用 | 分隔，如：原子|atom
          </p>
        </Field>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Field>
          <Label>分值</Label>
          <Input
            type="number"
            value={form.score}
            onChange={(e) => update({ score: Number(e.target.value) })}
            min={1}
          />
        </Field>
        <Field>
          <Label>难度 (1-5)</Label>
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
          <Label>标签</Label>
          <Input
            value={form.tags.join(",")}
            onChange={(e) =>
              update({
                tags: e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
            placeholder="用逗号分隔"
          />
        </Field>
      </div>

      {form.type === "multiple_choice" && (
        <Field>
          <Label>多选评分策略</Label>
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
              <SelectItem value="all_correct_full">全对满分</SelectItem>
              <SelectItem value="partial_half">部分正确半分</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}

      {form.type === "fill_blank" && (
        <div className="flex flex-col gap-4">
          <Label>填空匹配模式</Label>
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
              <SelectItem value="exact">精确匹配</SelectItem>
              <SelectItem value="keyword">关键词匹配</SelectItem>
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
            区分大小写
          </label>
        </div>
      )}
    </div>
  );
}
