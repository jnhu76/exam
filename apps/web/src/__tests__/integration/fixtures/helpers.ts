import { render, RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RenderResult } from "@testing-library/react";

export function createMockRouter() {
  return {
    pathname: "/",
    search: "",
    hash: "",
    state: null,
    key: "default",
    push: () => {},
    replace: () => {},
    go: () => {},
    goBack: () => {},
    goForward: () => {},
  };
}

export const customRender = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult => {
  return render(ui, { ...options });
};

export const createMockUserEvent = () => userEvent.setup();

export const waitForLoadingToFinish = async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
};
