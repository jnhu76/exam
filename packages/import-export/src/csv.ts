export function escapeCSVValue(value: unknown): string {
  const str = String(value ?? "");
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCSV(
  headers: string[],
  rows: (unknown[] | Record<string, unknown>)[],
): string {
  const lines: string[] = [];

  // Add headers
  lines.push(headers.map(escapeCSVValue).join(","));

  // Add rows
  for (const row of rows) {
    const values = Array.isArray(row) ? row : headers.map((h) => row[h]);
    lines.push(values.map(escapeCSVValue).join(","));
  }

  return lines.join("\n");
}
