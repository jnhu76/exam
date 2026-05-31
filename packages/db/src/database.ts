import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError } from "@exam/domain";
import {
  createSqliteDatabase,
  type SqliteDatabaseConnection,
} from "./sqlite.js";

export type DatabaseConnection = { kind: "sqlite" } & SqliteDatabaseConnection;

export function normalizeSqliteFilename(databaseUrl: string): string {
  return databaseUrl.startsWith("sqlite:")
    ? databaseUrl.slice("sqlite:".length)
    : databaseUrl;
}

export function resolveSqliteFilename(databaseUrl: string): string {
  const filename = normalizeSqliteFilename(databaseUrl);
  if (filename === ":memory:" || isAbsolute(filename)) {
    return filename;
  }

  return resolve(
    fileURLToPath(new URL("../../../", import.meta.url)),
    filename,
  );
}

export function createDatabase(
  databaseUrl = process.env.DATABASE_URL ?? "sqlite:./dev.db",
): DatabaseConnection {
  if (
    databaseUrl.startsWith("sqlite:") ||
    databaseUrl === ":memory:" ||
    databaseUrl.endsWith(".db")
  ) {
    return {
      kind: "sqlite",
      ...createSqliteDatabase(resolveSqliteFilename(databaseUrl)),
    };
  }

  throw new ValidationError(
    "Only SQLite DATABASE_URL values are supported during Phase 1 bootstrap",
  );
}
