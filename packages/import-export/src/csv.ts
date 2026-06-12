const DANGEROUS_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function escapeCSVValue(value: unknown): string {
  const str = String(value ?? "");
  let body = str;
  if (body.length > 0 && DANGEROUS_PREFIXES.has(body[0]!)) {
    body = `'${body}`;
  }
  if (
    body.includes(",") ||
    body.includes('"') ||
    body.includes("\n") ||
    body.includes("\r")
  ) {
    return `"${body.replace(/"/g, '""')}"`;
  }
  return body;
}

export function generateCSV(
  headers: string[],
  rows: (unknown[] | Record<string, unknown>)[],
): string {
  const lines: string[] = [];

  lines.push(headers.map(escapeCSVValue).join(","));

  for (const row of rows) {
    const values = Array.isArray(row) ? row : headers.map((h) => row[h]);
    lines.push(values.map(escapeCSVValue).join(","));
  }

  return lines.join("\n");
}
