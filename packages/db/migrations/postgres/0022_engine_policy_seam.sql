-- REC-I4-I2: Engine Policy Seam — migration 0022
-- Phased fail-closed validation, backfill, and CHECK installation (R11).
--
-- P1: Validate corrupt states — RAISE if any found.
-- P2: Create missing disrupted episodes for I1 transitional attempts.
-- P3: Resolve stale pointers on non-disrupted attempts.
-- P4: Install status/pointer CHECK constraint.

--> statement-breakpoint

-- ============================================================
-- P1: VALIDATION — fail closed on corrupt states
-- ============================================================

-- P1a: not_started|queued + pointer → RAISE (should never exist)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "exam_attempts"
    WHERE "status" IN ('not_started', 'queued')
      AND "current_interruption_id" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'P1a: not_started/queued attempts with interruption pointer found'
      USING HINT = 'Run manual cleanup before applying migration 0022';
  END IF;
END $$;

--> statement-breakpoint

-- P1b: disrupted + existing outcome → RAISE (duplicate terminalization)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "exam_attempts" a
    WHERE a."status" = 'disrupted'
      AND a."current_interruption_id" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "attempt_interruption_events" e
        WHERE e."interruption_id" = a."current_interruption_id"
          AND e."event_type" IN ('restored', 'terminalized')
      )
  ) THEN
    RAISE EXCEPTION 'P1b: disrupted attempts with existing outcome event found'
      USING HINT = 'Run manual cleanup before applying migration 0022';
  END IF;
END $$;

--> statement-breakpoint

-- P1c: interruptedAt mismatch with detected event occurredAt
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "exam_attempts" a
    JOIN "attempt_interruption_events" e
      ON e."interruption_id" = a."current_interruption_id"
      AND e."event_type" = 'detected'
    WHERE a."current_interruption_id" IS NOT NULL
      AND a."interrupted_at" IS DISTINCT FROM e."occurred_at"
  ) THEN
    RAISE EXCEPTION 'P1c: interrupted_at mismatch with detected event occurred_at found'
      USING HINT = 'Run manual cleanup before applying migration 0022';
  END IF;
END $$;

--> statement-breakpoint

-- P1d: >1 detected event per attempt → RAISE
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "attempt_interruption_events"
    WHERE "event_type" = 'detected'
    GROUP BY "attempt_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'P1d: multiple detected events per attempt found'
      USING HINT = 'Run manual cleanup before applying migration 0022';
  END IF;
END $$;

--> statement-breakpoint

-- P1e: missing detected event for pointer → RAISE
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "exam_attempts" a
    WHERE a."current_interruption_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "attempt_interruption_events" e
        WHERE e."interruption_id" = a."current_interruption_id"
          AND e."event_type" = 'detected'
      )
  ) THEN
    RAISE EXCEPTION 'P1e: interruption pointer without detected event found'
      USING HINT = 'Run manual cleanup before applying migration 0022';
  END IF;
END $$;

--> statement-breakpoint

-- ============================================================
-- P2: CREATE MISSING DISRUPTED EPISODES
-- Creates episodes for disrupted attempts that lack one (I1
-- transitional state where disrupted + null pointer was allowed).
-- ============================================================

CREATE TEMPORARY TABLE "rec_i4_i2_missing_disrupted" (
  "attempt_id" text PRIMARY KEY,
  "interruption_id" uuid NOT NULL,
  "detected_at" timestamp with time zone NOT NULL
) ON COMMIT DROP;

--> statement-breakpoint

INSERT INTO "rec_i4_i2_missing_disrupted"
  ("attempt_id", "interruption_id", "detected_at")
SELECT
  a."id",
  gen_random_uuid(),
  COALESCE(a."interrupted_at", transaction_timestamp())
FROM "exam_attempts" a
WHERE a."status" = 'disrupted'
  AND a."current_interruption_id" IS NULL;

--> statement-breakpoint

INSERT INTO "attempt_interruptions"
  ("id", "organization_id", "attempt_id", "created_at")
SELECT
  m."interruption_id",
  a."organization_id",
  a."id",
  m."detected_at"
FROM "rec_i4_i2_missing_disrupted" m
JOIN "exam_attempts" a ON a."id" = m."attempt_id";

--> statement-breakpoint

INSERT INTO "attempt_interruption_events" (
  "id", "organization_id", "attempt_id", "interruption_id",
  "event_type", "occurred_at", "observed_last_activity_at",
  "detection_source", "timeout_seconds", "policy",
  "eligible_seconds", "time_adjustment_id", "actor_id",
  "reason_code", "created_at"
)
SELECT
  gen_random_uuid()::text,
  a."organization_id",
  a."id",
  m."interruption_id",
  'detected',
  m."detected_at",
  a."last_activity_at",
  'migration_backfill',
  NULL,
  COALESCE(a."interruption_time_policy_snapshot", 'strict'),
  NULL,
  NULL,
  NULL,
  'migration_backfill_unknown_detected_at',
  m."detected_at"
FROM "rec_i4_i2_missing_disrupted" m
JOIN "exam_attempts" a ON a."id" = m."attempt_id";

--> statement-breakpoint

UPDATE "exam_attempts" a
SET
  "current_interruption_id" = m."interruption_id",
  "interrupted_at" = m."detected_at"
FROM "rec_i4_i2_missing_disrupted" m
WHERE a."id" = m."attempt_id";

--> statement-breakpoint

-- ============================================================
-- P3: RESOLVE STALE POINTERS
-- Clears interruption pointers on non-disrupted attempts that
-- still carry them (I1 transitional state).
-- ============================================================

UPDATE "exam_attempts"
SET
  "current_interruption_id" = NULL,
  "interrupted_at" = NULL
WHERE "status" != 'disrupted'
  AND "current_interruption_id" IS NOT NULL;

--> statement-breakpoint

-- ============================================================
-- P4: INSTALL STATUS/POINTER CHECK
-- Ensures that disrupted attempts always carry a pointer, and
-- non-disrupted attempts never do.
-- ============================================================

ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_status_pointer_check" CHECK (
        ("exam_attempts"."status" = 'disrupted' AND "exam_attempts"."current_interruption_id" IS NOT NULL AND "exam_attempts"."interrupted_at" IS NOT NULL)
        OR
        ("exam_attempts"."status" != 'disrupted' AND "exam_attempts"."current_interruption_id" IS NULL AND "exam_attempts"."interrupted_at" IS NULL)
      );