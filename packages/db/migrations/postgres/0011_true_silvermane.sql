CREATE TABLE "user_role_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_assignments_role_check" CHECK ("user_role_assignments"."role" IN ('Admin', 'Teacher', 'Proctor', 'Grader', 'Candidate'))
);
--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_role_assignments_org_user_role_unique" ON "user_role_assignments" USING btree ("organization_id","user_id","role");--> statement-breakpoint
-- RBAC-M7 backfill: mirror every existing user into a primary active
-- assignment so users.role and the new table agree after migration. Runs once
-- (migrations are single-applied). gen_random_uuid() is core (PG13+, no ext).
--
-- The WHERE guard skips users whose users.role is outside the assignable set
-- (SuperAdmin, System, ContentManager, ResultViewer). The users.role column has
-- no CHECK constraint (it is plain text), so it can hold non-assignable values
-- used by tests and legacy data as non-login / non-authority sentinels.
-- Backfilling such a row with its own role would violate
-- user_role_assignments_role_check, abort the migration's transaction, and
-- leave the DB permanently stuck (Drizzle wraps all pending migrations in one
-- transaction; a failed migration is never recorded as applied and is retried
-- every run). Non-assignable users are deliberately skipped: they have no valid
-- role to assign, and the runtime resolver already fail-closes on any user
-- without an active primary assignment, so skipping them preserves the
-- security invariant instead of weakening it.
-- BEGIN 0011_BACKFILL_ASSIGNMENTS
INSERT INTO "user_role_assignments" ("id", "organization_id", "user_id", "role", "is_primary", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "organization_id", "id", "role", true, "is_active", now(), now()
FROM "users"
WHERE "role" IN ('Admin', 'Teacher', 'Proctor', 'Grader', 'Candidate');
-- END 0011_BACKFILL_ASSIGNMENTS
