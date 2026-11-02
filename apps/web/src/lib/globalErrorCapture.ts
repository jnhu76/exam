import { logger } from "./logger";
import { createTelemetryRateLimiter } from "./telemetryRateLimit";

/**
 * Window-level capture for errors that never reach any React boundary:
 * event-handler exceptions, setTimeout / async throws, and unhandled
 * promise rejections. These previously only surfaced in the browser console
 * (#800) — nothing server-side recorded them.
 *
 * Each occurrence is reported via {@link logger.error} under a stable event
 * name with category-only metadata: the error class name (or a
 * `non-error:<typeof>` tag). The raw message, stack, and any URL content are
 * never included — the logger adds only the route pathname as the location
 * identifier.
 *
 * A per-category fixed-window limiter keeps a rejection storm from flooding
 * the client-event buffer.
 */

/**
 * Builds the stable category identifier for an unknown thrown value.
 * INVARIANT: the return value is a bounded category — never a
 * content-derived string such as the error message or stack.
 */
function errorCategory(err: unknown): string {
  if (err instanceof Error) return err.name || "Error";
  return `non-error:${typeof err}`;
}

/**
 * Registers the global `error` / `unhandledrejection` handlers.
 * Returns a cleanup that removes them.
 */
export function registerGlobalErrorCapture(): () => void {
  const limiter = createTelemetryRateLimiter();

  function report(name: string, err: unknown): void {
    const errorName = errorCategory(err);
    if (!limiter.allow(`${name}|${errorName}`)) return;
    logger.error(name, { errorName });
  }

  const onError = (event: ErrorEvent): void => {
    report("web.unhandled_error", event.error);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    report("web.unhandled_rejection", event.reason);
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
