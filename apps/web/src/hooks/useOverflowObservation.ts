import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Facts observed for one scrollable container region.
 *
 * `containerWidth` is the physical border-box width; `contentWidth` is the
 * EXACT (fractional) width available to content — the layout space a child may
 * occupy before the region overflows; `clientWidth` is the same box rounded to
 * whole pixels; `scrollWidth` is the content width rounded to whole pixels.
 * `overflowing` is the integer fact `scrollWidth − clientWidth > threshold`;
 * `atStart`/`atEnd` are true when not overflowing.
 */
export interface OverflowObservation {
  containerWidth: number;
  contentWidth: number;
  clientWidth: number;
  scrollWidth: number;
  overflowing: boolean;
  atStart: boolean;
  atEnd: boolean;
}

const INITIAL_OBSERVATION: OverflowObservation = {
  containerWidth: 0,
  contentWidth: 0,
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
 *
 * Sub-pixel exactness (#601 Phase F): the two consumers of these facts need
 * DIFFERENT numbers, and conflating them is a measured defect in both
 * directions.
 *
 *   - SIZING consumers (the column allocator) must use `contentWidth`, the
 *     exact fractional box: an integer target taken from the rounded
 *     `clientWidth` overshoots a fractional box. Measured: box 1394.667px,
 *     `clientWidth` 1395 → a 1395px table painted a 16px classic scrollbar on
 *     a table that fit. The allocator therefore floors this value.
 *   - OVERFLOW consumers (the scroll affordance) must use the integer pair:
 *     `scrollWidth` is clamped to at least `clientWidth`, so
 *     `scrollWidth > clientWidth` answers "is there a whole pixel to scroll"
 *     exactly, and `maxScroll > threshold` absorbs scroll-position rounding.
 *     Deriving overflow from `scrollWidth > contentWidth` instead is true for
 *     EVERY region whose box has a fractional part ≥ 0.5 — measured: box
 *     1394.667px, `scrollWidth` 1395, `clientWidth` 1395, nothing overflowing,
 *     yet the "scroll for more" hint band rendered. `contentWidth` is never an
 *     input to the overflow decision.
 *
 * The region is a bare overflow container: it must not carry borders or
 * padding, otherwise the box arithmetic below would have to account for them.
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
      const containerWidth = region.getBoundingClientRect().width;
      // offsetWidth − clientWidth is the classic scrollbar's width (the region
      // has no border): the exact content box is the border box minus it.
      const scrollbarWidth = region.offsetWidth - region.clientWidth;
      const contentWidth = containerWidth - scrollbarWidth;
      const next: OverflowObservation = {
        containerWidth,
        contentWidth,
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
        prev.contentWidth === next.contentWidth &&
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
