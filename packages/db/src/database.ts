import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError } from "@exam/domain";
import {
  createSqliteDatabase,
  type SqliteDatabaseConnection,
} from "./sqlite.js";
import {
  createPostgresDatabase,
  isPostgresqlUrl,
  type PostgresDatabaseConnection,
} from "./postgres.js";

export type DatabaseConnection =
  | ({ kind: "sqlite" } & SqliteDatabaseConnection)
  | ({ kind: "pg" } & PostgresDatabaseConnection);

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
  if (isPostgresqlUrl(databaseUrl)) {
    return createPostgresDatabase(databaseUrl);
  }

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

  throw new ValidationError(`Unsupported DATABASE_URL format: ${databaseUrl}`);
}
