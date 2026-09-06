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

function setMetrics(
  element: HTMLElement,
  metrics: {
    containerWidth: number;
    clientWidth: number;
    scrollWidth: number;
    scrollLeft: number;
  },
) {
  Object.defineProperties(element, {
    getBoundingClientRect: {
      configurable: true,
      value: () => ({ width: metrics.containerWidth }),
    },
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
      clientWidth: 500,
      scrollWidth: 500,
      scrollLeft: 0,
    });
    act(() => {
      observerInstances.forEach((i) => i.cb([], {} as ResizeObserver));
    });

    expect(region).toHaveAttribute("data-container-width", "502.5");
    expect(region).toHaveAttribute("data-client-width", "500");
    expect(region).toHaveAttribute("data-scroll-width", "500");
    expect(region).toHaveAttribute("data-overflowing", "false");
    expect(region).toHaveAttribute("data-at-start", "true");
    expect(region).toHaveAttribute("data-at-end", "true");
  });

  it("reports overflow facts when content exceeds the container", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    setMetrics(region, {
      containerWidth: 600,
      clientWidth: 500,
      scrollWidth: 900,
      scrollLeft: 0,
    });
    act(() => {
      observerInstances.forEach((i) => i.cb([], {} as ResizeObserver));
    });

    expect(region).toHaveAttribute("data-overflowing", "true");
    expect(region).toHaveAttribute("data-at-start", "true");
    expect(region).toHaveAttribute("data-at-end", "false");
  });

  it("treats maxScroll at or below the 1px threshold as not overflowing", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    // maxScroll = 501 - 500 = 1 → exactly at threshold → fits.
    setMetrics(region, {
      containerWidth: 501,
      clientWidth: 500,
      scrollWidth: 501,
      scrollLeft: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "false");

    // maxScroll = 2 → beyond threshold → overflowing.
    setMetrics(region, {
      containerWidth: 502,
      clientWidth: 500,
      scrollWidth: 502,
      scrollLeft: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "true");
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
  });

  it("tracks atStart/atEnd across the ±1px boundaries while scrolling", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    const metrics = {
      containerWidth: 600,
      clientWidth: 500,
      scrollWidth: 900,
      scrollLeft: 0,
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
      containerWidth: 600,
      clientWidth: 500,
      scrollWidth: 800,
      scrollLeft: 0,
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
      containerWidth: 600,
      clientWidth: 500,
      scrollWidth: 900,
      scrollLeft: 0,
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
      containerWidth: 600,
      clientWidth: 400,
      scrollWidth: 500,
      scrollLeft: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "true");
  });
});
