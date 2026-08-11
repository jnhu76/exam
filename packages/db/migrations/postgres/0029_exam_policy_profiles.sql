-- 0029_exam_policy_profiles.sql
--
-- P7-M2 — organization-owned exam policy profile templates.
--
-- ONE new table, `exam_policy_profiles`: a small, typed, reusable subset of
-- exam-policy defaults that Admin/Teacher may apply while creating an exam
-- (COPY-ON-APPLY — the created exam materializes concrete values into the
-- ordinary `exams` columns and never reads a profile again at runtime).
--
-- Authority model (P7-M2 design §3/§4, binding input P7-M1 §14):
--   profile/template = editable authoring convenience, NOT execution authority
--   published Exam row  = immutable execution authority
-- Runtime (attempt start, answer save, heartbeat, deadline scanner,
-- interruption recovery, grading, result publication, submission) NEVER loads
-- a profile. No Exam column, no Attempt column, no snapshot/version/history
-- table is added — the profile is finished once concrete Exam values are
-- materialized.
--
-- Typed columns instead of a `policy_defaults jsonb` blob (design §9): the
-- small known set stays SQL-visible, migration-readable, type-safe, and easy
-- to audit. Excluded by design (design §5/§6): courseId, openAt/closeAt,
-- passingScore/totalScore, questionIds/questionSnapshot, lifecycle status,
-- title/description, timingMode + questionSelectionMode (fixed Phase-1
-- literals), and ALL control_flags (latent/unenforced — P7-M1 §13).
--
-- Organization ownership (design §10): every row carries organization_id;
-- the (organization_id, name) unique index enforces per-org naming. All repo
-- access is org-scoped and fails closed for foreign organizations.
--
-- This migration is purely additive (design §30): new tables: 1, new Exam
-- columns: 0, new Attempt columns: 0, new profile history tables: 0.
--> statement-breakpoint

CREATE TABLE "exam_policy_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"latest_start_offset_minutes" integer,
	"min_submit_after_start_minutes" integer,
	"retake_policy" text NOT NULL,
	"max_attempts" integer NOT NULL,
	"score_strategy" text NOT NULL,
	"result_publication_mode" text NOT NULL,
	"interruption_time_policy" text DEFAULT 'strict' NOT NULL,
	"interruption_grace_per_incident_seconds" integer,
	"interruption_grace_per_attempt_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_policy_profiles_duration_minutes_positive_check" CHECK ("exam_policy_profiles"."duration_minutes" > 0),
	CONSTRAINT "exam_policy_profiles_latest_start_offset_minutes_check" CHECK ("exam_policy_profiles"."latest_start_offset_minutes" >= 0),
	CONSTRAINT "exam_policy_profiles_min_submit_after_start_minutes_check" CHECK ("exam_policy_profiles"."min_submit_after_start_minutes" >= 0),
	CONSTRAINT "exam_policy_profiles_retake_policy_check" CHECK ("exam_policy_profiles"."retake_policy" IN ('unlimited', 'max_attempts', 'pass_then_stop')),
	CONSTRAINT "exam_policy_profiles_score_strategy_check" CHECK ("exam_policy_profiles"."score_strategy" IN ('highest', 'latest', 'first')),
	CONSTRAINT "exam_policy_profiles_interruption_time_policy_check" CHECK ("exam_policy_profiles"."interruption_time_policy" IN ('strict', 'bounded_grace', 'operator_incident')),
	CONSTRAINT "exam_policy_profiles_interruption_policy_caps_check" CHECK (
        (
          "exam_policy_profiles"."interruption_time_policy" IN ('strict', 'operator_incident')
          AND "exam_policy_profiles"."interruption_grace_per_incident_seconds" IS NULL
          AND "exam_policy_profiles"."interruption_grace_per_attempt_seconds" IS NULL
        )
        OR
        (
          "exam_policy_profiles"."interruption_time_policy" = 'bounded_grace'
          AND "exam_policy_profiles"."interruption_grace_per_incident_seconds" IS NOT NULL
          AND "exam_policy_profiles"."interruption_grace_per_attempt_seconds" IS NOT NULL
          AND "exam_policy_profiles"."interruption_grace_per_incident_seconds" > 0
          AND "exam_policy_profiles"."interruption_grace_per_attempt_seconds" > 0
          AND "exam_policy_profiles"."interruption_grace_per_incident_seconds" <= "exam_policy_profiles"."interruption_grace_per_attempt_seconds"
        )
      )
);
--> statement-breakpoint

-- Per-organization profile identity (design §11): unique (organization_id,
-- name). Duplicate names within one org are rejected at this constraint;
-- the API maps the 23505 violation to a stable 409.
CREATE UNIQUE INDEX "exam_policy_profiles_org_name_unique" ON "exam_policy_profiles" USING btree ("organization_id","name");--> statement-breakpoint

-- Organization membership FK (plain, mirrors the exams-table pattern).
ALTER TABLE "exam_policy_profiles" ADD CONSTRAINT "exam_policy_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
