import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/shared/FieldError";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";

/** A question's ID and its configured score value. */
interface QuestionScore {
  id: string;
  score: number;
}

/** Complete exam configuration data used by the create/edit form. */
export interface ExamConfigData {
  title: string;
  description: string;
  courseId: string;
  durationMinutes: number;
  openAt: string;
  closeAt: string;
  passingScore: number;
  totalScore: number;
  questionSelectionMode: "manual" | "random";
  questionIds: string[];
  resultPublicationMode: "immediate" | "after_grading" | "manual";
  controlFlags: {
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    detectTabSwitch: boolean;
    disableCopyPaste: boolean;
    requireQueue: boolean;
    batchSize: number;
    batchInterval: number;
    restrictIp: boolean;
    requireLockdown: boolean;
    showResultImmediately: boolean;
  };
  retakePolicy: "unlimited" | "max_attempts" | "pass_then_stop";
  scoreStrategy: "highest" | "latest" | "first";
  maxAttempts: number;
  // ADR-005 Slice 3 timing policy. null/undefined = disabled.
  latestStartOffsetMinutes?: number | null;
  minSubmitAfterStartMinutes?: number | null;
}

/** Props for the ExamConfigForm component. */
interface ExamConfigFormProps {
  courses: Array<{ id: string; name: string }>;
  questions?: QuestionScore[];
  data: ExamConfigData;
  onChange: (data: ExamConfigData) => void;
}

/**
 * Multi-section form for creating or editing exam configuration,
 * including basic info, time windows, scores, retake policy, and control flags.
 */
