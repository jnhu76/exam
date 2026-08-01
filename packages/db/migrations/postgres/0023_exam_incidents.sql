-- REC-I6-I1: Exam Incident Persistence — migration 0023
-- Five additive tables; zero changes to existing tables.
-- Rollback guard: see apps/api/src/scripts/rollback-incident-tables.ts (ADR-014 §14).
--> statement-breakpoint

-- ============================================================
-- 1. exam_incidents — core incident aggregate
-- ============================================================
CREATE TABLE "exam_incidents" (
  "id" uuid PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organizations"("id"),
  "exam_id" text NOT NULL REFERENCES "exams"("id"),
  "attempt_id" text,
  "candidate_id" text REFERENCES "candidate_profiles"("id"),
  "type" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'info',
  "status" text NOT NULL DEFAULT 'open',
  "occurred_at" timestamptz,
  "description" text NOT NULL,
  "resolution_summary" text,
  "resolved_at" timestamptz,
  "resolved_by" text,
  "reported_by" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

-- Constraints for exam_incidents
ALTER TABLE "exam_incidents" ADD CONSTRAINT "exam_incidents_type_check"
  CHECK ("type" IN ('network_interruption','device_failure','power_failure','candidate_unable_to_continue','suspected_misconduct','operator_error','system_outage','environmental_disruption','other'));

ALTER TABLE "exam_incidents" ADD CONSTRAINT "exam_incidents_severity_check"
  CHECK ("severity" IN ('info','minor','major','critical'));

ALTER TABLE "exam_incidents" ADD CONSTRAINT "exam_incidents_status_check"
  CHECK ("status" IN ('open','investigating','resolved','dismissed'));

ALTER TABLE "exam_incidents" ADD CONSTRAINT "exam_incidents_description_check"
  CHECK (length(btrim("description")) BETWEEN 1 AND 1000);

ALTER TABLE "exam_incidents" ADD CONSTRAINT "exam_incidents_resolution_summary_check"
  CHECK ("resolution_summary" IS NULL OR length(btrim("resolution_summary")) BETWEEN 1 AND 1000);

ALTER TABLE "exam_incidents" ADD CONSTRAINT "exam_incidents_version_check"
  CHECK ("version" >= 1);

--> statement-breakpoint

-- Unique constraint for child composite FK target
CREATE UNIQUE INDEX "exam_incidents_org_id_unique" ON "exam_incidents" ("organization_id", "id");

-- Composite FK to exam_attempts when attempt_id is set (reuses exam_attempts_org_id_unique).
-- The index above supports the FK lookup; this constraint enforces that a non-null
-- attempt_id references an existing same-organization attempt. Nullable attempt_id
-- rows skip FK enforcement (MATCH SIMPLE default), so exam-wide incidents insert cleanly.
CREATE INDEX "exam_incidents_org_attempt_idx" ON "exam_incidents" ("organization_id", "attempt_id");

ALTER TABLE "exam_incidents" ADD CONSTRAINT "exam_incidents_org_attempt_fk"
  FOREIGN KEY ("organization_id", "attempt_id") REFERENCES "exam_attempts"("organization_id", "id");

-- Query indexes
CREATE INDEX "exam_incidents_org_exam_status_idx" ON "exam_incidents" ("organization_id", "exam_id", "status");
CREATE INDEX "exam_incidents_active_status_idx" ON "exam_incidents" ("organization_id", "status") WHERE "status" IN ('open', 'investigating');

--> statement-breakpoint

-- ============================================================
-- 2. exam_incident_events — append-only event history
-- ============================================================
CREATE TABLE "exam_incident_events" (
  "id" uuid PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organizations"("id"),
  "incident_id" uuid NOT NULL,
  "event_sequence" bigint GENERATED ALWAYS AS IDENTITY,
  "event_type" text NOT NULL,
  "command_type" text NOT NULL,
  "operation_id" uuid NOT NULL,
  "actor_id" text,
  "before_version" integer NOT NULL,
  "after_version" integer NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

-- Constraints for exam_incident_events
ALTER TABLE "exam_incident_events" ADD CONSTRAINT "exam_incident_events_event_type_check"
  CHECK ("event_type" IN ('incident_created','investigation_started','note_added','severity_changed','incident_resolved','incident_dismissed','action_linked','attempt_linked','interruption_linked'));

ALTER TABLE "exam_incident_events" ADD CONSTRAINT "exam_incident_events_version_check"
  CHECK ("before_version" >= 0 AND "after_version" >= 0);

--> statement-breakpoint

-- operationId idempotency arbiter
CREATE UNIQUE INDEX "exam_incident_events_org_operation_unique"
  ON "exam_incident_events" ("organization_id", "operation_id");

-- Per-incident ordering
CREATE INDEX "exam_incident_events_incident_sequence_idx"
  ON "exam_incident_events" ("incident_id", "event_sequence");

-- Composite FK to exam_incidents
ALTER TABLE "exam_incident_events" ADD CONSTRAINT "exam_incident_events_incident_fk"
  FOREIGN KEY ("organization_id", "incident_id") REFERENCES "exam_incidents"("organization_id", "id");

--> statement-breakpoint

-- ============================================================
-- 3. exam_incident_actions — linked operator actions
-- ============================================================
CREATE TABLE "exam_incident_actions" (
  "id" uuid PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organizations"("id"),
  "incident_id" uuid NOT NULL,
  "action_type" text NOT NULL,
  "action_id" text NOT NULL,
  "attempt_id" text NOT NULL,
  "actor_id" text,
  "linked_at" timestamptz NOT NULL DEFAULT now(),
  "operation_id" uuid NOT NULL
);

--> statement-breakpoint

-- Constraints for exam_incident_actions
ALTER TABLE "exam_incident_actions" ADD CONSTRAINT "exam_incident_actions_action_type_check"
  CHECK ("action_type" IN ('time_grant', 'force_submit'));

-- Action link unique arbiter: one action links to at most one incident
CREATE UNIQUE INDEX "exam_incident_actions_org_action_unique"
  ON "exam_incident_actions" ("organization_id", "action_type", "action_id");

-- operationId idempotency lookup: (organization_id, operation_id) — the
-- tenant predicate is part of the query, so a bare (operation_id) index
-- would not cover it.
CREATE INDEX "exam_incident_actions_org_operation_idx"
  ON "exam_incident_actions" ("organization_id", "operation_id");

-- Per-incident link list
CREATE INDEX "exam_incident_actions_incident_idx"
  ON "exam_incident_actions" ("incident_id");

-- Composite FK to exam_incidents
ALTER TABLE "exam_incident_actions" ADD CONSTRAINT "exam_incident_actions_incident_fk"
  FOREIGN KEY ("organization_id", "incident_id") REFERENCES "exam_incidents"("organization_id", "id");

-- Composite FK to exam_attempts
ALTER TABLE "exam_incident_actions" ADD CONSTRAINT "exam_incident_actions_attempt_fk"
  FOREIGN KEY ("organization_id", "attempt_id") REFERENCES "exam_attempts"("organization_id", "id");

--> statement-breakpoint

-- ============================================================
-- 4. exam_incident_attempts — affected attempt membership
-- ============================================================
CREATE TABLE "exam_incident_attempts" (
  "id" uuid PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organizations"("id"),
  "incident_id" uuid NOT NULL,
  "attempt_id" text NOT NULL,
  "relationship_type" text NOT NULL,
  "linked_at" timestamptz NOT NULL DEFAULT now(),
  "linked_by" text NOT NULL,
  "operation_id" uuid NOT NULL
);

--> statement-breakpoint

-- Constraints for exam_incident_attempts
ALTER TABLE "exam_incident_attempts" ADD CONSTRAINT "exam_incident_attempts_relationship_type_check"
  CHECK ("relationship_type" IN ('affected', 'referenced'));

-- Unique arbiter: one attempt per incident at most once
CREATE UNIQUE INDEX "exam_incident_attempts_incident_attempt_unique"
  ON "exam_incident_attempts" ("incident_id", "attempt_id");

-- operationId idempotency lookup: (organization_id, operation_id) — the
-- tenant predicate is part of the query, so a bare (operation_id) index
-- would not cover it.
CREATE INDEX "exam_incident_attempts_org_operation_idx"
  ON "exam_incident_attempts" ("organization_id", "operation_id");

-- Composite FK to exam_incidents
ALTER TABLE "exam_incident_attempts" ADD CONSTRAINT "exam_incident_attempts_incident_fk"
  FOREIGN KEY ("organization_id", "incident_id") REFERENCES "exam_incidents"("organization_id", "id");

-- Composite FK to exam_attempts
ALTER TABLE "exam_incident_attempts" ADD CONSTRAINT "exam_incident_attempts_attempt_fk"
  FOREIGN KEY ("organization_id", "attempt_id") REFERENCES "exam_attempts"("organization_id", "id");

--> statement-breakpoint

-- ============================================================
-- 5. exam_incident_interruption_links — interruption evidence links
-- ============================================================
CREATE TABLE "exam_incident_interruption_links" (
  "id" uuid PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organizations"("id"),
  "incident_id" uuid NOT NULL,
  "attempt_id" text NOT NULL,
  "interruption_id" uuid NOT NULL,
  "linked_at" timestamptz NOT NULL DEFAULT now(),
  "linked_by" text NOT NULL,
  "operation_id" uuid NOT NULL
);

--> statement-breakpoint

-- Unique arbiter: one interruption per incident at most once
CREATE UNIQUE INDEX "exam_incident_interruption_links_incident_interruption_unique"
  ON "exam_incident_interruption_links" ("incident_id", "interruption_id");

-- operationId idempotency lookup: (organization_id, operation_id) — the
-- tenant predicate is part of the query, so a bare (operation_id) index
-- would not cover it.
CREATE INDEX "exam_incident_interruption_links_org_operation_idx"
  ON "exam_incident_interruption_links" ("organization_id", "operation_id");

-- Composite FK to exam_incidents
ALTER TABLE "exam_incident_interruption_links" ADD CONSTRAINT "exam_incident_interruption_links_incident_fk"
  FOREIGN KEY ("organization_id", "incident_id") REFERENCES "exam_incidents"("organization_id", "id");

-- Composite FK to attempt_interruptions
ALTER TABLE "exam_incident_interruption_links" ADD CONSTRAINT "exam_incident_interruption_links_interruption_fk"
  FOREIGN KEY ("organization_id", "attempt_id", "interruption_id")
  REFERENCES "attempt_interruptions"("organization_id", "attempt_id", "id");

--> statement-breakpoint

-- ============================================================
-- Rollback guard (ADR-014 §14)
-- ============================================================
-- The migration runner is forward-only: there is no automatic down migration.
-- A destructive DROP of these five tables is permitted ONLY before the first
-- non-null attempt_time_adjustments.incident_id write. After activation, a
-- plain DROP would leave dangling correlation UUIDs with no referential guard,
-- so it is prohibited.
--
-- The executable, opt-in, pre-activation guard lives in
-- apps/api/src/scripts/rollback-incident-tables.ts (invoked via
-- `pnpm db:rollback:incidents -- --confirm`). It checks
-- attempt_time_adjustments.incident_id in a single transaction and refuses to
-- DROP anything when any non-null value exists. It is never run by migrate,
-- build, or test. See ADR-014 §14 and packages/db/src/migrations/0023-incident-fk-and-rollback.test.ts.