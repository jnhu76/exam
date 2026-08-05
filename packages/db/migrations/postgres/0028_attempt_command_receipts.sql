-- 0028_attempt_command_receipts.sql
--
-- J5-I1C Slice 1 — durable attempt command receipt foundation.
--
-- Adds ONE shared append-only receipt table, `attempt_command_receipts`,
-- arbitrated by `UNIQUE (organization_id, operation_id)`. This is the single
-- cross-command idempotency arbiter for the two dangerous Attempt commands
-- (`force_submit`, `misconduct_mark`). It mirrors the unified
-- `exam_incident_events` precedent (one table, one UNIQUE(org, operation_id),
-- multiple commandType values) and the per-receipt shape of
-- `exam_proctor_assignment_events` (canonical payload + outcome + actor).
--
-- J5-I1C0 audit §6.2 / §4.5. operationId scope is PER ORGANIZATION (not per
-- attempt, not per command): the same operationId reused across command types
-- OR across attempts within one organization MUST conflict at this single
-- constraint. That enforcement is the reason this is one table, not two.
--
-- `request_payload` stores the canonical input (replay/conflict comparison
-- input); `result_payload` stores the immutable committed fact (returned
-- verbatim on replay — never re-derived from the live attempt).
--
-- The persistent `outcome` column is restricted to ('applied', 'no_change').
-- The HTTP layer may surface a third wire disposition `idempotent_replay`, but
-- that value is NEVER written to this table and NEVER mutates an existing
-- receipt (audit §3.3).
--
-- This migration is purely additive: no changes to `exam_attempts` (the jsonb
-- `misconduct` column stays as a derived projection) and no changes to
-- `audit_logs`. Rollback before any write is a guarded DROP — see
-- apps/api/src/scripts/rollback-attempt-command-receipts.ts (audit §8 Slice 1).
--> statement-breakpoint

CREATE TABLE "attempt_command_receipts" (
  "id" uuid PRIMARY KEY,
  "organization_id" text NOT NULL,
  "attempt_id" text NOT NULL,
  "operation_id" uuid NOT NULL,
  "command_type" text NOT NULL,
  "request_payload" jsonb NOT NULL,
  "result_payload" jsonb NOT NULL,
  "outcome" text NOT NULL,
  "actor_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attempt_command_receipts_command_type_check" CHECK ("attempt_command_receipts"."command_type" IN ('force_submit', 'misconduct_mark')),
  CONSTRAINT "attempt_command_receipts_outcome_check" CHECK ("attempt_command_receipts"."outcome" IN ('applied', 'no_change')),
  CONSTRAINT "attempt_command_receipts_request_payload_check" CHECK (jsonb_typeof("attempt_command_receipts"."request_payload") = 'object'),
  CONSTRAINT "attempt_command_receipts_result_payload_check" CHECK (jsonb_typeof("attempt_command_receipts"."result_payload") = 'object')
);
--> statement-breakpoint

-- Idempotency arbiter (ADR-014 §9 / ADR-015 §4.2): the ONE cross-command
-- unique constraint. A force_submit and a misconduct_mark carrying the same
-- operationId within one organization cannot both insert.
CREATE UNIQUE INDEX "attempt_command_receipts_org_operation_unique"
  ON "attempt_command_receipts" ("organization_id", "operation_id");
--> statement-breakpoint

-- Per-attempt history with optional command_type filter and a deterministic
-- (created_at, id) tie-breaker so listByAttempt ordering is index-supported
-- even when many receipts share the same timestamp.
CREATE INDEX "attempt_command_receipts_org_attempt_command_created_idx"
  ON "attempt_command_receipts" ("organization_id", "attempt_id", "command_type", "created_at", "id");
--> statement-breakpoint

-- Composite FK to exam_attempts (reuses the existing exam_attempts_org_id_unique
-- unique index as the referenced key, same pattern as 0023/0024).
ALTER TABLE "attempt_command_receipts" ADD CONSTRAINT "attempt_command_receipts_org_attempt_fk"
  FOREIGN KEY ("organization_id", "attempt_id") REFERENCES "exam_attempts"("organization_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Organization membership FK (plain, no cascade — mirrors 0024).
ALTER TABLE "attempt_command_receipts" ADD CONSTRAINT "attempt_command_receipts_org_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Actor FK: plain users(id), no cascade (mirrors exam_proctor_assignment_events_actor_fk).
-- The cross-org model stays correct because actor_id is resolved within the
-- request ctx of the same organization; this FK only proves the user exists,
-- not org membership (which the ctx + users table enforces upstream).
ALTER TABLE "attempt_command_receipts" ADD CONSTRAINT "attempt_command_receipts_actor_fk"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
