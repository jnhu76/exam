import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { sqliteSchema } from "./schema/sqlite.js";
import type { pgSchema } from "./schema/pg.js";

export type SqliteDatabase = BetterSQLite3Database<typeof sqliteSchema>;
export type PostgresDatabase = PostgresJsDatabase<typeof pgSchema>;
export type AnyDatabase = SqliteDatabase | PostgresDatabase;
