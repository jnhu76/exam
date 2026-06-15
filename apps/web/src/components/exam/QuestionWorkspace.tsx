import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type QuestionWorkspaceProps = {
  header?: ReactNode;
  question: ReactNode;
  answer: ReactNode;
  footer?: ReactNode;
  className?: string;
};

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
      <div className="rounded-lg border bg-card p-5 text-card-foreground">
        {question}
      </div>
      {answer}
      {footer}
    </section>
  );
}
