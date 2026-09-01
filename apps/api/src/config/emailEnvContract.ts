/**
 * Email env contract — the SINGLE semantic authority for the 24-key
 * Email / EmailWorker / SMTP env cluster (Phase C, Issue #367).
 *
 * The semantic facts live in `emailEnvContract.json` (the one file you edit
 * when a default, kind, membership, or deployment target changes):
 *   - membership (which keys exist)
 *   - primitive kind (how a raw env value parses)
 *   - semantic default
 *   - deployment target (which service consumes it)
 *
 * Values flow through `.env` → Compose → container → process.env → runtime,
 * but these semantic facts must NOT be re-decided at each layer. Runtime
 * (`runtimeConfig.ts`) and the Compose projection tooling both consume this
 * single authority; independent behavior tests and docs may keep their own
 * hard-coded expected values on purpose (they are independent oracles).
 *
 * The JSON file is shipped with the compiled app (tsc emits imported JSON to
 * `dist/`), so `resolveEmailEnv` works in both `tsx` dev and `node dist/`
 * production. The import attribute is required by Node ESM for JSON modules.
 */
import raw from "./emailEnvContract.json" with { type: "json" };
import { RuntimeConfigError } from "@exam/domain";

export type EmailEnvKey = keyof typeof raw;

export type EmailEnvKind =
  | "booleanTruthy" // "true"/"1" → true, anything else → false (never throws)
  | "boolean" // strict "true"/"false" (throws otherwise)
  | "positiveInt" // strict integer > 0 (throws otherwise)
  | "nonNegativeInt" // strict integer >= 0 (throws otherwise)
  | "string" // raw value trimmed
  | "secretString" // raw value verbatim (never trimmed — credentials)
  | "enum"; // trimmed value must be one of `values`

export interface EmailEnvEntry {
  kind: EmailEnvKind;
  default: boolean | number | string;
  values?: readonly string[];
  target: "app";
}

/** Domain of EMAIL_TRANSPORT (lower-case only, enforced by the resolver). */
export type EmailTransport = "fake" | "smtp";
/** Domain of EMAIL_FAKE_MODE. */
export type EmailFakeMode = "success" | "failure";

export type EmailEnvValueOf<K extends EmailEnvKey> = K extends "EMAIL_TRANSPORT"
  ? EmailTransport
  : K extends "EMAIL_FAKE_MODE"
    ? EmailFakeMode
    : K extends "EMAIL_ENABLED"
      ? boolean
      : (typeof raw)[K]["default"] extends number
        ? number
        : (typeof raw)[K]["default"] extends boolean
          ? boolean
          : string;

export type EmailEnvContract = Readonly<Record<EmailEnvKey, EmailEnvEntry>>;

// The JSON file is the single semantic authority. TS widens imported JSON
// string literals to `string`, so this one cast is the typed view boundary;
// the data shape is validated against the kind rules below at module load.
export const emailEnvContract = raw as EmailEnvContract;

export const EMAIL_ENV_KEYS: readonly EmailEnvKey[] = Object.keys(
  emailEnvContract,
) as EmailEnvKey[];

/**
 * Structural validation of a contract. Fail-loud guards: unsupported kind,
 * unsupported deployment target, and a default that contradicts its kind
 * (e.g. a `positiveInt` with a string default, or an enum default outside
 * `values`) all throw — so a corrupted JSON cannot silently produce
 * `undefined` inside the resolver's switch.
 */
