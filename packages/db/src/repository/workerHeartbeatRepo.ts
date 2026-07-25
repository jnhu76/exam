import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { workerHeartbeats } from "../schema/pg.js";
import type { Database } from "../types.js";
import { now } from "./baseRepo.js";

/** Input for upserting a worker heartbeat record. */
export interface UpsertHeartbeatInput {
  workerName: string;
  workerInstanceId: string;
  lastPollAt: Date;
  lastSuccessAt?: Date | null;
  lastErrorAt?: Date | null;
  lastError?: string | null;
}

/** A worker heartbeat row as returned by the repo. */
export interface WorkerHeartbeatRow {
  id: string;
  workerName: string;
  workerInstanceId: string;
  lastPollAt: Date;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Creates a repository for the `worker_heartbeats` table (P5-0).
 *
 * Worker heartbeats are PostgreSQL-backed liveness records that allow the
 * diagnostics surface to determine worker liveness without process-local
 * shared state, HTTP RPC, or Redis.
 *
 * @param db - Drizzle database connection.
 */
export function createWorkerHeartbeatRepo(db: Database) {
  /**
   * Upserts a heartbeat record for the given worker name + instance ID.
   * If a record exists for the same (workerName, workerInstanceId) pair,
   * it is updated; otherwise a new record is created.
   */
  async function upsert(
    input: UpsertHeartbeatInput,
  ): Promise<WorkerHeartbeatRow> {
    const timestamp = now();

    // Try to find an existing record for this worker name + instance
    const existing = await db
      .select()
      .from(workerHeartbeats)
      .where(eq(workerHeartbeats.workerInstanceId, input.workerInstanceId))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(workerHeartbeats)
        .set({
          lastPollAt: input.lastPollAt,
          lastSuccessAt: input.lastSuccessAt ?? null,
          lastErrorAt: input.lastErrorAt ?? null,
          lastError: input.lastError ?? null,
          updatedAt: timestamp,
        })
        .where(eq(workerHeartbeats.workerInstanceId, input.workerInstanceId))
        .returning();
      return updated as WorkerHeartbeatRow;
    }

    const [created] = await db
      .insert(workerHeartbeats)
      .values({
        id: randomUUID(),
        workerName: input.workerName,
        workerInstanceId: input.workerInstanceId,
        lastPollAt: input.lastPollAt,
        lastSuccessAt: input.lastSuccessAt ?? null,
        lastErrorAt: input.lastErrorAt ?? null,
        lastError: input.lastError ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    return created as WorkerHeartbeatRow;
  }

  /**
   * Finds the latest heartbeat record for a given worker name, ordered by
   * lastPollAt descending. Returns null if no records exist.
   */
  async function findLatestByName(
    workerName: string,
  ): Promise<WorkerHeartbeatRow | null> {
    const rows = await db
      .select()
      .from(workerHeartbeats)
      .where(eq(workerHeartbeats.workerName, workerName))
      .orderBy(workerHeartbeats.lastPollAt)
      .limit(1);
    return (rows[0] as WorkerHeartbeatRow | undefined) ?? null;
  }

  return {
    upsert,
    findLatestByName,
  };
}

export type WorkerHeartbeatRepo = ReturnType<typeof createWorkerHeartbeatRepo>;
