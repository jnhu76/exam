import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandProvider, useBranding } from "./BrandProvider";

function BrandingDisplay() {
  const branding = useBranding();
  return (
    <div>
      <span data-testid="name">{branding.productName}</span>
      <span data-testid="subtitle">{branding.productSubtitle}</span>
    </div>
  );
}

describe("BrandProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("provides fallback branding when no value is given", () => {
    render(
      <BrandProvider>
        <BrandingDisplay />
      </BrandProvider>,
    );
    expect(screen.getByTestId("name").textContent).toBe("考试平台");
    expect(screen.getByTestId("subtitle").textContent).toBe(
      "内部考核与准入控制",
    );
  });

  it("uses provided value over fallback", () => {
    render(
      <BrandProvider
        value={{ productName: "Custom", productSubtitle: "Custom Sub" }}
      >
        <BrandingDisplay />
      </BrandProvider>,
    );
    expect(screen.getByTestId("name").textContent).toBe("Custom");
    expect(screen.getByTestId("subtitle").textContent).toBe("Custom Sub");
  });

  it("fetches remote branding when loadRemote is true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          productName: "Remote",
          productSubtitle: "Remote Sub",
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BrandProvider loadRemote>
        <BrandingDisplay />
      </BrandProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("name").textContent).toBe("Remote");
    });
    expect(screen.getByTestId("subtitle").textContent).toBe("Remote Sub");
  });

  it("falls back to provided value on fetch failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BrandProvider
        value={{ productName: "Fallback", productSubtitle: "Fallback Sub" }}
        loadRemote
      >
        <BrandingDisplay />
      </BrandProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("name").textContent).toBe("Fallback");
    });
  });
});
