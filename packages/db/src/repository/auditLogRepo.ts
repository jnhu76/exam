import type { AnyDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import { auditLogs as sqliteAuditLogs } from "../schema/sqlite.js";
import { auditLogs as pgAuditLogs } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

export function createAuditLogRepo(db: AnyDatabase) {
  return createAsyncTenantCrudRepo(db, {
    sqlite: sqliteAuditLogs,
    pg: pgAuditLogs,
  });
}
