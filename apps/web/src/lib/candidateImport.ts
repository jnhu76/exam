/** Configuration for a custom candidate field used during CSV import. */
export interface CandidateFieldConfig {
  name: string;
  label: string;
  fieldType: "text" | "number" | "select";
  required: boolean;
  unique: boolean;
}

/** A single parsed CSV row with core identity fields and custom field values. */
export interface ParsedImportRow {
  username: string;
  password: string;
  name: string;
  fields: Record<string, string | number>;
}

/** An existing candidate record used for duplicate detection during import. */
export interface ExistingCandidate {
  username: string;
  fields: Record<string, unknown>;
}

/**
 * CSV header compatibility aliases for the core identity columns.
 *
 * These Chinese header names are NOT user-interface copy — they are legacy
 * CSV column aliases accepted alongside the canonical English headers
 * (`username` / `password` / `name`) so existing candidate import templates
 * keep parsing. They must stay in sync with the import template generator.
 * Excluded from the hardcoded-copy lint via the CSV-compatibility allowlist.
 */
export const CSV_HEADER_ALIASES = {
  // i18n-copy-allow: data-format — CSV header alias data contract
  username: ["username", "用户名"],
  // i18n-copy-allow: data-format — CSV header alias data contract
  password: ["password", "密码"],
  // i18n-copy-allow: data-format — CSV header alias data contract
  name: ["name", "姓名"],
} as const;

/** Parses a single CSV line into an array of field values, handling quoted fields. */
export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

/**
 * Maps raw CSV header names to internal field names,
 * resolving both English and legacy Chinese column headers
 * (see {@link CSV_HEADER_ALIASES}).
 */
export function resolveHeaders(
  rawHeaders: string[],
  fieldConfigs: CandidateFieldConfig[],
): Record<string, string> {
  const labelToName = new Map(fieldConfigs.map((f) => [f.label, f.name]));
  const aliasToInternal: Record<string, string> = {
    [CSV_HEADER_ALIASES.username[0]]: "username",
    [CSV_HEADER_ALIASES.username[1]]: "username",
    [CSV_HEADER_ALIASES.password[0]]: "password",
    [CSV_HEADER_ALIASES.password[1]]: "password",
    [CSV_HEADER_ALIASES.name[0]]: "name",
    [CSV_HEADER_ALIASES.name[1]]: "name",
  };
  const headerMap: Record<string, string> = {};
  for (const raw of rawHeaders) {
    if (raw in aliasToInternal) {
      headerMap[raw] = aliasToInternal[raw]!;
    } else if (labelToName.has(raw)) {
      headerMap[raw] = labelToName.get(raw)!;
    } else {
      headerMap[raw] = raw;
    }
  }
  return headerMap;
}

/** Maximum number of data rows allowed in a single CSV import. */
export const MAX_IMPORT_ROWS = 500;

/** Result of parsing a CSV file for candidate import. */
export interface ParseImportCsvResult {
  rows: ParsedImportRow[];
  truncated: boolean;
  totalLines: number;
}

/**
 * Parses a full CSV string into import rows, applying header mapping
 * and field type coercion. Truncates at MAX_IMPORT_ROWS.
 */
export function parseImportCsv(
  csv: string,
  fieldConfigs: CandidateFieldConfig[],
): ParseImportCsvResult {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { rows: [], truncated: false, totalLines: 0 };
  const rawHeaders = parseCsvLine(lines[0]!).map((item) =>
    item.replace(/^\uFEFF/, ""),
  );
  const headerMap = resolveHeaders(rawHeaders, fieldConfigs);
  const totalDataLines = lines.length - 1;
  const truncated = totalDataLines > MAX_IMPORT_ROWS;
  const dataLines = lines.slice(1, MAX_IMPORT_ROWS + 1);
  const rows = dataLines.map((line) => {
    const columns = parseCsvLine(line);
    const row = Object.fromEntries(
      rawHeaders.map((raw, index) => [headerMap[raw], columns[index] ?? ""]),
    );
    return {
      username: (row.username as string) ?? "",
      password: (row.password as string) ?? "",
      name: (row.name as string) ?? "",
      fields: Object.fromEntries(
        fieldConfigs.map((field) => [
          field.name,
          field.fieldType === "number" && row[field.name] !== ""
            ? Number(row[field.name])
            : (row[field.name] ?? ""),
        ]),
      ),
    };
  });
  return { rows, truncated, totalLines: totalDataLines };
}

/**
 * Detects whether a parsed import row duplicates an existing candidate
 * by checking the unique identity field or username.
 */
// TODO: follow-up — iterate all unique fields if CandidateField constraint is relaxed to allow multiple
export function detectDuplicate(
  row: ParsedImportRow,
  fieldConfigs: CandidateFieldConfig[],
  existingCandidates: ExistingCandidate[],
): boolean {
  const identityField = fieldConfigs.find((f) => f.unique);
  const matchByIdentity =
    identityField &&
    existingCandidates.some(
      (c) => c.fields[identityField.name] === row.fields[identityField.name],
    );
  if (matchByIdentity) return true;
  return existingCandidates.some((c) => c.username === row.username);
}
