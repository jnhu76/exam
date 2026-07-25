-- P5-0: extend email_outbox for delivery runtime, add worker_heartbeats.
--
-- Changes:
--   1. Rename email_outbox.attempts -> attempt_count
--   2. Rename email_outbox.next_retry_at -> next_attempt_at
--   3. Add locked_at, locked_by, provider_message_id, dedupe_key columns
--   4. Drop and recreate check constraints for renamed columns
--   5. Drop and recreate index for renamed column
--   6. Map legacy statuses to new state model
--   7. Create worker_heartbeats table

-- Drop old check constraints (they reference the old column names)
ALTER TABLE "email_outbox" DROP CONSTRAINT IF EXISTS "email_outbox_attempts_check";
--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT IF EXISTS "email_outbox_max_attempts_check";
--> statement-breakpoint

-- Drop old index (references next_retry_at)
DROP INDEX IF EXISTS "email_outbox_org_status_retry_idx";
--> statement-breakpoint

-- Rename columns
ALTER TABLE "email_outbox" RENAME COLUMN "attempts" TO "attempt_count";
--> statement-breakpoint
ALTER TABLE "email_outbox" RENAME COLUMN "next_retry_at" TO "next_attempt_at";
--> statement-breakpoint

-- Add new columns for delivery runtime
ALTER TABLE "email_outbox" ADD COLUMN "locked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "locked_by" text;
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "provider_message_id" text;
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "dedupe_key" text;
--> statement-breakpoint

-- Recreate indexes with renamed columns
CREATE INDEX "email_outbox_org_status_retry_idx" ON "email_outbox" ("organization_id", "status", "next_attempt_at");
--> statement-breakpoint

-- Recreate check constraints with renamed columns
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_attempt_count_check" CHECK ("attempt_count" >= 0);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_max_attempts_check" CHECK ("max_attempts" >= 1);
--> statement-breakpoint

-- 6. Map legacy statuses to new state model.
--    The old schema used 'failed' and stored retry-pending rows as
--    'pending' with a future next_retry_at. The new state model uses
--    'dead' (terminal) and 'retry_wait' (non-terminal, scheduled retry).
--    Without this mapping, old 'failed' rows would be invisible to the
--    worker/diagnostics, and old deferred-retry rows would be claimed
--    immediately on the first poll (bypassing their backoff).
UPDATE "email_outbox"
SET "status" = 'dead'
WHERE "status" = 'failed';
--> statement-breakpoint
UPDATE "email_outbox"
SET "status" = 'retry_wait'
WHERE "status" = 'pending'
  AND "next_attempt_at" IS NOT NULL
  AND "next_attempt_at" > now();
--> statement-breakpoint

-- Create worker_heartbeats table
CREATE TABLE "worker_heartbeats" (
  "id" text PRIMARY KEY NOT NULL,
  "worker_name" text NOT NULL,
  "worker_instance_id" text NOT NULL,
  "last_poll_at" timestamp with time zone NOT NULL,
  "last_success_at" timestamp with time zone,
  "last_error_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "worker_heartbeats_name_instance_idx" ON "worker_heartbeats" ("worker_name", "worker_instance_id");