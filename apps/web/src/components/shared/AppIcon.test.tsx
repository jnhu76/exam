import { render } from "@testing-library/react";
import { Eye, LoaderCircle } from "lucide-react";
import { describe, expect, it } from "vitest";
import { AppIcon } from "./AppIcon";
import { Button } from "@/components/ui/button";

/**
 * Verifies the SVG attribute output of AppIcon for every governed size role,
 * plus the accessibility modes and the critical Button-parent selector guard.
 *
 * Lucide's `absoluteStrokeWidth` formula: `strokeWidth * 24 / size`. The
 * rendered `stroke-width` attribute is the post-formula value, which then
 * scales with the CSS-rendered box. These tests assert the SVG attribute, not
 * the painted pixel — the attribute is the authoritative contract.
 */
describe("AppIcon", () => {
  it("renders inline size with correct numeric width/height and stroke", () => {
    const { container } = render(<AppIcon icon={Eye} size="inline" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
    // 1.75 * 24 / 16 = 2.625
    expect(svg.getAttribute("stroke-width")).toBe("2.625");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nav size (18px) without being collapsed by Button parent", () => {
    const { container } = render(
      <Button>
        <AppIcon icon={Eye} size="nav" />
      </Button>,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("18");
    expect(svg.getAttribute("height")).toBe("18");
    // 1.75 * 24 / 18 = 2.333...
    expect(svg.getAttribute("stroke-width")).toBe("2.3333333333333335");
    // The generated CSS class must be present so Button's
    // `[&_svg:not([class*='size-'])]:size-4` cannot override it.
    expect(svg.getAttribute("class") ?? "").toContain("size-[18px]");
  });

  it("renders metric size (20px) inside Button without collapse", () => {
    const { container } = render(
      <Button>
        <AppIcon icon={Eye} size="metric" />
      </Button>,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
    // 1.75 * 24 / 20 = 2.1
    expect(svg.getAttribute("stroke-width")).toBe("2.1");
    expect(svg.getAttribute("class") ?? "").toContain("size-5");
  });

  it("renders badge size (14px)", () => {
    const { container } = render(<AppIcon icon={Eye} size="badge" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("14");
    expect(svg.getAttribute("height")).toBe("14");
    // 1.75 * 24 / 14 = 3
    expect(svg.getAttribute("stroke-width")).toBe("3");
    expect(svg.getAttribute("class") ?? "").toContain("size-3.5");
  });

  it("renders large size (24px)", () => {
    const { container } = render(<AppIcon icon={Eye} size="large" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("height")).toBe("24");
    // 1.75 * 24 / 24 = 1.75
    expect(svg.getAttribute("stroke-width")).toBe("1.75");
  });

  it("renders state size (32px) with 2px physical stroke", () => {
    const { container } = render(<AppIcon icon={Eye} size="state" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("32");
    expect(svg.getAttribute("height")).toBe("32");
    // 2 * 24 / 32 = 1.5
    expect(svg.getAttribute("stroke-width")).toBe("1.5");
    expect(svg.getAttribute("class") ?? "").toContain("size-8");
  });

  it("renders hero size (40px) with 2px physical stroke", () => {
    const { container } = render(<AppIcon icon={Eye} size="hero" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("40");
    expect(svg.getAttribute("height")).toBe("40");
    // 2 * 24 / 40 = 1.2
    expect(svg.getAttribute("stroke-width")).toBe("1.2");
  });

  it("defaults to inline size when size prop omitted", () => {
    const { container } = render(<AppIcon icon={Eye} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("16");
  });

  it("sets aria-hidden on decorative icons (default)", () => {
    const { container } = render(<AppIcon icon={Eye} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
  });

  it("sets role=img and aria-label on semantic icons", () => {
    const { container } = render(
      <AppIcon icon={Eye} decorative={false} label="View exam" />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("View exam");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });

  it("preserves caller className for color and animation", () => {
    const { container } = render(
      <AppIcon
        icon={LoaderCircle}
        size="inline"
        className="animate-spin text-primary"
      />,
    );
    const svg = container.querySelector("svg")!;
    const cls = svg.getAttribute("class") ?? "";
    expect(cls).toContain("animate-spin");
    expect(cls).toContain("text-primary");
    // generated size class still present
    expect(cls).toContain("size-4");
  });

  it("always emits the generated size class (never blank) so parent CVA cannot override", () => {
    const { container } = render(
      <AppIcon icon={Eye} size="state" className="text-destructive" />,
    );
    const svg = container.querySelector("svg")!;
    const cls = svg.getAttribute("class") ?? "";
    expect(cls).toContain("size-8");
    expect(cls).toContain("text-destructive");
  });
});
