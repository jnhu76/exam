import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Props for ContentCard, extending Card props with a contentClassName override. */
type ContentCardProps = React.ComponentProps<typeof Card> & {
  contentClassName?: string;
};

/** A borderless, padding-free card shell for content areas without a header. */
export function ContentCard({
  children,
  className,
  contentClassName,
  ...props
}: ContentCardProps) {
  return (
    <Card className={cn("gap-0 rounded-lg py-0", className)} {...props}>
      <CardContent className={cn("p-5", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}
