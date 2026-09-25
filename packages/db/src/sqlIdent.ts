/**
 * Quote a PostgreSQL identifier safely (double-quote with escaped double-quotes).
 *
 * Single source for SQL identifier interpolation shared by the production
 * migration path and test-support DDL — never interpolate an identifier into
 * `sql.unsafe` without passing it through here.
 */
export function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
