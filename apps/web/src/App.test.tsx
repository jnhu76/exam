import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { AppTitle } from "@/App";
import { BrandProvider } from "@/components/layout/BrandProvider";

function renderTitleProbe(route: string, productName = "测评平台") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <BrandProvider value={{ productName, productSubtitle: "" }}>
        <AppTitle />
      </BrandProvider>
    </MemoryRouter>,
  );
}

describe("AppTitle", () => {
  afterEach(() => {
    document.title = "";
  });

  it("syncs document title for admin routes", async () => {
    renderTitleProbe("/admin/settings");

    await waitFor(() => {
      expect(document.title).toBe("平台设置 - 测评平台");
    });
  });

  it("syncs document title for candidate-facing routes", async () => {
    renderTitleProbe("/exam/list");

    await waitFor(() => {
      expect(document.title).toBe("我的考试 - 测评平台");
    });
  });

  it("does not leave document title at loading fallback", async () => {
    document.title = "加载中";
    renderTitleProbe("/admin/dashboard", "");

    await waitFor(() => {
      expect(document.title).toBe("仪表盘 - 考试平台");
    });
  });
});
