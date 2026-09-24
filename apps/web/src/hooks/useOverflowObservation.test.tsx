import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useOverflowObservation } from "./useOverflowObservation";

/** Instance records kept by the mocked ResizeObserver so tests can fire the
 * observation callback on demand (jsdom ships no real ResizeObserver). */
const observerInstances: { cb: ResizeObserverCallback }[] = [];

class MockResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    observerInstances.push({ cb });
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function installMockResizeObserver() {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: MockResizeObserver,
  });
}

/**
 * Stubs one region's measurement facts. `offsetWidth` defaults to the border
 * box (no classic scrollbar); an overflowing region in a real browser reports
 * `offsetWidth − clientWidth` = scrollbar width, so pass `scrollbarWidth` for
 * those cases.
 */
function setMetrics(
  element: HTMLElement,
  metrics: {
    containerWidth: number;
    clientWidth: number;
    scrollWidth: number;
    scrollLeft: number;
    scrollbarWidth?: number;
  },
) {
  const offsetWidth = metrics.clientWidth + (metrics.scrollbarWidth ?? 0);
  Object.defineProperties(element, {
    getBoundingClientRect: {
      configurable: true,
      value: () => ({ width: metrics.containerWidth }),
    },
    offsetWidth: { configurable: true, get: () => offsetWidth },
    clientWidth: { configurable: true, get: () => metrics.clientWidth },
    scrollWidth: { configurable: true, get: () => metrics.scrollWidth },
    scrollLeft: {
      configurable: true,
      get: () => metrics.scrollLeft,
      set: (value: number) => {
        metrics.scrollLeft = value;
      },
    },
  });
}

