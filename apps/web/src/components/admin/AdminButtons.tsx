import type { LucideIcon } from "lucide-react";
import { forwardRef, type ComponentProps } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** CRUD verb → Wegent action-semantic mapping (no per-verb Koi outline colors). */
export type Verb =
  | "add"
  | "edit"
  | "delete"
  | "export"
  | "import"
  | "search"
  | "reset";

/**
 * Verb → Wegent Action Semantic mapping.
 * - add     → primary-action   (solid primary purple) — page's main CTA
 * - edit    → secondary-action (outline)
 * - delete  → secondary-action with destructive text (list-safe; confirmation dialog owns destructive fill)
 * - export  → secondary-action (outline)
 * - import  → secondary-action (outline)
 * - search  → primary-action   (solid primary)
 * - reset   → secondary-action with destructive text
 */
const VERB_CONFIG: Record<
  Verb,
  { variant: ButtonProps["variant"]; className?: string }
> = {
  add: { variant: "primary" },
  search: { variant: "primary" },
  edit: { variant: "outline" },
  export: { variant: "outline" },
  import: { variant: "outline" },
  delete: {
    variant: "outline",
    className: "text-destructive hover:bg-destructive/10",
  },
  reset: {
    variant: "outline",
    className: "text-destructive hover:bg-destructive/10",
  },
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
  const config = VERB_CONFIG[verb];
  return (
    <Button
      ref={ref}
      variant={config.variant}
      size={size}
      className={cn("font-medium", config.className, className)}
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
