import Redis from "ioredis";
import { RuntimeConfigError } from "@exam/domain";
import type { RedisConfig, RedisMode } from "../config/runtimeConfig.js";

/**
 * Redis runtime lifecycle (P7 — Redis first real adoption).
 *
 * Models the Redis client lifecycle explicitly instead of a boolean:
 * `disabled | connecting | ready | degraded | closing`, plus a
 * `degradedReason`. The runtime owns:
 *
 * - bounded connection behavior (connect timeout, command timeout, bounded
 *   retry backoff, no offline queueing — commands fail fast instead of
 *   buffering forever);
 * - safe handling of every client event (`error`, `close`, `reconnecting`,
 *   `ready`, `end`) — no emitted `error` may crash the process;
 * - structured transition logs (`redis.ready`, `redis.recovering`,
 *   `redis.unavailable`, `redis.closing`) only on state changes — no log
 *   storms on every retry;
 * - bounded graceful shutdown that never hangs on `quit()`.
 *
 * Mode semantics (from runtime config):
 * - `off`: client never created; state stays `disabled`.
 * - `optional`: unhealthy Redis degrades to local rate limiting; startup
 *   never hangs and never crashes; recovery is automatic via reconnect.
 * - `required`: startup fails deterministically inside the bounded startup
 *   window; at runtime the store fails closed (no silent local fallback).
 */

export type RedisLifecycleState =
  | "disabled"
  | "connecting"
  | "ready"
  | "degraded"
  | "closing";

export type RedisDegradedReason =
  | "startup_timeout"
  | "connection_lost"
  | "command_failure"
  | "retry_exhausted"
  | null;

export interface RedisRuntimeSnapshot {
  mode: RedisMode;
  state: RedisLifecycleState;
  connected: boolean;
  latencyMs: number | null;
  degradedReason: RedisDegradedReason;
}

/** Minimal pino-compatible logger surface (fastify.log satisfies this). */
export interface RuntimeLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/** The client surface the runtime drives (tests inject a fake). */
export interface RedisClientLike {
  status: string;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect(): void;
  ping(): Promise<unknown>;
}

export interface RedisRuntimeOptions {
  config: RedisConfig;
  logger: RuntimeLogger;
  /** ADR-006 time authority for latency measurement (defaults to Date). */
  now?: () => Date;
  /** Injectable client factory for unit tests. */
  clientFactory?: (config: RedisConfig) => RedisClientLike;
  /** Bounded shutdown grace for `quit()` (default 2000ms). */
  closeTimeoutMs?: number;
}

/** Default shutdown grace for `quit()` (bounded; never hangs). */
const DEFAULT_CLOSE_TIMEOUT_MS = 2000;

/**
 * Bounded reconnect backoff (ms): 200ms → 2s, never giving up while the
 * runtime is active so an outage can recover automatically. The delay is
 * bounded, which is what "bounded retry behavior" means here; unbounded
 * *attempts* are deliberate for `optional` auto-recovery, and `required`
 * startup is bounded separately by the startup window.
 */
export function buildRetryDelay(times: number): number {
  return Math.min(200 * 2 ** (times - 1), 2000);
}

export class RedisRuntime {
  readonly mode: RedisMode;
  readonly url: string | null;
  readonly keyPrefix: string;

  private readonly config: RedisConfig;
  private readonly logger: RuntimeLogger;
  private readonly now: () => Date;
  private readonly clientFactory: (config: RedisConfig) => RedisClientLike;
  private readonly closeTimeoutMs: number;

  private clientInternal: RedisClientLike | null = null;
  private stateInternal: RedisLifecycleState = "disabled";
  private degradedReasonInternal: RedisDegradedReason = null;
  private lastLatencyMsInternal: number | null = null;

  constructor(options: RedisRuntimeOptions) {
    this.config = options.config;
    this.mode = options.config.mode;
    this.url = options.config.url;
    this.keyPrefix = options.config.keyPrefix;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.clientFactory = options.clientFactory ?? createIoredisClient;
    this.closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    if (this.mode === "off") {
      this.stateInternal = "disabled";
    }
  }

  /** A disabled runtime (used when the redis plugin is not registered). */
  static disabled(): RedisRuntime {
    return new RedisRuntime({
      config: {
        mode: "off",
        url: null,
        enabled: false,
        keyPrefix: "",
        connectTimeoutMs: 0,
        commandTimeoutMs: 0,
        startupTimeoutMs: 0,
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
  }

  get state(): RedisLifecycleState {
    return this.stateInternal;
  }

  get degradedReason(): RedisDegradedReason {
    return this.degradedReasonInternal;
  }

  get lastLatencyMs(): number | null {
    return this.lastLatencyMsInternal;
  }

  /** The underlying client (null in `off` mode and before start). */
  get client(): Redis | null {
    return this.clientInternal as Redis | null;
  }

  /**
   * Start the runtime: create the client and establish (or attempt) the
   * connection inside the bounded startup window.
   *
   * - `off`: no-op, state stays `disabled`.
   * - `optional`: on timeout the runtime degrades (startup_timeout) and the
   *   client keeps reconnecting in the background — never throws.
   * - `required`: on timeout the client is disconnected and a
   *   {@link RuntimeConfigError} is thrown so startup fails deterministically.
   */
  async start(): Promise<void> {
    if (this.mode === "off") {
      this.setState("disabled");
      return;
    }
    if (!this.clientInternal) {
      this.clientInternal = this.clientFactory(this.config);
      this.wireEvents(this.clientInternal);
    }
    this.setState("connecting");
    const client = this.clientInternal;

    const connectPromise = client.connect();
    // Never allow a rejected connect promise to become an unhandled
    // rejection: the race below observes it, and later disconnects can also
    // reject it after the fact.
    connectPromise.catch(() => {});

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("redis startup timeout")),
        this.config.startupTimeoutMs,
      );
    });

