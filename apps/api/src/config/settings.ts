/**
 * Application semantic settings — the ONE model of what the API runtime
 * reads from the environment (#370).
 *
 * This module owns, per leaf: the env name (the property key), the primitive
 * parser, the semantic default, runtime requiredness, and the production
 * Docker binding classification. It deliberately owns NOTHING about
 * topologies: no WSL ports, no CI job names, no Compose service wiring —
 * profiles produce environment VALUES, this module defines MEANING.
 *
 * Consumption contract:
 *   - `runtimeConfig.ts` is the ONLY runtime consumer; it layers cross-field
 *     and mode policy on top of `resolveSettings()` (see its header).
 *   - `scripts/repository-contract/config-contract.mjs` imports this file
 *     directly (Node ≥23.6 strips erasable type syntax, so the module is
 *     loadable from plain .mjs without a build step). It therefore MUST NOT
 *     import workspace packages — that constraint is what keeps the contract
 *     gate runnable in a fresh checkout before any `pnpm build`.
 *     Consequently this file defines no enum/namespace/parameter-property
 *     syntax (not erasable) and throws plain `SettingsError`s, which
 *     runtimeConfig wraps into `RuntimeConfigError` for callers.
 *
 * INVARIANT: an empty or whitespace-only env value is UNSET. A set-but-empty
 * variable (Compose `${KEY:-}` forwards, dotenv templates) must resolve to
 * the semantic default, never to a parse error. This mirrors the established
 * TEST_DATABASE_URL contract ("set-but-empty counts as unset").
 *
 * Cross-field constraints (smtp ⇒ SMTP_HOST, redis mode/url relations,
 * worker lease inequality, heartbeat divisibility, dependent defaults such
 * as DEADLINE_SCAN_INTERVAL_MS ← HEARTBEAT_SCAN_INTERVAL_MS) are runtime
 * POLICY and live in runtimeConfig.ts — this model stays primitive.
 */

/** Modes requiredness can depend on. Structural twin of `AppMode` in @exam/db. */
export type SettingsMode = "development" | "test" | "e2e" | "ci" | "production";

/**
 * How the production Docker topology binds this leaf. A contract-facing
 * semantic fact (what KIND of binding is legitimate), never a topology
 * implementation detail.
 *
 * - operator: Compose forwards `${KEY:-…}`; the operator may set it.
 * - required: production-required secret; Compose must use `${KEY:?…}`.
 * - derived:  Compose derives a topology value (e.g. from EXAM_PORT) —
 *             legitimate because the runtime's non-production default
 *             (Vite dev port) must not leak into a deployment.
 * - container: Compose hardcodes the container identity value.
 * - composed:  Compose composes the value from other variables
 *              (DATABASE_URL from POSTGRES_*).
 * - dev-only:  never read inside the production container.
 */
export type SettingBinding =
  | "operator"
  | "required"
  | "derived"
  | "container"
  | "composed"
  | "dev-only";

export type SettingValue = string | number | boolean | null | undefined;

/** Error thrown for invalid/missing settings; runtimeConfig wraps it. */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

export interface ResolveContext {
  readonly mode: SettingsMode;
  /** The env name being resolved (the SETTINGS property key). */
  readonly envName: string;
}

export interface SettingLeaf<T = SettingValue> {
  /** Primitive kind label — human/contract diagnostics, not a parser. */
  readonly kind: string;
  /** Parse + validate the raw string; empty means unset (see INVARIANT). */
  readonly resolve: (raw: string | undefined, ctx: ResolveContext) => T;
  /**
   * Raw (env-string form) semantic default, or null when the leaf has no
   * static default (delegated/dependent-derived leaves). Contract checks
   * compare Compose fallback literals against this — never a second copy.
   */
  readonly defaultRaw: string | null;
  /** Modes in which a missing/empty value fails fast. */
  readonly requiredIn: readonly SettingsMode[];
  /** Secret value — must never be echoed in logs/errors. */
  readonly secret: boolean;
  readonly binding: SettingBinding;
  /**
   * When set, resolution of this env var is owned by the named module
   * (e.g. @exam/db); the leaf exists for enumeration/contract purposes
   * only and resolve() always yields undefined. Orthogonal to `binding`,
   * which describes the Compose binding regardless of who resolves.
   */
  readonly delegatedTo?: string;
}

