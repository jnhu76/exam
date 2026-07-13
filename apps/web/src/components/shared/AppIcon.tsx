import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Governed size/stroke authority for the Lucide Refined icon system
 * (UI-ICON-REFINE-1).
 *
 * Why both a numeric `size` prop AND a CSS size class:
 * - The numeric `size` prop drives Lucide's `absoluteStrokeWidth` formula
 *   (`strokeWidth * 24 / size`) so the physical stroke is correct at every
 *   render size. Without it, `size` defaults to 24 and `absoluteStrokeWidth`
 *   is a no-op.
 * - The matching static CSS size class prevents parent CVA selectors such as
 *   `[&_svg:not([class*='size-'])]:size-4` (in the Button primitive) from
 *   collapsing nav/metric/state icons to 16px. The CSS class is emitted on
 *   the wrapper so it wins over caller classes via tailwind-merge ordering.
 *
 * Callers must NOT pass their own `size-*`, `width`, `height`, `strokeWidth`
 * or `absoluteStrokeWidth` props — the size role is the only sizing authority.
 * Caller `className` may carry color / opacity / animation / transition /
 * transform utilities only.
 */
export type AppIconSize =
  | "badge"
  | "inline"
  | "nav"
  | "metric"
  | "large"
  | "state"
  | "hero";

const SIZE_CONFIG: Record<
  AppIconSize,
  { px: number; stroke: number; cssClass: string }
> = {
  badge: { px: 16, stroke: 2, cssClass: "size-4" },
  inline: { px: 16, stroke: 2, cssClass: "size-4" },
  nav: { px: 20, stroke: 2, cssClass: "size-5" },
  metric: { px: 20, stroke: 2, cssClass: "size-5" },
  large: { px: 24, stroke: 2, cssClass: "size-6" },
  state: { px: 32, stroke: 2, cssClass: "size-8" },
  hero: { px: 40, stroke: 2, cssClass: "size-10" },
};

type DecorativeAppIconProps = {
  icon: LucideIcon;
  size?: AppIconSize;
  decorative?: true;
  label?: never;
  className?: string;
};

type SemanticAppIconProps = {
  icon: LucideIcon;
  size?: AppIconSize;
  decorative: false;
  label: string;
  className?: string;
};

export type AppIconProps = DecorativeAppIconProps | SemanticAppIconProps;

export function AppIcon(props: AppIconProps) {
  const { icon: Icon, size = "inline", className } = props;
  const config = SIZE_CONFIG[size];
  // The generated CSS size class is always present so parent CVA selectors
  // (e.g. Button's `[&_svg:not([class*='size-'])]:size-4`) cannot collapse
  // nav/metric/state icons to 16px. tailwind-merge keeps the generated class
  // when the caller does not supply a conflicting size class.
  const baseClassName = cn("shrink-0", config.cssClass, className);

  if (props.decorative === false) {
    return (
      <Icon
        size={config.px}
        strokeWidth={config.stroke}
        absoluteStrokeWidth
        role="img"
        aria-label={props.label}
        className={baseClassName}
      />
    );
  }

  return (
    <Icon
      size={config.px}
      strokeWidth={config.stroke}
      absoluteStrokeWidth
      aria-hidden="true"
      className={baseClassName}
    />
  );
}
