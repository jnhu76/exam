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
    showResultImmediately: boolean;
  };
  retakePolicy: "unlimited" | "max_attempts" | "pass_then_stop";
  scoreStrategy: "highest" | "latest" | "first";
  maxAttempts: number;
}

interface ExamConfigFormProps {
  courses: Array<{ id: string; name: string }>;
  data: ExamConfigData;
  onChange: (data: ExamConfigData) => void;
}

export function ExamConfigForm({
  courses,
  data,
  onChange,
}: ExamConfigFormProps) {
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>考试名称</Label>
            <Input
              value={data.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="请输入考试名称"
            />
          </div>
          <div className="space-y-2">
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
          </div>
          <div className="space-y-2">
            <Label>考试说明</Label>
            <Input
              value={data.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="可选"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">时间设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>开始时间</Label>
              <Input
                type="datetime-local"
                value={data.openAt}
                onChange={(e) => update({ openAt: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>结束时间</Label>
              <Input
                type="datetime-local"
                value={data.closeAt}
                onChange={(e) => update({ closeAt: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>考试时长（分钟）</Label>
            <Input
              type="number"
              value={data.durationMinutes}
              onChange={(e) =>
                update({ durationMinutes: Number(e.target.value) })
              }
              min={1}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            时间模式：timed_window（Phase 1 仅支持此模式）
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">分数设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>总分</Label>
              <Input
                type="number"
                value={data.totalScore}
                onChange={(e) => update({ totalScore: Number(e.target.value) })}
                min={1}
              />
            </div>
            <div className="space-y-2">
              <Label>及格分</Label>
              <Input
                type="number"
                value={data.passingScore}
                onChange={(e) =>
                  update({ passingScore: Number(e.target.value) })
                }
                min={1}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">重考策略</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
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
            </div>
            <div className="space-y-2">
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
            </div>
          </div>
          <div className="space-y-2">
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">控制设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
          <div className="flex items-center gap-2">
            <Checkbox
              checked={data.controlFlags.requireQueue}
              onCheckedChange={(v) => updateFlags({ requireQueue: v === true })}
            />
            <Label className="font-normal">排队入场（防流量峰值）</Label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