export interface LeafOptions {
  readonly requiredIn?: readonly SettingsMode[];
  readonly secret?: boolean;
  readonly binding?: SettingBinding;
}

interface LeafContext {
  readonly envName: string;
}

function isEmpty(raw: string | undefined): boolean {
  return raw === undefined || raw.trim() === "";
}

function requiredMessage(envName: string, mode: SettingsMode): string {
  return `${envName} is required in ${mode}`;
}

// ── Primitive leaf factories ────────────────────────────────────────────────
// Only the primitives the runtime actually consumes exist here. Adding a new
// one requires a real consumer first (config-contract fails unconsumed
// leaves), so this set does not grow speculatively.

function stringLeaf(
  defaultValue: string,
  opts: LeafOptions & { trim?: boolean } = {},
): SettingLeaf<string> {
  const {
    trim = false,
    requiredIn = [],
    secret = false,
    binding = "operator",
  } = opts;
  return {
    kind: trim ? "trimmed-string" : "string",
    resolve: (raw, ctx) => {
      if (isEmpty(raw)) {
        if (requiredIn.includes(ctx.mode)) {
          throw new SettingsError(requiredMessage(ctx.envName, ctx.mode));
        }
        return defaultValue;
      }
      const value = raw as string;
      return trim ? value.trim() : value;
    },
    defaultRaw: defaultValue,
    requiredIn,
    secret,
    binding,
  };
}

/** Secret string whose absence in production fails fast. */
function secretStringLeaf(
  defaultValue: string,
  requiredInProduction: boolean,
): SettingLeaf<string> {
  return stringLeaf(defaultValue, {
    trim: false,
    secret: true,
    binding: requiredInProduction ? "required" : "operator",
    requiredIn: requiredInProduction ? (["production"] as const) : [],
  });
}

/**
 * Lenient boolean: only "true"/"1" (case-sensitive) are truthy; anything
 * else — including garbage — is false. Used for switches where a typo must
 * not take the deployment down.
 */
function truthyLeaf(opts: LeafOptions = {}): SettingLeaf<boolean> {
  const { requiredIn = [], secret = false, binding = "operator" } = opts;
  return {
    kind: "truthy-bool",
    resolve: (raw, ctx) => {
      if (isEmpty(raw)) {
        if (requiredIn.includes(ctx.mode)) {
          throw new SettingsError(requiredMessage(ctx.envName, ctx.mode));
        }
        return false;
      }
      const value = (raw as string).trim();
      return value === "true" || value === "1";
    },
    defaultRaw: "false",
    requiredIn,
    secret,
    binding,
  };
}

/**
 * Strict boolean: exactly "true"/"false" (case-sensitive). A misspelled
 * value is a misconfiguration and fails fast instead of silently coercing.
 */
function strictBoolLeaf(
  defaultValue: boolean,
  opts: LeafOptions = {},
): SettingLeaf<boolean> {
  const { requiredIn = [], secret = false, binding = "operator" } = opts;
  return {
    kind: "strict-bool",
    resolve: (raw, ctx) => {
      if (isEmpty(raw)) {
        if (requiredIn.includes(ctx.mode)) {
          throw new SettingsError(requiredMessage(ctx.envName, ctx.mode));
        }
        return defaultValue;
      }
      const value = (raw as string).trim();
      if (value === "true") return true;
      if (value === "false") return false;
      throw new SettingsError(
        `${ctx.envName} must be "true" or "false" (got: ${raw})`,
      );
    },
    defaultRaw: defaultValue ? "true" : "false",
    requiredIn,
    secret,
    binding,
  };
}

/**
 * Lenient positive integer with NO leaf-level default: unset → `undefined`,
 * invalid input → `undefined` (never throws). The semantic fallback lives
 * in runtime policy, where mode-dependent chains
 * (APP_PORT ?? DEV_API_PORT ?? 3000) need the distinction between "unset"
 * and "set"; `defaultRaw` still documents the semantic fallback for
 * contracts.
 */