export function ExamConfigForm({
  courses,
  questions = [],
  data,
  onChange,
}: ExamConfigFormProps) {
  const { t } = useTranslation();
  const [manualTotalScore, setManualTotalScore] = useState(false);

  const computedTotal = questions
    .filter((q) => data.questionIds.includes(q.id))
    .reduce((sum, q) => sum + q.score, 0);
  const hasQuestions = data.questionIds.length > 0;
  const showWarning =
    hasQuestions && manualTotalScore && data.totalScore !== computedTotal;
  const timeError =
    data.openAt && data.closeAt
      ? new Date(data.closeAt) <= new Date(data.openAt)
      : false;
  const scoreError = data.totalScore > 0 && data.passingScore > data.totalScore;

  useEffect(() => {
    if (
      hasQuestions &&
      !manualTotalScore &&
      computedTotal > 0 &&
      data.totalScore !== computedTotal
    ) {
      onChange({ ...data, totalScore: computedTotal });
    }
  }, [computedTotal, data, hasQuestions, manualTotalScore, onChange]);

  function update(partial: Partial<ExamConfigData>) {
    onChange({ ...data, ...partial });
  }

  function updateFlags(partial: Partial<ExamConfigData["controlFlags"]>) {
    onChange({
      ...data,
      controlFlags: { ...data.controlFlags, ...partial },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("admin.forms.exam.sectionBasic")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <Label>{t("admin.forms.exam.title")}</Label>
              <Input
                value={data.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder={t("admin.forms.exam.titlePlaceholder")}
              />
            </Field>
            <Field>
              <Label>{t("admin.forms.exam.course")}</Label>
              <Select
                value={data.courseId}
                onValueChange={(v) => update({ courseId: v })}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("admin.forms.exam.coursePlaceholder")}
                  />
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
              <Label>{t("admin.forms.exam.description")}</Label>
              <Input
                value={data.description}
                onChange={(e) => update({ description: e.target.value })}
                placeholder={t("admin.forms.exam.descriptionPlaceholder")}
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("admin.forms.exam.sectionTime")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <Label>{t("admin.forms.exam.startTime")}</Label>
                <Input
                  type="datetime-local"
                  value={data.openAt}
                  onChange={(e) => update({ openAt: e.target.value })}
                />
              </Field>
              <Field>
                <Label>{t("admin.forms.exam.endTime")}</Label>
                <Input
                  type="datetime-local"
                  value={data.closeAt}
                  onChange={(e) => update({ closeAt: e.target.value })}
                />
              </Field>
            </div>
            {timeError && (
              <p role="alert" className="text-xs text-destructive">
                结束时间必须晚于开始时间
              </p>
            )}
            <Field>
              <Label>{t("admin.forms.exam.duration")}</Label>
              <Input
                type="number"
                value={data.durationMinutes}
                onChange={(e) =>
                  update({ durationMinutes: Number(e.target.value) })
                }
                min={1}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <Label>{t("admin.forms.exam.latestStart")}</Label>
                <Input
                  type="number"
                  value={data.latestStartOffsetMinutes ?? ""}
                  onChange={(e) =>
                    update({
                      latestStartOffsetMinutes:
                        e.target.value === ""
                          ? null
                          : Number.isNaN(Number(e.target.value))
                            ? null
                            : Number(e.target.value),
                    })
                  }
                  min={0}
                  placeholder={t("admin.forms.exam.noLimit")}
                />
              </Field>
              <Field>
                <Label>{t("admin.forms.exam.minSubmit")}</Label>
                <Input
                  type="number"
                  value={data.minSubmitAfterStartMinutes ?? ""}
                  onChange={(e) =>
                    update({
                      minSubmitAfterStartMinutes:
                        e.target.value === ""
                          ? null
                          : Number.isNaN(Number(e.target.value))
                            ? null
                            : Number(e.target.value),
                    })
                  }
                  min={0}
                  placeholder={t("admin.forms.exam.noLimit")}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("admin.forms.exam.timingMode")}
            </p>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("admin.forms.exam.sectionScore")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <div className="flex items-center justify-between">
                  <Label htmlFor="totalScore">
                    {t("admin.forms.exam.totalScore")}
                  </Label>
                  {hasQuestions && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => {
                        if (manualTotalScore) {
                          setManualTotalScore(false);
                          if (computedTotal > 0) {
                            update({ totalScore: computedTotal });
                          }
                        } else {
                          setManualTotalScore(true);
                        }
                      }}
                    >
                      {manualTotalScore
                        ? t("admin.forms.exam.autoCalc")
                        : t("admin.forms.exam.manualInput")}
                    </Button>
                  )}
                </div>
                <Input
                  id="totalScore"
                  type="number"
                  value={data.totalScore}
                  onChange={(e) =>
                    update({ totalScore: Number(e.target.value) })
                  }
                  min={1}
                  readOnly={hasQuestions && !manualTotalScore}
                  aria-label={t("admin.forms.exam.totalScore")}
                />
                {hasQuestions && !manualTotalScore && (
                  <p className="text-xs text-muted-foreground">
                    {t("admin.forms.exam.autoCalcLabel", {
                      score: computedTotal,
                    })}
                  </p>
                )}
                {showWarning && (
                  <p className="text-xs text-destructive">
                    总分与题目分值之和不匹配（应为 {computedTotal}）
                  </p>
                )}
              </Field>
              <Field>
                <Label>{t("admin.forms.exam.passingScore")}</Label>
                <Input
                  type="number"
                  value={data.passingScore}
                  onChange={(e) =>
                    update({ passingScore: Number(e.target.value) })
                  }
                  min={1}
                />
              </Field>
            </div>
            {scoreError && (
              <p role="alert" className="text-xs text-destructive">
                及格分不能超过总分（{data.passingScore} &gt; {data.totalScore}）
              </p>
            )}
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("admin.forms.exam.sectionRetake")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <Label>{t("admin.forms.exam.retakePolicy")}</Label>
                <Select
                  value={data.retakePolicy}
                  onValueChange={(v) =>
                    update({
                      retakePolicy: v as ExamConfigData["retakePolicy"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unlimited">
                      {t("admin.forms.exam.unlimited")}
                    </SelectItem>
                    <SelectItem value="max_attempts">
                      {t("admin.forms.exam.maxAttempts")}
                    </SelectItem>
                    <SelectItem value="pass_then_stop">
                      {t("admin.forms.exam.passThenStop")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <Label>{t("admin.forms.exam.maxAttemptsLabel")}</Label>
                <Input
                  type="number"
                  value={data.maxAttempts}
                  onChange={(e) =>
                    update({ maxAttempts: Number(e.target.value) })
                  }
                  min={1}
                  disabled={data.retakePolicy === "unlimited"}
                />
              </Field>
            </div>
            <Field>
              <Label>{t("admin.forms.exam.scoreStrategy")}</Label>
              <Select
                value={data.scoreStrategy}
                onValueChange={(v) =>
                  update({
                    scoreStrategy: v as ExamConfigData["scoreStrategy"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="highest">
                    {t("admin.forms.exam.highest")}
                  </SelectItem>
                  <SelectItem value="latest">
                    {t("admin.forms.exam.latest")}
                  </SelectItem>
                  <SelectItem value="first">
                    {t("admin.forms.exam.first")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("admin.forms.exam.sectionControl")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={data.controlFlags.shuffleQuestions}
              onCheckedChange={(v) =>
                updateFlags({ shuffleQuestions: v === true })
              }
            />
            <Label className="font-normal">
              {t("admin.forms.exam.shuffleQuestions")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={data.controlFlags.shuffleOptions}
              onCheckedChange={(v) =>
                updateFlags({ shuffleOptions: v === true })
              }
            />
            <Label className="font-normal">
              {t("admin.forms.exam.shuffleOptions")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={data.controlFlags.detectTabSwitch}
              onCheckedChange={(v) =>
                updateFlags({ detectTabSwitch: v === true })
              }
            />
            <Label className="font-normal">
              {t("admin.forms.exam.detectTabSwitch")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={data.controlFlags.disableCopyPaste}
              onCheckedChange={(v) =>
                updateFlags({ disableCopyPaste: v === true })
              }
            />
            <Label className="font-normal">
              {t("admin.forms.exam.disableCopyPaste")}
            </Label>
          </div>
          <div className="space-y-2">
            <Label>{t("admin.forms.exam.resultPublication")}</Label>
            <Select
              value={data.resultPublicationMode}
              onValueChange={(v) => {
                const mode = v as "immediate" | "after_grading" | "manual";
                onChange({
                  ...data,
                  resultPublicationMode: mode,
                  controlFlags: {
                    ...data.controlFlags,
                    showResultImmediately: mode === "immediate",
                  },
                });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">
                  {t("admin.forms.exam.immediate")}
                </SelectItem>
                <SelectItem value="after_grading">
                  {t("admin.forms.exam.afterGrading")}
                </SelectItem>
                <SelectItem value="manual">
                  {t("admin.forms.exam.manualPublication")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
