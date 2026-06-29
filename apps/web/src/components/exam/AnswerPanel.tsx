import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Props for the AnswerPanel component. */
type AnswerPanelProps = {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/**
 * Card-based container for the answer input area during an exam.
 * Renders a title, optional description, answer children, and an optional footer.
 */
export function AnswerPanel({
  title,
  description,
  children,
  footer,
  className,
}: AnswerPanelProps) {
  const { t } = useTranslation();
  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle>
          {title ?? t("candidateRuntime.answer.panelTitle")}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {children}
        {footer && <div>{footer}</div>}
      </CardContent>
    </Card>
  );
}