function optionalLenientIntLeaf(
  fallback: number,
  opts: LeafOptions = {},
): SettingLeaf<number | undefined> {
  const { requiredIn = [], secret = false, binding = "operator" } = opts;
  return {
    kind: "optional-lenient-positive-int",
    resolve: (raw, ctx) => {
      if (isEmpty(raw)) {
        if (requiredIn.includes(ctx.mode)) {
          throw new SettingsError(requiredMessage(ctx.envName, ctx.mode));
        }
        return undefined;
      }
      const trimmed = (raw as string).trim();
      if (!/^\d+$/.test(trimmed)) return undefined;
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0) return undefined;
      return n;
    },
    defaultRaw: String(fallback),
    requiredIn,
    secret,
    binding,
  };
}

/**
 * Lenient positive integer: invalid input silently falls back to the
 * default (legacy port/limit semantics — see runtimeConfig history).
 */
function lenientIntLeaf(
  defaultValue: number,
  opts: LeafOptions = {},
): SettingLeaf<number> {
  const { requiredIn = [], secret = false, binding = "operator" } = opts;
  return {
    kind: "lenient-positive-int",
    resolve: (raw, ctx) => {
      if (isEmpty(raw)) {
        if (requiredIn.includes(ctx.mode)) {
          throw new SettingsError(requiredMessage(ctx.envName, ctx.mode));
        }
        return defaultValue;
      }
      const trimmed = (raw as string).trim();
      if (!/^\d+$/.test(trimmed)) return defaultValue;
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0) return defaultValue;
      return n;
    },
    defaultRaw: String(defaultValue),
    requiredIn,
    secret,
    binding,
  };
}

/** Strict positive integer (≥1): non-numeric/non-positive values throw. */
function posIntLeaf(
  defaultValue: number,
  opts: LeafOptions = {},
): SettingLeaf<number> {
  const { requiredIn = [], secret = false, binding = "operator" } = opts;
  return {
    kind: "strict-positive-int",
    resolve: (raw, ctx) => {
      if (isEmpty(raw)) {
        if (requiredIn.includes(ctx.mode)) {
          throw new SettingsError(requiredMessage(ctx.envName, ctx.mode));
        }
        return defaultValue;
      }
      const trimmed = (raw as string).trim();
      if (!/^\d+$/.test(trimmed)) {
        throw new SettingsError(
          `${ctx.envName} must be a positive integer (got: ${raw})`,
        );
      }
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0) {
        throw new SettingsError(
          `${ctx.envName} must be a positive integer (got: ${raw})`,
        );
      }
      return n;
    },
    defaultRaw: String(defaultValue),
    requiredIn,
    secret,
    binding,
  };
}

/**
 * Strict positive integer with NO static default: resolves to `undefined`
 * when unset so runtime policy can apply a dependent default
 * (DEADLINE_SCAN_INTERVAL_MS defaults to HEARTBEAT_SCAN_INTERVAL_MS).
 */
function optionalPosIntLeaf(
  opts: LeafOptions = {},
): SettingLeaf<number | undefined> {
  const { requiredIn = [], secret = false, binding = "operator" } = opts;
  return {
    kind: "optional-positive-int",
    resolve: (raw, ctx) => {
      if (isEmpty(raw)) {
        if (requiredIn.includes(ctx.mode)) {
          throw new SettingsError(requiredMessage(ctx.envName, ctx.mode));
        }
        return undefined;
      }
      const trimmed = (raw as string).trim();
      if (!/^\d+$/.test(trimmed)) {
        throw new SettingsError(
          `${ctx.envName} must be a positive integer (got: ${raw})`,
        );
      }
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0) {
        throw new SettingsError(
          `${ctx.envName} must be a positive integer (got: ${raw})`,
        );
      }
      return n;
    },
    defaultRaw: null,
    requiredIn,
    secret,
    binding,
  };
}

/** Strict non-negative integer (≥0). */
function nonNegIntLeaf(
  defaultValue: number,
  opts: LeafOptions = {},
): SettingLeaf<number> {
  const { requiredIn = [], secret = false, binding = "operator" } = opts;
  return {
    kind: "strict-non-negative-int",
    resolve: (raw, ctx) => {
      if (isEmpty(raw)) {
        if (requiredIn.includes(ctx.mode)) {
          throw new SettingsError(requiredMessage(ctx.envName, ctx.mode));
        }
        return defaultValue;
      }
      const trimmed = (raw as string).trim();
      if (!/^\d+$/.test(trimmed)) {
        throw new SettingsError(
          `${ctx.envName} must be a non-negative integer (got: ${raw})`,
        );
      }
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        throw new SettingsError(
          `${ctx.envName} must be a non-negative integer (got: ${raw})`,
        );
      }
      return n;
    },
    defaultRaw: String(defaultValue),
    requiredIn,
    secret,
    binding,
  };
}

