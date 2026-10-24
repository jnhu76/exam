-- 0045_drop_backup_evidence_tables.sql
--
-- ADR-023 (REMOVE disposition, owner gate on #739): Exam no longer owns
-- backup-evidence persistence. This forward-only migration drops the five
-- backup-evidence tables that applied history 0031–0034 created:
--   backup_runs, backup_run_events, restore_drill_runs, retention_runs,
--   backup_operational_policy.
--
-- Migrations 0031_secret_annihilus, 0032_daily_trauma,
-- 0033_rto_retention_p7_close and 0034_retention_success_verified_invariant
-- are applied history and stay untouched (ADR-023 migration strategy); this
-- file is their forward convergence, not their rewrite.
--
-- Evidence-preservation gate (ADR-023): before any destructive statement, the
-- DO block below aborts the migration when any of the five tables still holds
-- rows. The whole migration runs inside the migrator's single transaction, so
-- a gate failure rolls everything back and records no journal entry — the
-- deployment keeps every table and every row. Deployment operators must
-- record the evidence-disposal disposition per ADR-023 (project-owner-owned
-- PR-C blocking obligation) and re-run; repo-owned test databases resolve
-- residue through the repo reset path (truncate). Do not weaken or bypass
-- this gate: it is the last defense against silently destroying historical
-- backup evidence.
--> statement-breakpoint

DO $$
DECLARE
  occupied text[] := ARRAY[]::text[];
BEGIN
  -- '::text' is REQUIRED: an untyped literal on `||` resolves to the
  -- anyarray||anyarray (array_cat) overload, which parses the literal as an
  -- ARRAY literal and fails with 22P02 malformed-array — crashing the gate
  -- exactly in the non-empty case it exists for, before its own RAISE.
  IF EXISTS (SELECT 1 FROM "backup_runs") THEN
    occupied := occupied || 'backup_runs'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM "backup_run_events") THEN
    occupied := occupied || 'backup_run_events'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM "restore_drill_runs") THEN
    occupied := occupied || 'restore_drill_runs'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM "retention_runs") THEN
    occupied := occupied || 'retention_runs'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM "backup_operational_policy") THEN
    occupied := occupied || 'backup_operational_policy'::text;
  END IF;
  IF array_length(occupied, 1) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'ADR-023 evidence-preservation gate: backup-evidence table(s) not empty: '
        || array_to_string(occupied, ', '),
      DETAIL = 'Migration 0045 aborted BEFORE any DROP; no data was lost and no journal entry was recorded.',
      HINT = 'Deployments: record the evidence-disposal disposition per ADR-023 (issue #739), then re-run. Test databases: clear residue via the repo test-reset path (truncate). Do not edit or bypass this gate.',
      ERRCODE = 'P0001';
  END IF;
END
$$;
--> statement-breakpoint

-- Child first: backup_run_events holds the only intra-group foreign key
-- (backup_run_events_run_id_backup_runs_id_fk -> backup_runs.id, ON DELETE
-- cascade, 0031). Dropping the parent first would fail; explicit child-first
-- order keeps the DROP set exact.
DROP TABLE "backup_run_events";
--> statement-breakpoint

-- The remaining four tables reference only organizations (no action); they
-- are mutually independent and dropped in subsystem-delivery order. Plain
-- DROP (no CASCADE, no IF EXISTS): an unmapped dependent or missing table
-- must fail loudly instead of silently narrowing the deletion boundary.
DROP TABLE "backup_runs";
--> statement-breakpoint

DROP TABLE "restore_drill_runs";
--> statement-breakpoint

DROP TABLE "retention_runs";
--> statement-breakpoint

DROP TABLE "backup_operational_policy";
