/**
 * Record-field toolkit — the machine-schema backbone (R1 handoff §9).
 *
 * Every Atlas record (node header + type-specific fields, Fact, Evidence,
 * Claim, Conflict) is declared as a field table. The table is the single
 * place that knows:
 *
 * - which fields are required;
 * - which closed set / grammar each field admits (values outside are
 *   rejected);
 * - the default of every optional field (ATLAS-IR-069: "omitted" and
 *   "explicitly default" normalize to the same bytes; a field optional but
 *   absent from the default table is a schema defect, so the toolkit
 *   refuses to build one);
 * - that `UNKNOWN` and `NONE` are distinct sentinels, never interchanged
 *   (ATLAS-IR-068), and `null` is never used in v0.1.
 */

import {
  InvalidAtlasIdError,
  assertIdIsNotASourcePath,
  idNamespace,
  isValidAtlasId,
} from "./ids.js";

/** Marker: an optional field whose default is to stay absent from the
 * canonical form (R0: "field absent → not applicable / not present in this
 * schema version"). */
export const FIELD_ABSENT = Symbol("FIELD_ABSENT");

export type Absent = typeof FIELD_ABSENT;

export type ValidationErrors = string[];

export interface FieldSpec<T> {
  readonly optional: boolean;
  /** Default for optional fields; FIELD_ABSENT keeps the key out. */
  readonly defaultValue: T | Absent;
  validate(value: unknown, path: string): ValidationErrors;
}

