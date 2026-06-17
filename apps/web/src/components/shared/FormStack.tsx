import { cn } from "@/lib/utils";

/** Vertical stack with generous spacing for grouping form sections. */
export function FormStack({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-5", className)} {...props} />;
}

/** Vertical stack with tighter spacing for grouping fields within a section. */
export function FieldStack({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-4", className)} {...props} />;
}
