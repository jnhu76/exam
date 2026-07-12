import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Props for the QuestionWorkspace component. */
type QuestionWorkspaceProps = {
  header?: ReactNode;
  question: ReactNode;
  answer: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/**
 * Layout shell for the exam question view, arranging header, question content,
 * answer area, and optional footer in a vertical flex column.
 */
export function QuestionWorkspace({
  header,
  question,
  answer,
  footer,
  className,
}: QuestionWorkspaceProps) {
  return (
    <section className={cn("flex min-h-0 flex-1 flex-col gap-5", className)}>
      {header}
      <div className="surface-content p-5 text-card-foreground">{question}</div>
      {answer}
      {footer}
    </section>
  );
}