export class SchemaValidationError extends Error {
  constructor(readonly errors: ValidationErrors) {
    super(
      `Atlas schema validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
    this.name = "SchemaValidationError";
  }
}

function typeLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

abstract class BaseField<T> implements FieldSpec<T> {
  abstract readonly optional: boolean;
  abstract readonly defaultValue: T | Absent;
  abstract validate(value: unknown, path: string): ValidationErrors;
}

class StringField extends BaseField<string> {
  constructor(
    readonly optional: boolean,
    readonly defaultValue: string | Absent,
  ) {
    super();
  }
  validate(value: unknown, path: string): ValidationErrors {
    return typeof value === "string"
      ? []
      : [`${path}: expected string, got ${typeLabel(value)}`];
  }
}

class IntField extends BaseField<number> {
  constructor(
    readonly optional: boolean,
    readonly defaultValue: number | Absent,
  ) {
    super();
  }
  validate(value: unknown, path: string): ValidationErrors {
    return Number.isInteger(value)
      ? []
      : [
          `${path}: expected integer, got ${typeLabel(value)} (no floating-point fields, ATLAS-IR-070)`,
        ];
  }
}

class EnumField<E extends readonly string[]> extends BaseField<E[number]> {
  constructor(
    readonly optional: boolean,
    readonly defaultValue: E[number] | Absent,
    private readonly values: E,
    private readonly label: string,
  ) {
    super();
  }
  validate(value: unknown, path: string): ValidationErrors {
    if (typeof value !== "string") {
      return [`${path}: expected ${this.label} value, got ${typeLabel(value)}`];
    }
    return this.values.includes(value as E[number])
      ? []
      : [`${path}: "${value}" is outside the closed set ${this.label}`];
  }
}

class RefField extends BaseField<string> {
  constructor(
    readonly optional: boolean,
    readonly defaultValue: string | Absent,
    private readonly namespaces: readonly string[],
  ) {
    super();
  }
  validate(value: unknown, path: string): ValidationErrors {
    if (typeof value !== "string") {
      return [`${path}: expected logical ID, got ${typeLabel(value)}`];
    }
    if (!isValidAtlasId(value)) {
      return [`${path}: "${value}" violates its ID grammar`];
    }
    let ns: string;
    try {
      ns = idNamespace(value);
    } catch (error) {
      return [`${path}: ${(error as InvalidAtlasIdError).message}`];
    }
    if (!this.namespaces.includes(ns)) {
      return [
        `${path}: "${value}" namespace "${ns}" not in [${this.namespaces.join(", ")}]`,
      ];
    }
    try {
      assertIdIsNotASourcePath(value);
    } catch (error) {
      return [`${path}: ${(error as InvalidAtlasIdError).message}`];
    }
    return [];
  }
}

class RefArrayField extends BaseField<string[]> {
  private readonly item: RefField;
  constructor(
    readonly optional: boolean,
    readonly defaultValue: string[] | Absent,
    namespaces: readonly string[],
  ) {
    super();
    this.item = new RefField(false, FIELD_ABSENT, namespaces);
  }
  validate(value: unknown, path: string): ValidationErrors {
    if (!Array.isArray(value)) {
      return [
        `${path}: expected array of logical IDs, got ${typeLabel(value)}`,
      ];
    }
    const errors: ValidationErrors = [];
    value.forEach((item, i) => {
      errors.push(...this.item.validate(item, `${path}[${i}]`));
    });
    return errors;
  }
}

class ArrayField<T> extends BaseField<T[]> {
  constructor(
    readonly optional: boolean,
    readonly defaultValue: T[] | Absent,
    private readonly item: FieldSpec<T>,
  ) {
    super();
  }
  validate(value: unknown, path: string): ValidationErrors {
    if (!Array.isArray(value)) {
      return [`${path}: expected array, got ${typeLabel(value)}`];
    }
    const errors: ValidationErrors = [];
    value.forEach((entry, i) => {
      errors.push(...this.item.validate(entry, `${path}[${i}]`));
    });
    return errors;
  }
}

class LiteralField<T extends string> extends BaseField<T> {
  constructor(
    readonly optional: boolean,
    readonly defaultValue: T | Absent,
    private readonly literal: T,
  ) {
    super();
  }
  validate(value: unknown, path: string): ValidationErrors {
    return value === this.literal ? [] : [`${path}: must be "${this.literal}"`];
  }
}

/**
 * A composite field that admits either a payload object or one of the R0
 * sentinels ("NONE" = the concept does not apply; "UNKNOWN" = not
 * establishable). The sentinel set is explicit per field so the two can
 * never be interchanged (ATLAS-IR-068).
 */
class SentinelUnionField<P> extends BaseField<P | "NONE" | "UNKNOWN"> {
  constructor(
    readonly optional: boolean,
    readonly defaultValue: P | "NONE" | "UNKNOWN" | Absent,
    private readonly payload: RecordField<P>,
    private readonly sentinels: readonly ("NONE" | "UNKNOWN")[],
  ) {
    super();
  }
  validate(value: unknown, path: string): ValidationErrors {
    if (typeof value === "string") {
      return this.sentinels.includes(value as "NONE" | "UNKNOWN")
        ? []
        : [
            `${path}: "${value}" is not one of the allowed sentinels [${this.sentinels.join(", ")}]`,
          ];
    }
    return this.payload.validate(value, path);
  }
}

/** A nested record field declared inline. */
export class RecordField<S> extends BaseField<S> {
  constructor(
    readonly optional: boolean,
    readonly defaultValue: S | Absent,
    private readonly fields: RecordFields,
  ) {
    super();
  }
  validate(value: unknown, path: string): ValidationErrors {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return [`${path}: expected object, got ${typeLabel(value)}`];
    }
    return this.fields.validate(value as Record<string, unknown>, path);
  }
}

export type ObjectShape = Record<string, FieldSpec<unknown>>;

/**
 * The declared field table of one record type. Knows how to validate a raw
 * (possibly JSON-originated) record and how to materialize the canonical
 * form: every optional field gets its default applied, so "omitted" and
 * "explicitly default" normalize to identical bytes (ATLAS-IR-069).
 */
export class RecordFields {
  constructor(readonly shape: ObjectShape) {
    for (const [name, spec] of Object.entries(shape)) {
      if (spec.optional && spec.defaultValue === undefined) {
        throw new Error(
          `schema defect: optional field "${name}" has no default in the default table (ATLAS-IR-069)`,
        );
      }
    }
  }

  validate(raw: Record<string, unknown>, path: string): ValidationErrors {
    const errors: ValidationErrors = [];
    for (const [name, spec] of Object.entries(this.shape)) {
      const value = raw[name];
      if (value === undefined) {
        if (!spec.optional) {
          errors.push(`${path}.${name}: required field is absent`);
        }
        continue;
      }
      errors.push(...spec.validate(value, `${path}.${name}`));
    }
    const declared = new Set(Object.keys(this.shape));
    for (const name of Object.keys(raw)) {
      if (!declared.has(name)) {
        errors.push(
          `${path}.${name}: unknown field (no free-text escape hatch, ATLAS-IR-071)`,
        );
      }
    }
    return errors;
  }

  /** Canonical form: defaults materialized; optional-absent keys removed. */
  applyDefaults(raw: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(this.shape)) {
      const value = raw[name];
      if (value !== undefined) {
        out[name] = value;
        continue;
      }
      if (!spec.optional) {
        continue;
      }
      if (spec.defaultValue !== FIELD_ABSENT) {
        out[name] = structuredClone(spec.defaultValue);
      }
    }
    return out;
  }
}

// ——— field constructors (each call site is a row of the default table) ———

export function str(): FieldSpec<string> {
  return new StringField(false, FIELD_ABSENT);
}
export function optStr(defaultValue: string | Absent): FieldSpec<string> {
  return new StringField(true, defaultValue);
}
export function int(): FieldSpec<number> {
  return new IntField(false, FIELD_ABSENT);
}
export function optInt(defaultValue: number | Absent): FieldSpec<number> {
  return new IntField(true, defaultValue);
}
export function enumOf<E extends readonly string[]>(
  values: E,
  label: string,
): FieldSpec<E[number]> {
  return new EnumField<E>(false, FIELD_ABSENT, values, label);
}
export function optEnum<E extends readonly string[]>(
  values: E,
  label: string,
  defaultValue: E[number] | Absent,
): FieldSpec<E[number]> {
  return new EnumField<E>(true, defaultValue, values, label);
}
export function ref(namespaces: readonly string[]): FieldSpec<string> {
  return new RefField(false, FIELD_ABSENT, namespaces);
}
export function optRef(
  namespaces: readonly string[],
  defaultValue: string | Absent,
): FieldSpec<string> {
  return new RefField(true, defaultValue, namespaces);
}
export function refArray(namespaces: readonly string[]): FieldSpec<string[]> {
  return new RefArrayField(false, FIELD_ABSENT, namespaces);
}
export function optRefArray(
  namespaces: readonly string[],
  defaultValue: readonly string[] | Absent = [],
): FieldSpec<string[]> {
  return new RefArrayField(
    true,
    defaultValue === FIELD_ABSENT ? FIELD_ABSENT : [...defaultValue],
    namespaces,
  );
}
export function arrayOf<T>(item: FieldSpec<T>): FieldSpec<T[]> {
  return new ArrayField<T>(false, FIELD_ABSENT, item);
}
export function optArrayOf<T>(
  item: FieldSpec<T>,
  defaultValue: readonly T[] | Absent = [],
): FieldSpec<T[]> {
  return new ArrayField<T>(
    true,
    defaultValue === FIELD_ABSENT ? FIELD_ABSENT : [...defaultValue],
    item,
  );
}
export function literal<T extends string>(value: T): FieldSpec<T> {
  return new LiteralField<T>(false, FIELD_ABSENT, value);
}
export function optLiteral<T extends string>(
  value: T,
  defaultValue: T | Absent,
): FieldSpec<T> {
  return new LiteralField<T>(true, defaultValue, value);
}
/** Optional JSON boolean that may only ever be `true` (e.g. `historical`). */
export function optTrue(defaultValue: true | Absent): FieldSpec<true> {
  return new (class extends BaseField<true> {
    readonly optional = true;
    constructor() {
      super();
    }
    validate(value: unknown, path: string): ValidationErrors {
      return value === true ? [] : [`${path}: must be true`];
    }
    readonly defaultValue = defaultValue;
  })();
}

/** Declare a nested record shape (returns a plain spec table for nesting). */
export function shape(fields: ObjectShape): ObjectShape {
  return fields;
}

/** Required nested record. */
export function rec(fields: ObjectShape): FieldSpec<Record<string, unknown>> {
  return new RecordField<Record<string, unknown>>(
    false,
    FIELD_ABSENT,
    new RecordFields(fields),
  );
}
/** Optional nested record with a default payload (or FIELD_ABSENT). */
export function optRec(
  fields: ObjectShape,
  defaultValue: Record<string, unknown> | Absent,
): FieldSpec<Record<string, unknown>> {
  return new RecordField<Record<string, unknown>>(
    true,
    defaultValue,
    new RecordFields(fields),
  );
}
/** Required sentinel union (payload record or NONE/UNKNOWN). */
export function sentinel(
  fields: ObjectShape,
  allowed: readonly ("NONE" | "UNKNOWN")[],
): FieldSpec<Record<string, unknown> | "NONE" | "UNKNOWN"> {
  return new SentinelUnionField<Record<string, unknown>>(
    false,
    FIELD_ABSENT,
    new RecordField<Record<string, unknown>>(
      false,
      FIELD_ABSENT,
      new RecordFields(fields),
    ),
    allowed,
  );
}
/** Optional sentinel union. */
export function optSentinel(
  fields: ObjectShape,
  allowed: readonly ("NONE" | "UNKNOWN")[],
  defaultValue: Record<string, unknown> | "NONE" | "UNKNOWN" | Absent,
): FieldSpec<Record<string, unknown> | "NONE" | "UNKNOWN"> {
  return new SentinelUnionField<Record<string, unknown>>(
    true,
    defaultValue,
    new RecordField<Record<string, unknown>>(
      false,
      FIELD_ABSENT,
      new RecordFields(fields),
    ),
    allowed,
  );
}

/** Validate one raw record against a field table; throws on any error. */
export function validateRecord(
  fields: RecordFields,
  raw: Record<string, unknown>,
  path: string,
): void {
  const errors = fields.validate(raw, path);
  if (errors.length > 0) {
    throw new SchemaValidationError(errors);
  }
}
