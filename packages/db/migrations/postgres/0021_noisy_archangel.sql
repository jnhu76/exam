ALTER TABLE "exams"
  ADD COLUMN "interruption_time_policy" text DEFAULT 'strict' NOT NULL,
  ADD COLUMN "interruption_grace_per_incident_seconds" integer,
  ADD COLUMN "interruption_grace_per_attempt_seconds" integer;
--> statement-breakpoint
ALTER TABLE "exam_attempts"
  ADD COLUMN "interruption_policy_snapshot_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "interruption_time_policy_snapshot" text DEFAULT 'strict' NOT NULL,
  ADD COLUMN "interruption_grace_per_incident_seconds_snapshot" integer,
  ADD COLUMN "interruption_grace_per_attempt_seconds_snapshot" integer,
  ADD COLUMN "current_interruption_id" uuid,
  ADD COLUMN "interrupted_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX "exam_attempts_org_id_unique"
  ON "exam_attempts" ("organization_id", "id");
--> statement-breakpoint
CREATE TABLE "attempt_interruptions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "attempt_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_interruptions_org_attempt_id_unique"
  ON "attempt_interruptions" ("organization_id", "attempt_id", "id");
--> statement-breakpoint
ALTER TABLE "attempt_interruptions"
  ADD CONSTRAINT "attempt_interruptions_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "attempt_interruptions"
  ADD CONSTRAINT "attempt_interruptions_attempt_id_exam_attempts_id_fk"
  FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id");
--> statement-breakpoint
ALTER TABLE "attempt_interruptions"
  ADD CONSTRAINT "attempt_interruptions_org_attempt_fk"
  FOREIGN KEY ("organization_id", "attempt_id")
  REFERENCES "exam_attempts"("organization_id", "id");
--> statement-breakpoint
CREATE TABLE "attempt_time_adjustments" (
  "id" text PRIMARY KEY NOT NULL,
  "operation_id" uuid NOT NULL,
  "organization_id" text NOT NULL,
  "attempt_id" text NOT NULL,
  "interruption_id" uuid,
  "incident_id" uuid,
  "policy" text NOT NULL,
  "source" text NOT NULL,
  "before_deadline" timestamp with time zone NOT NULL,
  "after_deadline" timestamp with time zone NOT NULL,
  "added_seconds" integer NOT NULL,
  "eligible_seconds" integer,
  "reason_code" varchar(100) NOT NULL,
  "reason_text" text,
  "actor_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "attempt_time_adjustments_policy_check"
    CHECK ("policy" IN ('strict', 'bounded_grace', 'operator_incident')),
  CONSTRAINT "attempt_time_adjustments_source_check"
    CHECK ("source" IN ('bounded_grace', 'operator', 'system_incident', 'administrative_correction')),
  CONSTRAINT "attempt_time_adjustments_added_seconds_check"
    CHECK ("added_seconds" > 0),
  CONSTRAINT "attempt_time_adjustments_deadline_order_check"
    CHECK ("after_deadline" > "before_deadline"),
  CONSTRAINT "attempt_time_adjustments_deadline_delta_check"
    CHECK ("after_deadline" = "before_deadline" + ("added_seconds" * interval '1 second')),
  CONSTRAINT "attempt_time_adjustments_eligible_seconds_check"
    CHECK ("eligible_seconds" IS NULL OR "eligible_seconds" >= 0),
  CONSTRAINT "attempt_time_adjustments_reason_code_check"
    CHECK (length(btrim("reason_code")) > 0),
  CONSTRAINT "attempt_time_adjustments_source_shape_check"
    CHECK (
      (
        "source" = 'bounded_grace'
        AND "policy" = 'bounded_grace'
        AND "interruption_id" IS NOT NULL
        AND "eligible_seconds" IS NOT NULL
        AND "actor_id" IS NULL
      )
      OR
      (
        "source" IN ('operator', 'administrative_correction')
        AND "actor_id" IS NOT NULL
        AND "reason_text" IS NOT NULL
        AND length(btrim("reason_text")) > 0
      )
      OR "source" = 'system_incident'
    )
);
--> statement-breakpoint
ALTER TABLE "attempt_time_adjustments"
  ADD CONSTRAINT "attempt_time_adjustments_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "attempt_time_adjustments"
  ADD CONSTRAINT "attempt_time_adjustments_attempt_id_exam_attempts_id_fk"
  FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id");
--> statement-breakpoint
ALTER TABLE "attempt_time_adjustments"
  ADD CONSTRAINT "attempt_time_adjustments_actor_id_users_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "attempt_time_adjustments"
  ADD CONSTRAINT "attempt_time_adjustments_org_attempt_fk"
  FOREIGN KEY ("organization_id", "attempt_id")
  REFERENCES "exam_attempts"("organization_id", "id");
