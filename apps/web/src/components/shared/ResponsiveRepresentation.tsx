import type { ReactNode } from "react";

/**
 * Single responsive policy owner (issue 457 C3): owns the CSS viewport switch
 * between mobile card representation (<lg) and desktop table representation
 * (≥lg). Both DataTableShell and DataWorkbench consume this component — they
 * must not independently encode `lg:hidden` / `hidden lg:block` for the same
 * semantic rule.
 *
 * The switch is pure CSS — no JS breakpoint, no media query listeners.
 * This component knows ONLY about viewport representation; it does not know
 * column roles, priority, tier, pagination, or business page internals.
 */
export function ResponsiveRepresentation({
  mobile,
  desktop,
}: {
  /** Mobile content — rendered below lg, hidden at lg+. */
  mobile: ReactNode;
  /** Desktop content — hidden below lg, rendered at lg+. */
  desktop: ReactNode;
}) {
  return (
    <>
      <div data-slot="responsive-mobile-region" className="lg:hidden">
        {mobile}
      </div>
      <div
        data-slot="responsive-desktop-region"
        className="hidden min-w-0 lg:block"
      >
        {desktop}
      </div>
    </>
  );
}
