import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Facts observed for one scrollable container region.
 *
 * `containerWidth` is the physical border-box width; `clientWidth` is the
 * layout client width (excludes borders/scrollbar); `scrollWidth` is the full
 * content width. `atStart`/`atEnd` are true when not overflowing.
 */
export interface OverflowObservation {
  containerWidth: number;
  clientWidth: number;
  scrollWidth: number;
  overflowing: boolean;
  atStart: boolean;
  atEnd: boolean;
}

const INITIAL_OBSERVATION: OverflowObservation = {
  containerWidth: 0,
  clientWidth: 0,
  scrollWidth: 0,
  overflowing: false,
  atStart: true,
  atEnd: true,
};

/**
 * INVARIANT: this module is the single container-overflow measurement
 * authority and owns FACTS ONLY (#445 P3 §8). It must never know tier,
 * archetype, column role, priority, representation, or any other business
 * vocabulary — a hook that learns policy becomes a second policy owner
 * (Gate F violation). Interpreting these facts (including any viewport-width
 * policy) belongs to consumers.
 *
 * Measurement re-runs on: mount, every render (content swaps replace the
 * observed first child), ResizeObserver on the region and its first child,
 * region scroll, and window resize. State updates are value-guarded so the
 * render-loop re-observation cannot cascade.
 */
export function useOverflowObservation(
  ref: RefObject<HTMLElement | null>,
  threshold = 1,
): OverflowObservation {
  const [observation, setObservation] =
    useState<OverflowObservation>(INITIAL_OBSERVATION);

  useLayoutEffect(() => {
    const region = ref.current;
    if (!region) return;

    const measure = () => {
      const next: OverflowObservation = {
        containerWidth: region.getBoundingClientRect().width,
        clientWidth: region.clientWidth,
        scrollWidth: region.scrollWidth,
        overflowing: false,
        atStart: true,
        atEnd: true,
      };
      const maxScroll = Math.max(0, next.scrollWidth - next.clientWidth);
      next.overflowing = maxScroll > threshold;
      next.atStart = !next.overflowing || region.scrollLeft <= threshold;
      next.atEnd =
        !next.overflowing || region.scrollLeft >= maxScroll - threshold;
      setObservation((prev) =>
        prev.containerWidth === next.containerWidth &&
        prev.clientWidth === next.clientWidth &&
        prev.scrollWidth === next.scrollWidth &&
        prev.overflowing === next.overflowing &&
        prev.atStart === next.atStart &&
        prev.atEnd === next.atEnd
          ? prev
          : next,
      );
    };

    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(region);
    if (region.firstElementChild instanceof HTMLElement) {
      observer?.observe(region.firstElementChild);
    }
    region.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      region.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  });

  return observation;
}
