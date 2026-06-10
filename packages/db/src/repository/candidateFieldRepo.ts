import type { AnyDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import { candidateFields as sqliteCandidateFields } from "../schema/sqlite.js";
import { candidateFields as pgCandidateFields } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

export function createCandidateFieldRepo(db: AnyDatabase) {
  return createAsyncTenantCrudRepo(db, {
    sqlite: sqliteCandidateFields,
    pg: pgCandidateFields,
  });
}