export function validateEmailEnvContract(
  contract: Readonly<Record<string, EmailEnvEntry>>,
): void {
  const supportedKinds = new Set<EmailEnvKind>([
    "booleanTruthy",
    "boolean",
    "positiveInt",
    "nonNegativeInt",
    "string",
    "secretString",
    "enum",
  ]);
  for (const [key, entry] of Object.entries(contract)) {
    if (!supportedKinds.has(entry.kind)) {
      throw new Error(
        `Email env contract: ${key} has unsupported kind ${String(entry.kind)}`,
      );
    }
    if (entry.target !== "app") {
      throw new Error(
        `Email env contract: ${key} has unsupported deployment target ${String(entry.target)}`,
      );
    }
    switch (entry.kind) {
      case "booleanTruthy":
      case "boolean":
        if (typeof entry.default !== "boolean") {
          throw new Error(
            `Email env contract: ${key} (${entry.kind}) default must be a boolean`,
          );
        }
        break;
      case "positiveInt":
        if (
          typeof entry.default !== "number" ||
          !Number.isInteger(entry.default) ||
          entry.default <= 0
        ) {
          throw new Error(
            `Email env contract: ${key} (positiveInt) default must be a positive integer`,
          );
        }
        break;
      case "nonNegativeInt":
        if (
          typeof entry.default !== "number" ||
          !Number.isInteger(entry.default) ||
          entry.default < 0
        ) {
          throw new Error(
            `Email env contract: ${key} (nonNegativeInt) default must be a non-negative integer`,
          );
        }
        break;
      case "string":
      case "secretString":
        if (typeof entry.default !== "string") {
          throw new Error(
            `Email env contract: ${key} (${entry.kind}) default must be a string`,
          );
        }
        break;
      case "enum":
        if (
          typeof entry.default !== "string" ||
          !entry.values ||
          entry.values.length === 0 ||
          !entry.values.includes(entry.default)
        ) {
          throw new Error(
            `Email env contract: ${key} (enum) needs non-empty values containing its default`,
          );
        }
        break;
    }
  }
}

// The production contract is validated once at load: a typo'd kind or a
// default that contradicts its kind must fail fast, never fall through the
// resolver switch silently.
validateEmailEnvContract(emailEnvContract);

function invalidValue(
  key: string,
  rawValue: string,
  expectation: string,
): never {
  throw new RuntimeConfigError(
    `${key} must be ${expectation} (got: ${rawValue})`,
  );
}

function resolveByKind(
  entry: EmailEnvEntry,
  rawValue: string | undefined,
  key: string,
): boolean | number | string {
  switch (entry.kind) {
    case "booleanTruthy":
      return rawValue === undefined
        ? (entry.default as boolean)
        : rawValue === "true" || rawValue === "1";
    case "boolean":
      if (rawValue === undefined) return entry.default;
      if (rawValue === "true") return true;
      if (rawValue === "false") return false;
      return invalidValue(key, rawValue, '"true" or "false"');
    case "positiveInt":
    case "nonNegativeInt": {
      if (rawValue === undefined) return entry.default;
      const n = Number(rawValue.trim());
      const outOfRange =
        (entry.kind === "positiveInt" && n <= 0) ||
        (entry.kind === "nonNegativeInt" && n < 0);
      if (!Number.isInteger(n) || outOfRange) {
        return invalidValue(
          key,
          rawValue,
          entry.kind === "positiveInt"
            ? "a positive integer"
            : "a non-negative integer",
        );
      }
      return n;
    }
    case "string":
      return rawValue === undefined ? entry.default : rawValue.trim();
    case "secretString":
      return rawValue === undefined ? entry.default : rawValue;
    case "enum": {
      if (rawValue === undefined) return entry.default;
      const trimmed = rawValue.trim();
      if (!entry.values?.includes(trimmed)) {
        return invalidValue(
          key,
          rawValue,
          `one of: ${entry.values?.join(", ")}`,
        );
      }
      return trimmed;
    }
  }
}

/**
 * Resolve one env key against an arbitrary contract. Exposed for tests with
 * SYNTHETIC fixtures — production code should use {@link resolveEmailEnv}.
 */
export function resolveEmailEnvFrom(
  contract: Readonly<Record<string, EmailEnvEntry>>,
  env: NodeJS.ProcessEnv,
  key: string,
): boolean | number | string {
  const entry = contract[key];
  if (!entry) {
    throw new RuntimeConfigError(`Unknown Email env contract key: ${key}`);
  }
  return resolveByKind(entry, env[key], key);
}

/**
 * Resolve one Email env key from `env` using the contract's kind + default.
 *
 * This is the ONLY place primitive Email parsing lives; runtimeConfig.ts
 * calls it and keeps only cross-field / conditional / mode-specific behavior.
 * The parse semantics mirror the pre-contract resolver exactly (see
 * emailEnvContract.test.ts synthetic fixtures).
 */
export function resolveEmailEnv<K extends EmailEnvKey>(
  env: NodeJS.ProcessEnv,
  key: K,
): EmailEnvValueOf<K> {
  return resolveEmailEnvFrom(emailEnvContract, env, key) as EmailEnvValueOf<K>;
}