--> statement-breakpoint
ALTER TABLE "attempt_time_adjustments"
  ADD CONSTRAINT "attempt_time_adjustments_org_interruption_fk"
  FOREIGN KEY ("organization_id", "attempt_id", "interruption_id")
  REFERENCES "attempt_interruptions"("organization_id", "attempt_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_time_adjustments_org_operation_unique"
  ON "attempt_time_adjustments" ("organization_id", "operation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_time_adjustments_bounded_interruption_unique"
  ON "attempt_time_adjustments" ("interruption_id")
  WHERE "source" = 'bounded_grace';
--> statement-breakpoint
CREATE INDEX "attempt_time_adjustments_org_attempt_created_idx"
  ON "attempt_time_adjustments" ("organization_id", "attempt_id", "created_at");
--> statement-breakpoint
CREATE TABLE "attempt_interruption_events" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "attempt_id" text NOT NULL,
  "interruption_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "observed_last_activity_at" timestamp with time zone,
  "detection_source" text,
  "timeout_seconds" integer,
  "policy" text NOT NULL,
  "eligible_seconds" integer,
  "time_adjustment_id" text,
  "actor_id" text,
  "reason_code" varchar(100) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "attempt_interruption_events_type_check"
    CHECK ("event_type" IN ('detected', 'restored', 'terminalized')),
  CONSTRAINT "attempt_interruption_events_policy_check"
    CHECK ("policy" IN ('strict', 'bounded_grace', 'operator_incident')),
  CONSTRAINT "attempt_interruption_events_reason_code_check"
    CHECK (length(btrim("reason_code")) > 0),
  CONSTRAINT "attempt_interruption_events_eligible_seconds_check"
    CHECK ("eligible_seconds" IS NULL OR "eligible_seconds" >= 0),
  CONSTRAINT "attempt_interruption_events_shape_check"
    CHECK (
      (
        "event_type" = 'detected'
        AND "detection_source" IS NOT NULL
        AND "time_adjustment_id" IS NULL
        AND (
          (
            "detection_source" = 'heartbeat_timeout'
            AND "observed_last_activity_at" IS NOT NULL
            AND "timeout_seconds" IS NOT NULL
            AND "timeout_seconds" > 0
          )
          OR
          (
            "detection_source" = 'migration_backfill'
            AND "timeout_seconds" IS NULL
            AND "reason_code" = 'migration_backfill_unknown_detected_at'
          )
        )
      )
      OR
      (
        "event_type" IN ('restored', 'terminalized')
        AND "detection_source" IS NULL
        AND "timeout_seconds" IS NULL
        AND "observed_last_activity_at" IS NULL
      )
    )
);
--> statement-breakpoint
ALTER TABLE "attempt_interruption_events"
  ADD CONSTRAINT "attempt_interruption_events_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "attempt_interruption_events"
  ADD CONSTRAINT "attempt_interruption_events_attempt_id_exam_attempts_id_fk"
  FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id");
--> statement-breakpoint
ALTER TABLE "attempt_interruption_events"
  ADD CONSTRAINT "attempt_interruption_events_time_adjustment_id_attempt_time_adjustments_id_fk"
  FOREIGN KEY ("time_adjustment_id") REFERENCES "attempt_time_adjustments"("id");
--> statement-breakpoint
ALTER TABLE "attempt_interruption_events"
  ADD CONSTRAINT "attempt_interruption_events_actor_id_users_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "attempt_interruption_events"
  ADD CONSTRAINT "attempt_interruption_events_org_interruption_fk"
  FOREIGN KEY ("organization_id", "attempt_id", "interruption_id")
  REFERENCES "attempt_interruptions"("organization_id", "attempt_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_interruption_events_detected_unique"
  ON "attempt_interruption_events" ("interruption_id")
  WHERE "event_type" = 'detected';
--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_interruption_events_outcome_unique"
  ON "attempt_interruption_events" ("interruption_id")
  WHERE "event_type" IN ('restored', 'terminalized');
--> statement-breakpoint
CREATE INDEX "attempt_interruption_events_org_attempt_created_idx"
  ON "attempt_interruption_events" ("organization_id", "attempt_id", "created_at");
--> statement-breakpoint
-- BEGIN 0021_INTERRUPTION_BACKFILL
CREATE TEMPORARY TABLE "rec_i4_i1_disrupted_mapping" (
  "attempt_id" text PRIMARY KEY,
  "interruption_id" uuid NOT NULL,
  "detected_at" timestamp with time zone NOT NULL
) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO "rec_i4_i1_disrupted_mapping"
  ("attempt_id", "interruption_id", "detected_at")
SELECT "id", gen_random_uuid(), transaction_timestamp()
FROM "exam_attempts"
WHERE "status" = 'disrupted';
--> statement-breakpoint
INSERT INTO "attempt_interruptions"
  ("id", "organization_id", "attempt_id", "created_at")
SELECT
  mapping."interruption_id",
  attempt."organization_id",
  attempt."id",
  mapping."detected_at"
FROM "rec_i4_i1_disrupted_mapping" mapping
JOIN "exam_attempts" attempt ON attempt."id" = mapping."attempt_id";
--> statement-breakpoint
UPDATE "exam_attempts" attempt
SET
  "current_interruption_id" = mapping."interruption_id",
  "interrupted_at" = mapping."detected_at"
FROM "rec_i4_i1_disrupted_mapping" mapping
WHERE attempt."id" = mapping."attempt_id";
--> statement-breakpoint
INSERT INTO "attempt_interruption_events" (
  "id",
  "organization_id",
  "attempt_id",
  "interruption_id",
  "event_type",
  "occurred_at",
  "observed_last_activity_at",
  "detection_source",
  "timeout_seconds",
  "policy",
  "eligible_seconds",
  "time_adjustment_id",
  "actor_id",
  "reason_code",
  "created_at"
)
SELECT
  gen_random_uuid()::text,
  attempt."organization_id",
  attempt."id",
  mapping."interruption_id",
  'detected',
  mapping."detected_at",
  attempt."last_activity_at",
  'migration_backfill',
  NULL,
  'strict',
  NULL,
  NULL,
  NULL,
  'migration_backfill_unknown_detected_at',
  mapping."detected_at"
FROM "rec_i4_i1_disrupted_mapping" mapping
JOIN "exam_attempts" attempt ON attempt."id" = mapping."attempt_id";
-- END 0021_INTERRUPTION_BACKFILL
--> statement-breakpoint
ALTER TABLE "exams"
  ADD CONSTRAINT "exams_interruption_time_policy_check"
  CHECK ("interruption_time_policy" IN ('strict', 'bounded_grace', 'operator_incident')),
  ADD CONSTRAINT "exams_interruption_policy_caps_check"
  CHECK (
    (
      "interruption_time_policy" IN ('strict', 'operator_incident')
      AND "interruption_grace_per_incident_seconds" IS NULL
      AND "interruption_grace_per_attempt_seconds" IS NULL
    )
    OR
    (
      "interruption_time_policy" = 'bounded_grace'
      AND "interruption_grace_per_incident_seconds" IS NOT NULL
      AND "interruption_grace_per_attempt_seconds" IS NOT NULL
      AND "interruption_grace_per_incident_seconds" > 0
      AND "interruption_grace_per_attempt_seconds" > 0
      AND "interruption_grace_per_incident_seconds" <= "interruption_grace_per_attempt_seconds"
    )
  );
--> statement-breakpoint
ALTER TABLE "exam_attempts"
  ADD CONSTRAINT "exam_attempts_interruption_snapshot_version_check"
    CHECK ("interruption_policy_snapshot_version" = 1),
  ADD CONSTRAINT "exam_attempts_interruption_snapshot_policy_check"
    CHECK ("interruption_time_policy_snapshot" IN ('strict', 'bounded_grace', 'operator_incident')),
  ADD CONSTRAINT "exam_attempts_interruption_snapshot_caps_check"
    CHECK (
      (
        "interruption_time_policy_snapshot" IN ('strict', 'operator_incident')
        AND "interruption_grace_per_incident_seconds_snapshot" IS NULL
        AND "interruption_grace_per_attempt_seconds_snapshot" IS NULL
      )
      OR
      (
        "interruption_time_policy_snapshot" = 'bounded_grace'
        AND "interruption_grace_per_incident_seconds_snapshot" IS NOT NULL
        AND "interruption_grace_per_attempt_seconds_snapshot" IS NOT NULL
        AND "interruption_grace_per_incident_seconds_snapshot" > 0
        AND "interruption_grace_per_attempt_seconds_snapshot" > 0
        AND "interruption_grace_per_incident_seconds_snapshot" <= "interruption_grace_per_attempt_seconds_snapshot"
      )
    ),
  ADD CONSTRAINT "exam_attempts_current_interruption_pair_check"
    CHECK (
      ("current_interruption_id" IS NULL AND "interrupted_at" IS NULL)
      OR
      ("current_interruption_id" IS NOT NULL AND "interrupted_at" IS NOT NULL)
    );
--> statement-breakpoint
ALTER TABLE "exam_attempts"
  ADD CONSTRAINT "exam_attempts_current_interruption_fk"
  FOREIGN KEY ("organization_id", "id", "current_interruption_id")
  REFERENCES "attempt_interruptions"("organization_id", "attempt_id", "id");
