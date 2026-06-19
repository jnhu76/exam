import { useState, useEffect } from "react";
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
          <CardTitle className="text-base">基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <Label>考试名称</Label>
              <Input
                value={data.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder="请输入考试名称"
              />
            </Field>
            <Field>
              <Label>所属课程</Label>
              <Select
                value={data.courseId}
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
              <Label>考试说明</Label>
              <Input
                value={data.description}
                onChange={(e) => update({ description: e.target.value })}
                placeholder="可选"
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">时间设置</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <Label>开始时间</Label>
                <Input
                  type="datetime-local"
                  value={data.openAt}
                  onChange={(e) => update({ openAt: e.target.value })}
                />
              </Field>
              <Field>
                <Label>结束时间</Label>
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
              <Label>考试时长（分钟）</Label>
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
                <Label>最晚进入（开考后分钟）</Label>
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
                  placeholder="留空=不限"
                />
              </Field>
              <Field>
                <Label>最短交卷（开考后分钟）</Label>
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
                  placeholder="留空=不限"
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              时间模式：限时窗口（当前版本仅支持此模式）。留空表示不限制。
            </p>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">分数设置</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <div className="flex items-center justify-between">
                  <Label htmlFor="totalScore">总分</Label>
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
                      {manualTotalScore ? "自动计算" : "手动输入"}
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
                  aria-label="总分"
                />
                {hasQuestions && !manualTotalScore && (
                  <p className="text-xs text-muted-foreground">
                    自动计算：{computedTotal} 分
                  </p>
                )}
                {showWarning && (
                  <p className="text-xs text-destructive">
                    总分与题目分值之和不匹配（应为 {computedTotal}）
                  </p>
                )}
              </Field>
              <Field>
                <Label>及格分</Label>
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
          <CardTitle className="text-base">重考策略</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <Label>重考策略</Label>
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
                    <SelectItem value="unlimited">不限次数</SelectItem>
                    <SelectItem value="max_attempts">限制次数</SelectItem>
                    <SelectItem value="pass_then_stop">通过后停止</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <Label>最大尝试次数</Label>
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
              <Label>分数策略</Label>
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
                  <SelectItem value="highest">取最高分</SelectItem>
                  <SelectItem value="latest">取最新分</SelectItem>
                  <SelectItem value="first">取首次分</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">控制设置</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={data.controlFlags.shuffleQuestions}
              onCheckedChange={(v) =>
                updateFlags({ shuffleQuestions: v === true })
              }
            />
            <Label className="font-normal">打乱题目顺序</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={data.controlFlags.shuffleOptions}
              onCheckedChange={(v) =>
                updateFlags({ shuffleOptions: v === true })
              }
            />
            <Label className="font-normal">打乱选项顺序</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={data.controlFlags.detectTabSwitch}
              onCheckedChange={(v) =>
                updateFlags({ detectTabSwitch: v === true })
              }
            />
            <Label className="font-normal">检测切屏</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={data.controlFlags.disableCopyPaste}
              onCheckedChange={(v) =>
                updateFlags({ disableCopyPaste: v === true })
              }
            />
            <Label className="font-normal">禁止复制粘贴</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={data.controlFlags.showResultImmediately}
              onCheckedChange={(v) =>
                updateFlags({ showResultImmediately: v === true })
              }
            />
            <Label className="font-normal">交卷后立即显示成绩</Label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
