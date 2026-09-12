-- 0042 — Durable exam admission runtime (#292): exam_admissions.
--
-- Replaces the legacy process-local admission gate (in-memory examQueues
-- map) with PostgreSQL-backed membership truth. Lifecycle facts are
-- timestamps only (joined_at / admitted_at / consumed_at); there is no
-- status enum to drift. One ACTIVE membership per (organization, exam,
-- candidate) is enforced by the partial unique index; consumed rows are
-- history and a retake re-join inserts a fresh row.
--
-- QUEUE ADMISSION IS NOT TIME AUTHORITY: joined_at is an ordering key and
-- the durable batch anchor (earliest joined_at across all memberships,
-- including consumed history rows); nothing here derives or alters exam/attempt
-- timing.
--
-- No backfill: the legacy process-local queue state was ephemeral and
-- cannot be migrated (LEGACY_RUNTIME_MIGRATION=discard-and-rejoin).
-- Candidates with in_progress attempts are unaffected — resume/restore
-- never consults admission.
CREATE TABLE "exam_admissions" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL,
  "exam_id" text NOT NULL,
  "candidate_id" text NOT NULL,
  "joined_at" timestamp with time zone NOT NULL,
  "admitted_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  "consumed_attempt_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "exam_admissions" ADD CONSTRAINT "exam_admissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
ALTER TABLE "exam_admissions" ADD CONSTRAINT "exam_admissions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "exams"("id");
ALTER TABLE "exam_admissions" ADD CONSTRAINT "exam_admissions_candidate_id_candidate_profiles_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "candidate_profiles"("id");
ALTER TABLE "exam_admissions" ADD CONSTRAINT "exam_admissions_org_attempt_fk" FOREIGN KEY ("organization_id", "consumed_attempt_id") REFERENCES "exam_attempts"("organization_id", "id");
CREATE UNIQUE INDEX "exam_admissions_org_exam_candidate_active_unique" ON "exam_admissions" USING btree ("organization_id", "exam_id", "candidate_id") WHERE consumed_at IS NULL;
CREATE INDEX "exam_admissions_org_exam_joined_idx" ON "exam_admissions" USING btree ("organization_id", "exam_id", "joined_at", "id") WHERE consumed_at IS NULL;
CREATE INDEX "exam_admissions_org_exam_created_idx" ON "exam_admissions" USING btree ("organization_id", "exam_id", "joined_at", "id");
ALTER TABLE "exam_admissions" ADD CONSTRAINT "exam_admissions_consumed_pair_check" CHECK (("consumed_at" IS NULL AND "consumed_attempt_id" IS NULL) OR ("consumed_at" IS NOT NULL AND "consumed_attempt_id" IS NOT NULL));
ALTER TABLE "exam_admissions" ADD CONSTRAINT "exam_admissions_admitted_before_consumed_check" CHECK ("consumed_at" IS NULL OR "admitted_at" IS NOT NULL);
