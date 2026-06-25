import type {
  ClientEvent,
  ClientEventKind,
  ClientEventLevel,
} from "@exam/contracts";
import { ClientEventBuffer } from "./clientEventBuffer";
import { sanitizeClientEvent } from "./sanitizeClientEvent";

/**
 * Frontend logger. This is the only business-facing API for recording
 * frontend errors and runtime state. It replaces ad-hoc `console.log` /
 * `console.error` usage (which the project forbids via
 * `check-code-quality.mjs`) with a structured, server-backed pipeline.
 *
 * Events flow: `logger.*` → sanitize → {@link ClientEventBuffer} → batched
 * POST to `/api/client-events`. Business code must never call the endpoint
 * or `console.*` directly.
 */

/** Lazy-initialized singleton buffer. Created on first use. */
let buffer: ClientEventBuffer | null = null;

/**
 * Returns the singleton buffer, creating it on first use. Exported primarily
 * for tests; business code uses {@link logger}.
 */
export function getBuffer(): ClientEventBuffer {
  if (buffer === null) {
    buffer = new ClientEventBuffer();
  }
  return buffer;
}

/**
 * Replaces the singleton buffer (testing only). Disposes the prior buffer if
 * one existed. Call with `null` to force re-creation on next use.
 */
export function setBuffer(next: ClientEventBuffer | null): void {
  buffer?.dispose();
  buffer = next;
}

/**
 * Captures the current route path for telemetry, if running in a browser.
 * Kept minimal: just `location.pathname`, never the query string (which may
 * carry tokens).
 */
function currentRoute(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.location.pathname;
}

/**
 * Builds and enqueues a client event. Never throws — metadata is sanitized
 * and the buffer push is non-throwing.
 */
function record(
  level: ClientEventLevel,
  name: string,
  metadata?: Record<string, unknown>,
  kind: ClientEventKind = "log",
): void {
  const event: ClientEvent = {
    kind,
    level,
    name,
    occurredAt: new Date().toISOString(),
    route: currentRoute(),
    ...(metadata !== undefined
      ? { metadata: sanitizeClientEvent(metadata) }
      : {}),
  };
  try {
    getBuffer().push(event);
  } catch {
    // Logging must never disturb the caller. Swallow.
  }
}

/**
 * The frontend logger. Use `logger.error` for failures that should be
 * investigated, `logger.warn` for degraded-but-recoverable situations,
 * `logger.info` for notable normal events, and `logger.debug` for verbose
 * diagnostics. `name` must be a stable, machine-friendly identifier.
 */
export const logger = {
  debug(name: string, metadata?: Record<string, unknown>): void {
    record("debug", name, metadata);
  },
  info(name: string, metadata?: Record<string, unknown>): void {
    record("info", name, metadata);
  },
  warn(name: string, metadata?: Record<string, unknown>): void {
    record("warn", name, metadata);
  },
  error(name: string, metadata?: Record<string, unknown>): void {
    record("error", name, metadata);
  },
};

export type Logger = typeof logger;
