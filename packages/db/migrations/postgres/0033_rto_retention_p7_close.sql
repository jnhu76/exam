-- P7-CLOSE: Add typed RTO objective and host-side retention evidence.
-- desired_rto_seconds: nullable (legacy rows have no RTO); CHECK enforced
-- when non-null. RTO is an Admin-owned reliability objective, not infra config.

ALTER TABLE "backup_operational_policy"
  ADD COLUMN "desired_rto_seconds" integer;

-- Safe-range CHECK for RTO when non-null: 30 seconds .. 48 hours.
-- NULL is allowed (NOT_CONFIGURED) — no silent RTO promise for legacy rows.
ALTER TABLE "backup_operational_policy"
  ADD CONSTRAINT "backup_operational_policy_rto_check"
  CHECK ("desired_rto_seconds" IS NULL OR ("desired_rto_seconds" BETWEEN 30 AND 172800));

-- Host-side retention evidence (P7-CLOSE P7-3b). Records automated
-- retention/expire operations executed by the Host Operator outside Exam RBAC.
-- This is EVIDENCE only — Exam never performs retention.
CREATE TABLE "retention_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "operation_id" text NOT NULL,
  "tool" text NOT NULL,
  "result" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "pruned_backups" integer,
  "pruned_wal_archives" integer,
  "retention_objective" text,
  "verification_status" text,
  "verification_detail" text,
  "failure_reason" text,
  "executor_type" text NOT NULL DEFAULT 'host_script',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "retention_runs_result_check" CHECK ("retention_runs"."result" IN ('succeeded', 'failed')),
  CONSTRAINT "retention_runs_verification_check" CHECK ("retention_runs"."verification_status" IS NULL OR ("retention_runs"."verification_status" IN ('verified', 'failed', 'pending')))
);

ALTER TABLE "retention_runs"
  ADD CONSTRAINT "retention_runs_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX "retention_runs_org_operation_unique"
  ON "retention_runs" USING btree ("organization_id", "operation_id");
