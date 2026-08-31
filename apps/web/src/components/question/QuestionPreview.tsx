import { useTranslation } from "react-i18next";
import type { ContentDocumentV1 } from "@exam/domain";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ContentRenderer } from "@/components/shared/content/ContentRenderer";

/** Props for the QuestionPreview component. */
interface QuestionPreviewProps {
  type: string;
  content: string;
  contentDocument?: ContentDocumentV1 | null;
  options: Array<{
    id: string;
    content: string;
    contentDocument?: ContentDocumentV1 | null;
  }>;
  standardAnswer: unknown;
}

/**
 * Read-only preview of a question as it would appear to candidates,
 * rendering options as disabled radio/checkbox inputs or blank fields.
 * Rich prompts/options render through the same static ContentRenderer the
 * candidate sees (issue 301) — the preview never diverges from runtime.
 */
export function QuestionPreview({
  type,
  content,
  contentDocument,
  options,
  standardAnswer,
}: QuestionPreviewProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">
          {t("admin.questionPreview.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ContentRenderer
          content={content || t("admin.questionPreview.emptyContent")}
          document={contentDocument}
          className="text-sm"
        />

        {(type === "single_choice" || type === "true_false") && (
          <RadioGroup disabled>
            {options.map((opt) => (
              <div key={opt.id} className="flex items-center gap-2">
                <RadioGroupItem value={opt.id} id={`preview-${opt.id}`} />
                <Label
                  htmlFor={`preview-${opt.id}`}
                  className="text-sm font-normal"
                >
                  <ContentRenderer
                    content={opt.content}
                    document={opt.contentDocument}
                  />
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}

        {type === "multiple_choice" && (
          <div className="flex flex-col gap-2">
            {options.map((opt) => (
              <div key={opt.id} className="flex items-center gap-2">
                <Checkbox disabled id={`preview-${opt.id}`} />
                <Label
                  htmlFor={`preview-${opt.id}`}
                  className="text-sm font-normal"
                >
                  <ContentRenderer
                    content={opt.content}
                    document={opt.contentDocument}
                  />
                </Label>
              </div>
            ))}
          </div>
        )}

        {type === "fill_blank" && (
          <div className="flex flex-col gap-2">
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

        <Separator />
        <div className="pt-2 text-xs text-muted-foreground">
          <p>
            {t("admin.questionPreview.standardAnswer")}
            {type === "true_false"
              ? standardAnswer === true
                ? t("common.boolean.yes")
                : t("common.boolean.no")
              : String(standardAnswer ?? t("admin.questionPreview.notSet"))}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
