import type { LucideIcon } from "lucide-react";
import { forwardRef, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** CRUD verb → semantic color (Wegent token-based). */
export type Verb =
  | "add"
  | "edit"
  | "delete"
  | "export"
  | "import"
  | "search"
  | "reset";

const VERB_VARIANT: Record<Verb, string> = {
  add: "border-primary/40 text-primary hover:bg-primary/10",
  edit: "border-success/40 text-success hover:bg-success/10",
  delete: "border-destructive/40 text-destructive hover:bg-destructive/10",
  export: "border-warning/40 text-warning hover:bg-warning/10",
  import: "border-info/40 text-info hover:bg-info/10",
  search: "border-primary/40 text-primary hover:bg-primary/10",
  reset: "border-destructive/40 text-destructive hover:bg-destructive/10",
};

export interface AdminToolbarButtonProps extends Omit<
  ComponentProps<"button">,
  "ref"
> {
  verb: Verb;
  icon?: LucideIcon;
  size?:
    | "default"
    | "xs"
    | "sm"
    | "lg"
    | "icon"
    | "icon-xs"
    | "icon-sm"
    | "icon-lg";
}

export const AdminToolbarButton = forwardRef<
  HTMLButtonElement,
  AdminToolbarButtonProps
>(function AdminToolbarButton(
  { verb, icon: Icon, className, children, size = "sm", ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant="outline"
      size={size}
      className={cn("bg-card font-medium", VERB_VARIANT[verb], className)}
      {...props}
    >
      {Icon && <Icon data-icon="inline-start" />}
      {children}
    </Button>
  );
});

/**
 * Square icon-only button (Wegent ghost style): subtle hover with primary tint.
 */
export type AdminIconButtonProps = Omit<ComponentProps<"button">, "ref"> & {
  size?:
    | "default"
    | "xs"
    | "sm"
    | "lg"
    | "icon"
    | "icon-xs"
    | "icon-sm"
    | "icon-lg";
};

export const AdminIconButton = forwardRef<
  HTMLButtonElement,
  AdminIconButtonProps
>(function AdminIconButton(
  { className, size = "icon", children, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size={size}
      className={cn(
        "text-muted-foreground hover:text-foreground active:scale-95",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
});