function Probe({ threshold }: { threshold?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const facts = useOverflowObservation(ref, threshold);
  return (
    <div
      ref={ref}
      data-testid="region"
      data-container-width={String(facts.containerWidth)}
      data-content-width={String(facts.contentWidth)}
      data-client-width={String(facts.clientWidth)}
      data-scroll-width={String(facts.scrollWidth)}
      data-overflowing={String(facts.overflowing)}
      data-at-start={String(facts.atStart)}
      data-at-end={String(facts.atEnd)}
    />
  );
}

describe("useOverflowObservation", () => {
  beforeEach(() => {
    observerInstances.length = 0;
    installMockResizeObserver();
  });
  afterEach(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  it("reports fitting facts when content fits the container", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    setMetrics(region, {
      containerWidth: 502.5,
      clientWidth: 502,
      scrollWidth: 500,
      scrollLeft: 0,
    });
    act(() => {
      observerInstances.forEach((i) => i.cb([], {} as ResizeObserver));
    });

    expect(region).toHaveAttribute("data-container-width", "502.5");
    expect(region).toHaveAttribute("data-content-width", "502.5");
    expect(region).toHaveAttribute("data-client-width", "502");
    expect(region).toHaveAttribute("data-scroll-width", "500");
    expect(region).toHaveAttribute("data-overflowing", "false");
    expect(region).toHaveAttribute("data-at-start", "true");
    expect(region).toHaveAttribute("data-at-end", "true");
  });

  it("reports overflow facts when content exceeds the container", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    setMetrics(region, {
      containerWidth: 516,
      clientWidth: 500,
      scrollWidth: 900,
      scrollLeft: 0,
      scrollbarWidth: 16,
    });
    act(() => {
      observerInstances.forEach((i) => i.cb([], {} as ResizeObserver));
    });

    expect(region).toHaveAttribute("data-content-width", "500");
    expect(region).toHaveAttribute("data-overflowing", "true");
    expect(region).toHaveAttribute("data-at-start", "true");
    expect(region).toHaveAttribute("data-at-end", "false");
  });

  it("keeps the exact content box out of the overflow decision (#601 Phase F)", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    // Measured regression on /admin/questions: a 1394.667px content box whose
    // content fits reports clientWidth === scrollWidth === 1395 (both rounded
    // up), so nothing overflows. The exact box is published for SIZING
    // consumers, but comparing scrollWidth against it reports overflow for
    // every box whose fractional part is ≥ 0.5 — it rendered the "scroll for
    // more" hint over a table that fit exactly.
    setMetrics(region, {
      containerWidth: 1394.667,
      clientWidth: 1395,
      scrollWidth: 1395,
      scrollLeft: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));

    expect(region).toHaveAttribute("data-content-width", "1394.667");
    expect(region).toHaveAttribute("data-overflowing", "false");
    expect(region).toHaveAttribute("data-at-start", "true");
    expect(region).toHaveAttribute("data-at-end", "true");

    // The same fractional box with a whole pixel of scrollable content is
    // still reported.
    setMetrics(region, {
      containerWidth: 1394.667,
      clientWidth: 1395,
      scrollWidth: 1397,
      scrollLeft: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "true");
    expect(region).toHaveAttribute("data-at-end", "false");
  });

  it("supports an explicit threshold", () => {
    const { getByTestId } = render(<Probe threshold={4} />);
    const region = getByTestId("region");
    // maxScroll = 3 ≤ threshold 4 → fits.
    setMetrics(region, {
      containerWidth: 503,
      clientWidth: 500,
      scrollWidth: 503,
      scrollLeft: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "false");

    // maxScroll = 5 > threshold 4 → overflowing.
    setMetrics(region, {
      containerWidth: 505,
      clientWidth: 500,
      scrollWidth: 505,
      scrollLeft: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "true");
  });

  it("tracks atStart/atEnd across the ±1px boundaries while scrolling", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    const metrics = {
      containerWidth: 516,
      clientWidth: 500,
      scrollWidth: 900,
      scrollLeft: 0,
      scrollbarWidth: 16,
    };
    setMetrics(region, metrics);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-at-start", "true");
    expect(region).toHaveAttribute("data-at-end", "false");

    // scrollLeft 1 is still within the start threshold.
    metrics.scrollLeft = 1;
    act(() => {
      region.dispatchEvent(new Event("scroll"));
    });
    expect(region).toHaveAttribute("data-at-start", "true");

    // maxScroll = 400; scrollLeft 399 is still within the end threshold.
    metrics.scrollLeft = 399;
    act(() => {
      region.dispatchEvent(new Event("scroll"));
    });
    expect(region).toHaveAttribute("data-at-start", "false");
    expect(region).toHaveAttribute("data-at-end", "true");

    metrics.scrollLeft = 400;
    act(() => {
      region.dispatchEvent(new Event("scroll"));
    });
    expect(region).toHaveAttribute("data-at-end", "true");
  });

  it("re-measures when the ResizeObserver fires (region or child resize)", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    setMetrics(region, {
      containerWidth: 600,
      clientWidth: 500,
      scrollWidth: 500,
      scrollLeft: 0,
    });
    act(() => {
      observerInstances.forEach((i) => i.cb([], {} as ResizeObserver));
    });
    expect(region).toHaveAttribute("data-overflowing", "false");

    setMetrics(region, {
      containerWidth: 516,
      clientWidth: 500,
      scrollWidth: 800,
      scrollLeft: 0,
      scrollbarWidth: 16,
    });
    act(() => {
      observerInstances.forEach((i) => i.cb([], {} as ResizeObserver));
    });
    expect(region).toHaveAttribute("data-overflowing", "true");
  });

  it("re-measures on region scroll", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    const metrics = {
      containerWidth: 516,
      clientWidth: 500,
      scrollWidth: 900,
      scrollLeft: 0,
      scrollbarWidth: 16,
    };
    setMetrics(region, metrics);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-at-start", "true");

    metrics.scrollLeft = 200;
    act(() => {
      region.dispatchEvent(new Event("scroll"));
    });
    expect(region).toHaveAttribute("data-at-start", "false");
    expect(region).toHaveAttribute("data-at-end", "false");
  });

  it("re-measures on window resize", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    setMetrics(region, {
      containerWidth: 600,
      clientWidth: 500,
      scrollWidth: 500,
      scrollLeft: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "false");

    setMetrics(region, {
      containerWidth: 516,
      clientWidth: 500,
      scrollWidth: 700,
      scrollLeft: 0,
      scrollbarWidth: 16,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "true");
  });
});
