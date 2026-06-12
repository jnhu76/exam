import type { Database } from "../types.js";
import { auditLogs } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

export function createAuditLogRepo(db: Database) {
  return createAsyncTenantCrudRepo(db, auditLogs);
}