    try {
      await Promise.race([connectPromise, timeoutPromise]);
      // The 'ready' event (or its absence during the ready-check) settles the
      // state; connect() resolving merely means the socket is up.
    } catch (err) {
      const isStartupTimeout =
        (err as Error).message === "redis startup timeout";
      if (this.mode === "required") {
        client.disconnect();
        this.setState(
          "degraded",
          isStartupTimeout ? "startup_timeout" : "connection_lost",
        );
        throw new RuntimeConfigError(
          `REDIS_MODE=required: Redis did not become ready within ${this.config.startupTimeoutMs}ms (${this.url})`,
        );
      }
      this.setState(
        "degraded",
        isStartupTimeout ? "startup_timeout" : "connection_lost",
      );
      // optional: keep the client retrying in the background; recovery is
      // driven by the 'ready' event.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** True when the shared Redis store should be used. */
  shouldUseRedis(): boolean {
    return this.stateInternal === "ready" && this.clientInternal !== null;
  }

  /**
   * Called by the rate-limit store when a Redis command failed. Only
   * degrades when the connection itself is unhealthy — a transient command
   * timeout on a healthy connection falls back for that request but keeps
   * trying Redis next time (no stuck-degraded state).
   */
  noteRedisCommandError(): void {
    if (this.stateInternal !== "ready") return;
    const healthy = this.clientInternal?.status === "ready";
    if (!healthy) {
      this.setState("degraded", "command_failure");
    }
  }

  /**
   * Measure ping latency (ADR-006 time authority). Returns null when Redis
   * is not ready or the ping fails; a failed ping on an unhealthy connection
   * degrades the runtime.
   */
  async pingLatency(): Promise<number | null> {
    if (this.stateInternal !== "ready" || !this.clientInternal) return null;
    const start = this.now().getTime();
    try {
      await this.clientInternal.ping();
      this.lastLatencyMsInternal = this.now().getTime() - start;
      return this.lastLatencyMsInternal;
    } catch {
      this.noteRedisCommandError();
      return null;
    }
  }

  /** Diagnostics snapshot — never includes secrets or the full URL. */
  snapshot(): RedisRuntimeSnapshot {
    return {
      mode: this.mode,
      state: this.stateInternal,
      connected: this.stateInternal === "ready",
      latencyMs: this.lastLatencyMsInternal,
      degradedReason: this.degradedReasonInternal,
    };
  }

  /**
   * Graceful shutdown: stop accepting new Redis-dependent work and close the
   * client without ever hanging on `quit()`. Safe in every lifecycle state
   * (disconnected, connecting, ready, reconnecting, end).
   */
  async close(): Promise<void> {
    if (this.stateInternal === "closing" || this.stateInternal === "disabled") {
      return;
    }
    this.setState("closing");
    const client = this.clientInternal;
    if (!client) return;
    try {
      await Promise.race([
        client.quit(),
        new Promise((resolve) => setTimeout(resolve, this.closeTimeoutMs)),
      ]);
    } catch {
      /* ignore: bounded close must never throw */
    }
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
  }

  private wireEvents(client: RedisClientLike): void {
    // Every listener is defensive: no emitted event may crash the process.
    client.on("error", () => {
      // Errors accompany close/reconnecting transitions; the transition
      // handlers log once. Attaching a listener is what prevents crashes.
    });
    client.on("close", () => {
      if (this.stateInternal === "ready") {
        this.setState("degraded", "connection_lost");
      }
    });
    client.on("reconnecting", () => {
      if (this.stateInternal === "ready") {
        this.setState("degraded", "connection_lost");
      }
    });
    client.on("end", () => {
      if (this.stateInternal !== "closing") {
        this.setState("degraded", "retry_exhausted");
      }
    });
    client.on("ready", () => {
      if (this.stateInternal === "ready") return;
      const recovered = this.stateInternal === "degraded";
      this.setState("ready", null);
      if (recovered) {
        this.logger.info({ redis: { mode: this.mode } }, "redis.recovered");
      } else {
        this.logger.info({ redis: { mode: this.mode } }, "redis.ready");
      }
    });
  }

  private setState(
    state: RedisLifecycleState,
    reason: RedisDegradedReason = null,
  ): void {
    if (this.stateInternal === state) return;
    const prev = this.stateInternal;
    this.stateInternal = state;
    this.degradedReasonInternal = reason;
    if (state === "closing") {
      this.logger.info({ redis: { mode: this.mode } }, "redis.closing");
    } else if (state === "degraded" && prev !== "closing") {
      this.logger.warn(
        { redis: { mode: this.mode, degradedReason: reason } },
        "redis.unavailable",
      );
    }
  }
}

/**
 * Create the production ioredis client with bounded behavior:
 * connect/command timeouts, bounded backoff, no offline queueing (commands
 * fail fast instead of buffering), lazyConnect (start controls when to
 * connect), and the existing keyPrefix semantics.
 */
function createIoredisClient(config: RedisConfig): RedisClientLike {
  return new Redis(config.url ?? "redis://localhost:6379", {
    keyPrefix: config.keyPrefix,
    lazyConnect: true,
    connectTimeout: config.connectTimeoutMs,
    commandTimeout: config.commandTimeoutMs,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy(times: number) {
      return buildRetryDelay(times);
    },
  });
}
