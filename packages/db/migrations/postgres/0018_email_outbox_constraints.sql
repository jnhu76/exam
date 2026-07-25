-- P5-0: state machine CHECK constraints, heartbeat unique index, recovery index.
--
-- Adds database-level backstops for the email outbox state model:
--   1. Status value constraint (only valid enum values)
--   2. processing requires locked_at + locked_by
--   3. retry_wait requires next_attempt_at
--   4. sent requires sent_at
--   5. dead requires last_error
--   6. non-processing rows must not have locks
--   7. Recovery index (org + status + locked_at) for abandoned-row scan
--   8. Dedupe partial unique index on (org, dedupe_key)
--   9. Heartbeat unique constraint on worker_instance_id

-- 1. Status value constraint
ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_status_check"
  CHECK ("status" IN ('pending','processing','retry_wait','sent','dead'));
--> statement-breakpoint

-- 2. processing requires locked_at + locked_by
ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_processing_must_have_lock"
  CHECK (
    ("status" <> 'processing')
    OR ("locked_at" IS NOT NULL AND "locked_by" IS NOT NULL)
  );
--> statement-breakpoint

-- 3. retry_wait requires next_attempt_at
ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_retry_wait_must_have_next"
  CHECK (
    ("status" <> 'retry_wait')
    OR ("next_attempt_at" IS NOT NULL)
  );
--> statement-breakpoint

-- 4. sent requires sent_at
ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_sent_must_have_sent_at"
  CHECK (
    ("status" <> 'sent')
    OR ("sent_at" IS NOT NULL)
  );
--> statement-breakpoint

-- 5. dead requires last_error
ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_dead_must_have_error"
  CHECK (
    ("status" <> 'dead')
    OR ("last_error" IS NOT NULL)
  );
--> statement-breakpoint

-- 6. non-processing rows must not have locks
ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_non_processing_no_lock"
  CHECK (
    ("status" = 'processing')
    OR ("locked_at" IS NULL AND "locked_by" IS NULL)
  );
--> statement-breakpoint

-- 7. Recovery index for abandoned-row scan
CREATE INDEX "email_outbox_org_status_locked_at_idx"
  ON "email_outbox" ("organization_id", "status", "locked_at");
--> statement-breakpoint

-- 8. Heartbeat unique constraint on worker_instance_id (for atomic upsert)
ALTER TABLE "worker_heartbeats"
  ADD CONSTRAINT "worker_heartbeats_instance_uk"
  UNIQUE ("worker_instance_id");
--> statement-breakpoint

-- 9. Diagnostics index for latest heartbeat lookup
CREATE INDEX "worker_heartbeats_last_poll_at_idx"
  ON "worker_heartbeats" ("worker_name", "last_poll_at");
--> statement-breakpoint

-- 10. Dedupe partial unique index: only one non-null dedupe key per org
--     across the full outbox lifecycle. NULL keys are unrestricted.
CREATE UNIQUE INDEX "email_outbox_org_dedupe_key_unique"
  ON "email_outbox" ("organization_id", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;
