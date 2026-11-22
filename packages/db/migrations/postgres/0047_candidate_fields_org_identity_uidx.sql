-- 0047_candidate_fields_org_identity_uidx.sql
--
-- #1066 (WP-02 / R-RT3-2) — candidate identity field at-most-one invariant.
--
-- SPEC.md §2.3: each organization configures its own candidate identity
-- fields with exactly one unique identifier field. Until now that invariant
-- existed only as check-then-act API prechecks and a race-prone DELETE
-- count-guard: concurrent writes could leave an organization with zero or
-- two unique identity fields, breaking candidate creation and import
-- (provisioning DoS) and silently duplicating identity values.
--
-- This migration makes "at most one unique identity field per organization"
-- a database invariant via a partial unique index over `unique` rows. The
-- code-level guards (PATCH/DELETE rejection plus the candidate-identity
-- advisory lock shared with candidate creation) ship in the same release;
-- the index is the fail-closed backstop for any write path that bypasses
-- the lock.
--
-- Deployment: ship index and #1066 code in ONE release. Against pre-fix
-- code alone the index is behavior-compatible except that a concurrent
-- unique:true race surfaces as an uncaught 23505 (fail-closed 500) instead
-- of silent corruption. Against new code without the index the at-most-one
-- rule degrades to the lock alone.
--
-- Pre-flight audit (fail-closed, non-destructive): if any organization
-- already carries two or more unique:true fields, the audit below RAISEs
-- and the migration aborts before any DDL — the deployment stops with the
-- offending organization ids, no data is modified. Remediation (keep one
-- identity field per organization) is a deliberate operator decision, after
-- which the migration re-runs cleanly.
--
-- Rollback: DROP INDEX "candidate_fields_org_identity_uidx"; — the index
-- carries no data and constrains only future writes, so dropping it is
-- reversible and non-destructive.
--
-- No CREATE INDEX CONCURRENTLY: the migration runner applies each migration
-- inside a transaction. candidate_fields is a small per-organization
-- configuration table, so the direct build's lock window is negligible.

DO $$
DECLARE
    offending_orgs text;
BEGIN
    SELECT string_agg(organization_id::text, ', ')
    INTO offending_orgs
    FROM (
        SELECT organization_id
        FROM candidate_fields
        WHERE "unique" = true
        GROUP BY organization_id
        HAVING count(*) > 1
    ) offenders;
    IF offending_orgs IS NOT NULL THEN
        RAISE EXCEPTION
            'candidate identity field audit failed: organizations with more than one unique identity field: %',
            offending_orgs;
    END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_fields_org_identity_uidx"
  ON "candidate_fields" ("organization_id") WHERE "unique" = true;