/**
 * Strict enum. Without `defaultValue` the resolved value is `undefined`
 * when unset — the derived default then belongs to runtime policy
 * (e.g. REDIS_MODE derives from REDIS_URL presence).
 */
function enumLeaf<T extends string>(
  values: readonly T[],
  defaultValue: T,
  opts?: LeafOptions,
): SettingLeaf<T>;
function enumLeaf<T extends string>(
  values: readonly T[],
  defaultValue: null,
  opts?: LeafOptions,
): SettingLeaf<T | undefined>;
function enumLeaf<T extends string>(
  values: readonly T[],
  defaultValue: T | null,
  opts: LeafOptions = {},
): SettingLeaf<T | undefined> {
  const { requiredIn = [], secret = false, binding = "operator" } = opts;
  const quoted = values.map((v) => `"${v}"`);
  const list =
    quoted.length <= 1
      ? (quoted.join("") ?? "")
      : `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
  return {
    kind: "enum",
    resolve: (raw, ctx) => {
      if (isEmpty(raw)) {
        if (requiredIn.includes(ctx.mode)) {
          throw new SettingsError(requiredMessage(ctx.envName, ctx.mode));
        }
        return defaultValue ?? undefined;
      }
      const value = (raw as string).trim();
      if ((values as readonly string[]).includes(value)) return value as T;
      throw new SettingsError(`${ctx.envName} must be ${list} (got: ${raw})`);
    },
    defaultRaw: defaultValue,
    requiredIn,
    secret,
    binding,
  };
}

/**
 * IANA timezone, validated by probing the runtime's Intl.DateTimeFormat so
 * an invalid zone fails fast at startup (ADR-006: display/log only — never
 * a business-time authority).
 */
function timezoneLeaf(
  defaultValue: string,
  opts: LeafOptions = {},
): SettingLeaf<string> {
  const { requiredIn = [], secret = false, binding = "operator" } = opts;
  return {
    kind: "iana-timezone",
    resolve: (raw, ctx) => {
      if (isEmpty(raw)) {
        if (requiredIn.includes(ctx.mode)) {
          throw new SettingsError(requiredMessage(ctx.envName, ctx.mode));
        }
        return defaultValue;
      }
      const value = (raw as string).trim();
      try {
        // eslint-disable-next-line no-new
        new Intl.DateTimeFormat("en-US", { timeZone: value });
      } catch {
        throw new SettingsError(
          `Invalid ${ctx.envName}: ${value}. Must be a valid IANA timezone (e.g. Asia/Shanghai).`,
        );
      }
      return value;
    },
    defaultRaw: defaultValue,
    requiredIn,
    secret,
    binding,
  };
}

/**
 * Absolute origin (scheme + host[+port], no path/search/hash/credentials).
 * Production requires the value; in other modes an unset value is left
 * `undefined` so runtime policy can derive the dev default from VITE_PORT
 * (a dependent default is policy, not a primitive).
 */
function originLeaf(
  opts: {
    requiredInProduction?: boolean;
    requiredMessage?: string;
  } = {},
): SettingLeaf<string | undefined> {
  const requiredIn: readonly SettingsMode[] = opts.requiredInProduction
    ? ["production"]
    : [];
  const shape =
    "must be an absolute origin (scheme + host[+port], no path, no trailing slash)";
  return {
    kind: "absolute-origin",
    resolve: (raw, ctx) => {
      if (isEmpty(raw)) {
        if (requiredIn.includes(ctx.mode)) {
          throw new SettingsError(
            opts.requiredMessage ?? requiredMessage(ctx.envName, ctx.mode),
          );
        }
        return undefined;
      }
      const value = (raw as string).trim();
      const trimmed = value.replace(/\/+$/, "");
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        throw new SettingsError(`${ctx.envName} ${shape}; got: ${value}`);
      }
      if (
        (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        (parsed.pathname !== "/" && parsed.pathname !== "")
      ) {
        throw new SettingsError(`${ctx.envName} ${shape}; got: ${value}`);
      }
      return trimmed;
    },
    defaultRaw: null,
    requiredIn,
    secret: false,
    binding: "derived",
  };
}

/**
 * Lenient NODE_ENV mapping (production | test | anything-else-is-dev).
 * NODE_ENV is a build/fallback signal; APP_MODE (delegated below) is the
 * authoritative mode.
 */
function appEnvLeaf(): SettingLeaf<"development" | "test" | "production"> {
  return {
    kind: "lenient-app-env",
    resolve: (raw) => {
      const value = (raw ?? "").trim();
      if (value === "production") return "production";
      if (value === "test") return "test";
      return "development";
    },
    defaultRaw: "development",
    requiredIn: [],
    secret: false,
    binding: "container",
  };
}

/**
 * DEPLOYMENT_MODE. Phase 1 is single-tenant only; `multiTenant` is a Phase 4
 * platformization capability and is rejected as a runnable mode. The raw
 * value is intentionally NOT echoed in the error (no config-value leaks).
 */
function deploymentModeLeaf(): SettingLeaf<"singleTenant"> {
  return {
    kind: "deployment-mode",
    resolve: (raw) => {
      const trimmed = raw?.trim();
      if (trimmed === undefined || trimmed === "") return "singleTenant";
      if (trimmed === "singleTenant") return "singleTenant";
      if (trimmed === "multiTenant") {
        throw new SettingsError(
          "DEPLOYMENT_MODE=multiTenant is not supported in Phase 1. " +
            "Phase 1 runtime is single-tenant only (singleTenant). " +
            "Optional multiTenant is a Phase 4 platformization capability.",
        );
      }
      throw new SettingsError(
        "Invalid DEPLOYMENT_MODE. Phase 1 runtime supports singleTenant only.",
      );
    },
    defaultRaw: "singleTenant",
    requiredIn: [],
    secret: false,
    binding: "operator",
  };
}

/**
 * Nullable trimmed string (REDIS_URL): unset/empty → null.
 */
function nullableStringLeaf(
  opts: LeafOptions = {},
): SettingLeaf<string | null> {
  const { requiredIn = [], secret = false, binding = "operator" } = opts;
  return {
    kind: "nullable-string",
    resolve: (raw, ctx) => {
      if (isEmpty(raw)) {
        if (requiredIn.includes(ctx.mode)) {
          throw new SettingsError(requiredMessage(ctx.envName, ctx.mode));
        }
        return null;
      }
      return (raw as string).trim();
    },
    defaultRaw: "",
    requiredIn,
    secret,
    binding,
  };
}

/**
 * Leaf whose resolution is delegated to a deeper owning module. The leaf
 * exists so contracts can enumerate the env name and its binding; the value
 * is always `undefined` here and the delegate module owns parsing,
 * requiredness errors, and safety guards. The Compose `binding` still
 * applies (e.g. APP_MODE is delegated AND container-bound in production).
 */
function delegatedLeaf(
  owner: string,
  opts: { binding: SettingBinding },
): SettingLeaf<undefined> {
  return {
    kind: "delegated",
    resolve: () => undefined,
    defaultRaw: null,
    requiredIn: [],
    secret: false,
    binding: opts.binding,
    delegatedTo: owner,
  };
}

// ── The settings model ──────────────────────────────────────────────────────
// Group names are semantic organization; leaf keys ARE the env names (the
// stable config ABI), so the consumption contract can match keys textually.

export const SETTINGS = {
  // Group order fixes the fail-fast precedence for production-required
  // leaves (JWT_SECRET → CORS_ORIGIN → PUBLIC_WEB_ORIGIN), matching the
  // historic runtimeConfig error order pinned by behavioral tests.
  auth: {
    JWT_SECRET: secretStringLeaf("development-only-change-me", true),
  },
  app: {
    // APP_MODE / DB URLs: resolution owned by @exam/db (parseAppMode /
    // resolveDatabaseUrl — mode routing + name-safety guards live there).
    // runtimeConfig delegates; these leaves exist for contract enumeration.
    APP_MODE: delegatedLeaf(
      "@exam/db parseAppMode — APP_MODE is authoritative, NODE_ENV the fallback",
      { binding: "container" },
    ),
    NODE_ENV: appEnvLeaf(),
    DEPLOYMENT_MODE: deploymentModeLeaf(),
    HOST: stringLeaf("0.0.0.0", { binding: "container" }),
    // No leaf-level default: the bind-port owner switch (APP_PORT vs
    // DEV_API_PORT by mode, fallback 3000) is runtime policy.
    APP_PORT: optionalLenientIntLeaf(3000, { binding: "container" }),
    DEV_API_PORT: optionalLenientIntLeaf(3000, { binding: "dev-only" }),
    // VITE_PORT owns the dev web port; string-valued (used to build origins).
    VITE_PORT: stringLeaf("5173", { trim: true, binding: "dev-only" }),
    COOKIE_SECURE: truthyLeaf(),
    API_DOCS_ENABLED: truthyLeaf(),
    RATE_LIMIT_DISABLED: truthyLeaf(),
    RATE_LIMIT_MAX: lenientIntLeaf(100),
    RATE_LIMIT_WINDOW_MS: lenientIntLeaf(60 * 1000),
    FEATURE_RESTORE_FRONTEND: truthyLeaf(),
    FEATURE_MANUAL_EXAM_OPEN_CLOSE: truthyLeaf(),
    FEATURE_LIVE_SCORE_LIST: truthyLeaf(),
    APP_TIMEZONE: timezoneLeaf("Asia/Shanghai"),
    HEARTBEAT_SCAN_INTERVAL_MS: posIntLeaf(30000),
    HEARTBEAT_TIMEOUT_MS: posIntLeaf(60000),
    // No static default: defaults to HEARTBEAT_SCAN_INTERVAL_MS (policy).
    DEADLINE_SCAN_INTERVAL_MS: optionalPosIntLeaf(),
    // Raw comma list; splitting/normalization is runtime policy.
    CORS_ORIGIN: stringLeaf("", {
      requiredIn: ["production"],
      binding: "derived",
    }),
    PUBLIC_WEB_ORIGIN: originLeaf({
      requiredInProduction: true,
      requiredMessage:
        "PUBLIC_WEB_ORIGIN is required in production (used to build Email links)",
    }),
    LAUNCHPAD_SETUP_TOKEN: stringLeaf("", { trim: true, secret: true }),
  },
  database: {
    // DATABASE_URL / TEST_DATABASE_URL / TEST_DB_URL resolution (mode
    // routing, construction from DB_HOST_PORT, test name-safety) is owned
    // by @exam/db databaseUrl.ts — a deep module this model delegates to
    // rather than re-implements.
    DATABASE_URL: delegatedLeaf("@exam/db resolveDatabaseUrl", {
      binding: "composed",
    }),
    TEST_DATABASE_URL: delegatedLeaf("@exam/db resolveTestBranchUrl", {
      binding: "dev-only",
    }),
    TEST_DB_URL: delegatedLeaf("@exam/db resolveTestBranchUrl (legacy alias)", {
      binding: "dev-only",
    }),
    // Escape hatch for the @exam/db test name-safety guard (delegated).
    ALLOW_UNSAFE_TEST_DATABASE_URL: delegatedLeaf(
      "@exam/db resolveTestBranchUrl escape hatch",
      { binding: "dev-only" },
    ),
    DB_HOST_PORT: delegatedLeaf(
      "@exam/db constructed-URL port (dev compose publish owner)",
      { binding: "dev-only" },
    ),
  },
  redis: {
    REDIS_URL: nullableStringLeaf(),
    // No static default: derives from REDIS_URL presence (policy).
    REDIS_MODE: enumLeaf(["off", "optional", "required"] as const, null),
    REDIS_KEY_PREFIX: stringLeaf(""),
    REDIS_CONNECT_TIMEOUT_MS: posIntLeaf(2000),
    REDIS_COMMAND_TIMEOUT_MS: posIntLeaf(1000),
    REDIS_STARTUP_TIMEOUT_MS: posIntLeaf(8000),
  },
  email: {
    EMAIL_ENABLED: truthyLeaf(),
    EMAIL_TRANSPORT: enumLeaf(["fake", "smtp"] as const, "fake"),
    EMAIL_FAKE_MODE: enumLeaf(["success", "failure"] as const, "success"),
    EMAIL_FAKE_DELAY_MS: nonNegIntLeaf(0),
    EMAIL_FROM: stringLeaf("no-reply@example.local", { trim: true }),
    EMAIL_FROM_NAME: stringLeaf("Exam Platform", { trim: true }),
    EMAIL_MAX_ATTEMPTS: posIntLeaf(3),
    EMAIL_RETRY_BASE_SECONDS: posIntLeaf(60),
    SMTP_HOST: stringLeaf("", { trim: true }),
    SMTP_PORT: posIntLeaf(587),
    SMTP_SECURE: strictBoolLeaf(false),
    SMTP_REQUIRE_TLS: strictBoolLeaf(true),
    SMTP_TLS_REJECT_UNAUTHORIZED: strictBoolLeaf(true),
    SMTP_TLS_SERVERNAME: stringLeaf("", { trim: true }),
    SMTP_CONNECTION_TIMEOUT_MS: posIntLeaf(10000),
    SMTP_GREETING_TIMEOUT_MS: posIntLeaf(10000),
    SMTP_SOCKET_TIMEOUT_MS: posIntLeaf(10000),
    SMTP_USER: stringLeaf(""),
    SMTP_PASSWORD: stringLeaf("", { secret: true }),
  },
  emailWorker: {
    // INVARIANT (#351 shutdown budget contract): EMAIL_WORKER_SHUTDOWN_
    // TIMEOUT_MS is one term of the deployment budget hierarchy —
    //   compose stop_grace_period (45s)
    //     > email loop drain (this, 8s) + audit drain (10s)
    //       + DB pool close (10s) + bounded exit assist (2s).
    // Do not raise it without raising stop_grace_period.
    EMAIL_WORKER_POLL_INTERVAL_MS: posIntLeaf(5000),
    EMAIL_WORKER_BATCH_SIZE: posIntLeaf(20),
    EMAIL_WORKER_LOCK_TIMEOUT_MS: posIntLeaf(300000),
    EMAIL_WORKER_HEARTBEAT_STALE_MS: posIntLeaf(60000),
    EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS: posIntLeaf(8000),
  },
} as const satisfies SettingsTree;

export type SettingsGroup = {
  readonly [leaf: string]: SettingLeaf<SettingValue>;
};

export type SettingsTree = {
  readonly [group: string]: SettingsGroup;
};

/** Resolved primitive values, nested like SETTINGS. */
export type ResolvedSettings = ResolvedTree<typeof SETTINGS>;

type ResolvedTree<T> = {
  readonly [K in keyof T]: T[K] extends SettingLeaf<infer V>
    ? V
    : T[K] extends SettingsGroup
      ? ResolvedTree<T[K]>
      : never;
};

/**
 * Resolve every settings leaf from `env` for the given mode, failing fast
 * on invalid primitives and production-required values. Cross-field policy
 * is layered on top by runtimeConfig — this function is pure resolution.
 */
export function resolveSettings(
  env: NodeJS.ProcessEnv,
  mode: SettingsMode,
): ResolvedSettings {
  const out: Record<string, Record<string, SettingValue>> = {};
  for (const [groupName, group] of Object.entries(SETTINGS)) {
    const resolvedGroup: Record<string, SettingValue> = {};
    for (const [leafName, leaf] of Object.entries(
      group as Record<string, SettingLeaf<SettingValue>>,
    )) {
      resolvedGroup[leafName] = leaf.resolve(env[leafName], {
        mode,
        envName: leafName,
      });
    }
    out[groupName] = resolvedGroup;
  }
  return out as unknown as ResolvedSettings;
}

// Re-exported for contract tooling: a flat (envName → leaf) view.
export function settingsLeaves(): Map<string, SettingLeaf<SettingValue>> {
  const leaves = new Map<string, SettingLeaf<SettingValue>>();
  for (const group of Object.values(
    SETTINGS as Record<string, Record<string, SettingLeaf<SettingValue>>>,
  )) {
    for (const [leafName, leaf] of Object.entries(group)) {
      leaves.set(leafName, leaf);
    }
  }
  return leaves;
}
