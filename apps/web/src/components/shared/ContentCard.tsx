import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ContentCardProps = React.ComponentProps<typeof Card> & {
  contentClassName?: string;
};

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
