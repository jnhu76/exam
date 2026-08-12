-- P7-E2A (ADR-017 D2): add the Maintainer built-in role to the
-- user_role_assignments CHECK constraint (seventh assignable human role).
-- Hand-simplified from the drizzle-kit generate output: the generated diff
-- also contained constraint-rename noise from a stale meta snapshot (the
-- proctor-assignment FK renames and index/table statements describe state the
-- database already has since migrations 0022–0029); only the CHECK change is
-- shipped here. The 0030 snapshot still records the full post-state, so a
-- future `db:generate` diffs cleanly.
ALTER TABLE "user_role_assignments" DROP CONSTRAINT "user_role_assignments_role_check";--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_check" CHECK ("user_role_assignments"."role" IN ('Admin', 'Teacher', 'Proctor', 'Grader', 'Candidate', 'Maintainer'));
