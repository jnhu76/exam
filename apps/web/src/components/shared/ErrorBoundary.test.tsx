import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientEvent } from "@exam/contracts";
import type { ClientEventBuffer } from "@/lib/clientEventBuffer";
import { setBuffer } from "@/lib/logger";
import { ErrorBoundary } from "./ErrorBoundary";

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error message");
  }
  return <div>Child content</div>;
}

/**
 * Buffer stand-in recording the events the boundary reports, so tests can
 * assert exactly what would be persisted for a render crash.
 */
class RecordingBuffer {
  readonly events: ClientEvent[] = [];
  push(event: ClientEvent): void {
    this.events.push(event);
  }
  dispose(): void {}
}

let recording: RecordingBuffer;

beforeEach(() => {
  recording = new RecordingBuffer();
  setBuffer(recording as unknown as ClientEventBuffer);
});

afterEach(() => {
  setBuffer(null);
});

describe("ErrorBoundary telemetry", () => {
  it("reports a category-only web.render_error event without raw content", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function TypeThrower(): never {
      throw new TypeError("secret-token-abc");
    }

    render(
      <ErrorBoundary>
        <TypeThrower />
      </ErrorBoundary>,
    );

    expect(recording.events).toHaveLength(1);
    const event = recording.events[0]!;
    expect(event.kind).toBe("log");
    expect(event.level).toBe("error");
    expect(event.name).toBe("web.render_error");
    expect(event.metadata).toEqual({ errorName: "TypeError" });
    // The persisted event carries the category only — never the raw message.
    expect(JSON.stringify(event)).not.toContain("secret-token-abc");
  });

  it("records exactly one web.render_error per caught error under StrictMode and remounts", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(
      <StrictMode>
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>
      </StrictMode>,
    );
    unmount();
    render(
      <StrictMode>
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>
      </StrictMode>,
    );

    // StrictMode double-render and the remount each catch exactly one error:
    // one event per caught error, no duplicates, no recursive logging.
    expect(recording.events).toHaveLength(2);
    expect(recording.events.every((e) => e.name === "web.render_error")).toBe(
      true,
    );
    expect(
      recording.events.every(
        (e) => e.level === "error" && e.metadata?.errorName === "Error",
      ),
    ).toBe(true);
  });
});

describe("ErrorBoundary", () => {
  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("renders the localized generic card when a child throws (T10)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("系统错误")).toBeInTheDocument();
    expect(screen.getByText("应用程序遇到了一个意外错误")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /重新加载/ }),
    ).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("T10: raw diagnostic message never renders in the production surface", async () => {
    vi.stubEnv("DEV", false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("系统错误")).toBeInTheDocument();
    expect(screen.queryByText("Test error message")).not.toBeInTheDocument();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps raw runtime message inside the development-only details surface", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    // vitest runs with import.meta.env.DEV === true, so the dev details
    // surface renders; the raw message must live only inside it.
    const raw = screen.getByText("Test error message");
    expect(raw.closest("details")).not.toBeNull();
    vi.restoreAllMocks();
  });

  it("renders the localized card even when the error has no message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const BadComponent = (): never => {
      throw new Error();
    };
    render(
      <ErrorBoundary>
        <BadComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText("系统错误")).toBeInTheDocument();
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
