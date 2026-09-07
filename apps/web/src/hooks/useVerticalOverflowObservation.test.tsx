import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useVerticalOverflowObservation } from "./useVerticalOverflowObservation";

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
    containerHeight: number;
    clientHeight: number;
    scrollHeight: number;
    scrollTop: number;
  },
) {
  Object.defineProperties(element, {
    getBoundingClientRect: {
      configurable: true,
      value: () => ({ height: metrics.containerHeight }),
    },
    clientHeight: { configurable: true, get: () => metrics.clientHeight },
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
    scrollTop: {
      configurable: true,
      get: () => metrics.scrollTop,
      set: (value: number) => {
        metrics.scrollTop = value;
      },
    },
  });
}

function Probe({ threshold }: { threshold?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const facts = useVerticalOverflowObservation(ref, threshold);
  return (
    <div
      ref={ref}
      data-testid="region"
      data-container-height={String(facts.containerHeight)}
      data-client-height={String(facts.clientHeight)}
      data-scroll-height={String(facts.scrollHeight)}
      data-overflowing={String(facts.overflowing)}
      data-at-start={String(facts.atStart)}
      data-at-end={String(facts.atEnd)}
    />
  );
}

describe("useVerticalOverflowObservation", () => {
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
      containerHeight: 502.5,
      clientHeight: 500,
      scrollHeight: 500,
      scrollTop: 0,
    });
    act(() => {
      observerInstances.forEach((i) => i.cb([], {} as ResizeObserver));
    });

    expect(region).toHaveAttribute("data-container-height", "502.5");
    expect(region).toHaveAttribute("data-client-height", "500");
    expect(region).toHaveAttribute("data-scroll-height", "500");
    expect(region).toHaveAttribute("data-overflowing", "false");
    expect(region).toHaveAttribute("data-at-start", "true");
    expect(region).toHaveAttribute("data-at-end", "true");
  });

  it("reports overflow facts when content exceeds the container", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    setMetrics(region, {
      containerHeight: 600,
      clientHeight: 500,
      scrollHeight: 900,
      scrollTop: 0,
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
      containerHeight: 501,
      clientHeight: 500,
      scrollHeight: 501,
      scrollTop: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "false");

    // maxScroll = 2 → beyond threshold → overflowing.
    setMetrics(region, {
      containerHeight: 502,
      clientHeight: 500,
      scrollHeight: 502,
      scrollTop: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "true");
  });

  it("supports an explicit threshold", () => {
    const { getByTestId } = render(<Probe threshold={4} />);
    const region = getByTestId("region");
    // maxScroll = 3 ≤ threshold 4 → fits.
    setMetrics(region, {
      containerHeight: 503,
      clientHeight: 500,
      scrollHeight: 503,
      scrollTop: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "false");
  });

  it("tracks atStart/atEnd across the ±1px boundaries while scrolling", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    const metrics = {
      containerHeight: 600,
      clientHeight: 500,
      scrollHeight: 900,
      scrollTop: 0,
    };
    setMetrics(region, metrics);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-at-start", "true");
    expect(region).toHaveAttribute("data-at-end", "false");

    // scrollTop 1 is still within the start threshold.
    metrics.scrollTop = 1;
    act(() => {
      region.dispatchEvent(new Event("scroll"));
    });
    expect(region).toHaveAttribute("data-at-start", "true");

    // maxScroll = 400; scrollTop 399 is still within the end threshold.
    metrics.scrollTop = 399;
    act(() => {
      region.dispatchEvent(new Event("scroll"));
    });
    expect(region).toHaveAttribute("data-at-start", "false");
    expect(region).toHaveAttribute("data-at-end", "true");

    metrics.scrollTop = 400;
    act(() => {
      region.dispatchEvent(new Event("scroll"));
    });
    expect(region).toHaveAttribute("data-at-end", "true");
  });

  it("re-measures when the ResizeObserver fires (region or child resize)", () => {
    const { getByTestId } = render(<Probe />);
    const region = getByTestId("region");
    setMetrics(region, {
      containerHeight: 600,
      clientHeight: 500,
      scrollHeight: 500,
      scrollTop: 0,
    });
    act(() => {
      observerInstances.forEach((i) => i.cb([], {} as ResizeObserver));
    });
    expect(region).toHaveAttribute("data-overflowing", "false");

    setMetrics(region, {
      containerHeight: 600,
      clientHeight: 500,
      scrollHeight: 800,
      scrollTop: 0,
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
      containerHeight: 600,
      clientHeight: 500,
      scrollHeight: 900,
      scrollTop: 0,
    };
    setMetrics(region, metrics);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-at-start", "true");

    metrics.scrollTop = 200;
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
      containerHeight: 600,
      clientHeight: 500,
      scrollHeight: 500,
      scrollTop: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "false");

    setMetrics(region, {
      containerHeight: 600,
      clientHeight: 400,
      scrollHeight: 500,
      scrollTop: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "true");
  });
});
