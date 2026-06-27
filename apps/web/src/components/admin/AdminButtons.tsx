import type { LucideIcon } from "lucide-react";
import { forwardRef, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** koi CRUD verb → semantic color. */
export type Verb =
  | "add"
  | "edit"
  | "delete"
  | "export"
  | "import"
  | "search"
  | "reset";

/**
 * koi-inspired "plain" verb button. koi maps CRUD verbs to semantic colors
 * with a plain (soft) treatment: add=primary, edit=success, delete=danger,
 * export=warning, import=info. We approximate plain via outline + semantic
 * border/text so it reads correctly in both light and dark.
 */
const VERB_VARIANT: Record<Verb, string> = {
  add: "border-primary/40 text-primary hover:bg-primary-soft hover:text-primary",
  edit: "border-success/40 text-success hover:bg-success-soft hover:text-success",
  delete:
    "border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive",
  export:
    "border-warning/40 text-warning hover:bg-warning-soft hover:text-warning",
  import: "border-info/40 text-info hover:bg-info-soft hover:text-info",
  search:
    "border-primary/40 text-primary hover:bg-primary-soft hover:text-primary",
  reset:
    "border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive",
};

export interface AdminToolbarButtonProps extends Omit<
  ComponentProps<"button">,
  "ref"
> {
  verb: Verb;
  icon?: LucideIcon;
  /** Mirrors the shadcn Button size; defaults to "sm". */
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
 * 32x32 square icon-only button (koi KoiToolbar pattern): hairline border,
 * subtle fill, primary-tinted hover with a gentle active scale.
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
      variant="outline"
      size={size}
      className={cn(
        "rounded-[var(--admin-radius-sm)] bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary-soft hover:text-primary active:scale-95",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
});
