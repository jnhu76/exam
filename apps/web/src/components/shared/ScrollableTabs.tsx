import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AdminIconButton } from "@/components/admin";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ScrollableTabsProps {
  children: React.ReactNode;
  className?: string;
  scrollStep?: number;
  height?: string;
}

export function ScrollableTabs({
  children,
  className,
  scrollStep = 200,
  height = "40px",
}: ScrollableTabsProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const overflow = scrollWidth - clientWidth > 2;
    setCanScrollPrev(overflow && scrollLeft > 2);
    setCanScrollNext(overflow && scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState]);

  const scrollBy = (direction: "prev" | "next") => {
    const el = viewportRef.current;
    if (!el) return;
    const delta = direction === "prev" ? -scrollStep : scrollStep;
    el.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      style={{ height }}
    >
      {canScrollPrev && (
        <AdminIconButton
          onClick={() => scrollBy("prev")}
          aria-label="向左滚动"
          size="icon-sm"
        >
          <ChevronLeft className="size-3.5" />
        </AdminIconButton>
      )}
      <div
        ref={viewportRef}
        className="flex-1 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="inline-flex items-center gap-1">{children}</div>
      </div>
      {canScrollNext && (
        <AdminIconButton
          onClick={() => scrollBy("next")}
          aria-label="向右滚动"
          size="icon-sm"
        >
          <ChevronRight className="size-3.5" />
        </AdminIconButton>
      )}
    </div>
  );
}
