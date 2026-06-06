export interface CandidateFieldConfig {
  name: string;
  label: string;
  fieldType: "text" | "number" | "select";
  required: boolean;
  unique: boolean;
}

export interface ParsedImportRow {
  username: string;
  password: string;
  name: string;
  fields: Record<string, string | number>;
}

export interface ExistingCandidate {
  username: string;
  fields: Record<string, unknown>;
}

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

export function resolveHeaders(
  rawHeaders: string[],
  fieldConfigs: CandidateFieldConfig[],
): Record<string, string> {
  const labelToName = new Map(fieldConfigs.map((f) => [f.label, f.name]));
  const headerMap: Record<string, string> = {};
  for (const raw of rawHeaders) {
    if (raw === "username" || raw === "用户名") {
      headerMap[raw] = "username";
    } else if (raw === "password" || raw === "密码") {
      headerMap[raw] = "password";
    } else if (raw === "name" || raw === "姓名") {
      headerMap[raw] = "name";
    } else if (labelToName.has(raw)) {
      headerMap[raw] = labelToName.get(raw)!;
    } else {
      headerMap[raw] = raw;
    }
  }
  return headerMap;
}

export const MAX_IMPORT_ROWS = 500;

export interface ParseImportCsvResult {
  rows: ParsedImportRow[];
  truncated: boolean;
  totalLines: number;
}

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
