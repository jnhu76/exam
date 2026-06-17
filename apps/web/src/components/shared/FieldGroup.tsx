import { cn } from "@/lib/utils";

/** Vertical stack container for grouping related form fields. */
export function FieldGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-2", className)} {...props} />;
}

/** Single form field wrapper that stacks label, input, and helper text vertically. */
export function Field({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

/** Responsive grid row for placing two form fields side-by-side on larger screens. */
export function FieldRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-4 sm:grid sm:grid-cols-2", className)}
      {...props}
    />
  );
}
