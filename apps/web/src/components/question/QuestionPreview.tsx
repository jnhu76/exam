import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface QuestionPreviewProps {
  type: string;
  content: string;
  options: Array<{ id: string; content: string }>;
  standardAnswer: unknown;
}

export function QuestionPreview({
  type,
  content,
  options,
  standardAnswer,
}: QuestionPreviewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">
          考生视角预览
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">{content || "（题目内容为空）"}</p>

        {(type === "single_choice" || type === "true_false") && (
          <RadioGroup disabled>
            {options.map((opt) => (
              <div key={opt.id} className="flex items-center gap-2">
                <RadioGroupItem value={opt.id} id={`preview-${opt.id}`} />
                <Label
                  htmlFor={`preview-${opt.id}`}
                  className="text-sm font-normal"
                >
                  {opt.content}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}

        {type === "multiple_choice" && (
          <div className="space-y-2">
            {options.map((opt) => (
              <div key={opt.id} className="flex items-center gap-2">
                <Checkbox disabled id={`preview-${opt.id}`} />
                <Label
                  htmlFor={`preview-${opt.id}`}
                  className="text-sm font-normal"
                >
                  {opt.content}
                </Label>
              </div>
            ))}
          </div>
        )}

        {type === "fill_blank" && (
          <div className="space-y-2">
            {content.split("____").map((part, i, arr) => (
              <span key={i}>
                {part}
                {i < arr.length - 1 && (
                  <Input className="inline-block w-32 mx-1" disabled />
                )}
              </span>
            ))}
          </div>
        )}

        <div className="pt-2 border-t text-xs text-muted-foreground">
          <p>
            标准答案：
            {type === "true_false"
              ? standardAnswer === true
                ? "是"
                : "否"
              : String(standardAnswer ?? "未设置")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
