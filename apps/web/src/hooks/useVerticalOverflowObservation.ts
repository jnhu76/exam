import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Facts observed for one vertically scrollable container region.
 *
 * `containerHeight` is the physical border-box height; `clientHeight` is the
 * layout client height (excludes borders/scrollbar); `scrollHeight` is the
 * full content height. `atStart`/`atEnd` are true when not overflowing.
 */
export interface VerticalOverflowObservation {
  containerHeight: number;
  clientHeight: number;
  scrollHeight: number;
  overflowing: boolean;
  atStart: boolean;
  atEnd: boolean;
}

const INITIAL_OBSERVATION: VerticalOverflowObservation = {
  containerHeight: 0,
  clientHeight: 0,
  scrollHeight: 0,
  overflowing: false,
  atStart: true,
  atEnd: true,
};

/**
 * Vertical sibling of `useOverflowObservation` (navigation scroll regions,
 * issue 494 NAV-4). INVARIANT: facts only — this module must never know
 * sidebar, navigation, role, route, group, active item, or responsive-mode
 * vocabulary. Interpreting the facts (edge cues, reveal policy) belongs to
 * consumers; a hook that learns policy becomes a second policy owner.
 *
 * Measurement lifecycle mirrors `useOverflowObservation`: re-runs on mount,
 * every render, ResizeObserver on the region and its first child, region
 * scroll, and window resize. State updates are value-guarded so the
 * render-loop re-observation cannot cascade.
 */
export function useVerticalOverflowObservation(
  ref: RefObject<HTMLElement | null>,
  threshold = 1,
): VerticalOverflowObservation {
  const [observation, setObservation] =
    useState<VerticalOverflowObservation>(INITIAL_OBSERVATION);

  useLayoutEffect(() => {
    const region = ref.current;
    if (!region) return;

    const measure = () => {
      const next: VerticalOverflowObservation = {
        containerHeight: region.getBoundingClientRect().height,
        clientHeight: region.clientHeight,
        scrollHeight: region.scrollHeight,
        overflowing: false,
        atStart: true,
        atEnd: true,
      };
      const maxScroll = Math.max(0, next.scrollHeight - next.clientHeight);
      next.overflowing = maxScroll > threshold;
      next.atStart = !next.overflowing || region.scrollTop <= threshold;
      next.atEnd =
        !next.overflowing || region.scrollTop >= maxScroll - threshold;
      setObservation((prev) =>
        prev.containerHeight === next.containerHeight &&
        prev.clientHeight === next.clientHeight &&
        prev.scrollHeight === next.scrollHeight &&
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
