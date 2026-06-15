import { cn } from "@/lib/utils";

export function FormStack({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-5", className)} {...props} />;
}

export function FieldStack({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-4", className)} {...props} />;
}
