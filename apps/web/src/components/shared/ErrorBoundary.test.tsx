import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error message");
  }
  return <div>Child content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("renders error UI when child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("系统错误")).toBeInTheDocument();
    expect(screen.getByText("Test error message")).toBeInTheDocument();
    expect(screen.queryByText("Child content")).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("renders unknown error fallback when error has no message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const BadComponent = (): never => {
      throw new Error();
    };
    render(
      <ErrorBoundary>
        <BadComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText("未知错误")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("renders reload button", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(
      screen.getByRole("button", { name: /重新加载/ }),
    ).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("handleReset calls window.location.reload", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reloadSpy = vi.fn();
    vi.stubGlobal(
      "location",
      Object.defineProperty({}, "reload", {
        value: reloadSpy,
        writable: true,
      }),
    );

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    const button = screen.getByRole("button", { name: /重新加载/ });
    button.click();

    expect(reloadSpy).toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
