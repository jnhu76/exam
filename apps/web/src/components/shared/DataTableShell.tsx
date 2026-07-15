import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type DataTableMinWidth = "compact" | "standard" | "wide";

/**
 * Actions column density tier. Under the shell's fixed table layout the
 * actions column width is strict, so a page picks the tier that fits its
 * worst-case row-action set:
 *   - "narrow" (default): 1-2 icon buttons (6.5rem)
 *   - "normal": 1 icon + 1 short text button, e.g. enable/disable (9rem)
 *   - "wide": 4 icon buttons, or 2 icon + 1 text button (11rem)
 */
export type ActionsDensity = "narrow" | "normal" | "wide";

/**
 * Standard shell for data table pages, providing an optional title, description,
 * toolbar slot, content area, and footer within a bordered card container.
 */
export function DataTableShell({
  title,
  description,
  toolbar,
  children,
  footer,
  className,
  contentClassName,
  minTableWidth = "standard",
  actionsDensity = "narrow",
}: {
  title?: string;
  description?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  minTableWidth?: DataTableMinWidth;
  actionsDensity?: ActionsDensity;
}) {
  const { t } = useTranslation();
  const shellId = useId();
  const titleId = title ? `${shellId}-title` : undefined;
  const descriptionId = description ? `${shellId}-description` : undefined;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({
    overflowing: false,
    atStart: true,
    atEnd: true,
    narrow: false,
  });
  const updateOverflow = useCallback(() => {
    const region = scrollRef.current;
    if (!region) return;
    const maxScroll = Math.max(0, region.scrollWidth - region.clientWidth);
    const overflowing = maxScroll > 1;
    setOverflow({
      overflowing,
      atStart: !overflowing || region.scrollLeft <= 1,
      atEnd: !overflowing || region.scrollLeft >= maxScroll - 1,
      narrow: window.innerWidth < 640,
    });
  }, []);

  useLayoutEffect(() => {
    const region = scrollRef.current;
    if (!region) return;
    updateOverflow();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateOverflow);
    observer?.observe(region);
    if (region.firstElementChild) observer?.observe(region.firstElementChild);
    window.addEventListener("resize", updateOverflow);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [children, updateOverflow]);

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-slot="admin-table-shell"
      data-table-min-width={minTableWidth}
      data-actions-density={actionsDensity}
      className={cn("surface-content overflow-hidden", className)}
    >
      {(title || description || toolbar) && (
        <div
          data-slot="data-table-title-band"
          className="flex flex-col gap-3 border-b border-border-divider bg-surface px-4 py-3 lg:flex-row lg:items-start lg:justify-between"
        >
          {(title || description) && (
            <div className="min-w-0">
              {title && (
                <h2 id={titleId} className="type-section-title">
                  {title}
                </h2>
              )}
              {description && (
                <p
                  id={descriptionId}
                  className={cn("type-secondary", title && "mt-1")}
                >
                  {description}
                </p>
              )}
            </div>
          )}
          {toolbar && <div className="shrink-0">{toolbar}</div>}
        </div>
      )}
      <div data-slot="table-scroll-frame" className="relative min-w-0">
        <div
          ref={scrollRef}
          data-slot="table-scroll-region"
          data-overflow-owner="local"
          data-overflowing={String(overflow.overflowing)}
          data-scroll-start={String(overflow.atStart)}
          data-scroll-end={String(overflow.atEnd)}
          className={cn("min-w-0 overflow-x-auto", contentClassName)}
          onScroll={updateOverflow}
        >
          {children}
        </div>
        {overflow.overflowing && !overflow.atStart && (
          <span data-slot="table-scroll-fade-left" aria-hidden="true" />
        )}
        {overflow.overflowing && !overflow.atEnd && (
          <span data-slot="table-scroll-fade-right" aria-hidden="true" />
        )}
        {overflow.overflowing && overflow.narrow && (
          <div
            data-slot="table-scroll-hint"
            data-scroll-direction={
              overflow.atStart ? "right" : overflow.atEnd ? "left" : "both"
            }
            className={cn(
              "pointer-events-none flex h-6 items-center border-t border-border-divider bg-surface-soft px-3 text-xs text-text-muted",
              overflow.atStart
                ? "justify-end"
                : overflow.atEnd
                  ? "justify-start"
                  : "justify-center",
            )}
          >
            {t(
              overflow.atStart
                ? "common.table.scrollHintRight"
                : overflow.atEnd
                  ? "common.table.scrollHintLeft"
                  : "common.table.scrollHintBoth",
            )}
          </div>
        )}
      </div>
      {footer && (
        <div className="border-t bg-surface-subtle px-4 py-3">{footer}</div>
      )}
    </section>
  );
}
