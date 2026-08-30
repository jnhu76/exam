-- 0038 — Identity lifecycle tokens (#297): staff invitations + password reset tokens.
--
-- staff_invitations: pending-membership facts. The invited person has NO user
-- row until acceptance succeeds; this table is the pending state. One OPEN
-- invitation per (organization, email); re-invite supersedes (revokes) the
-- open row in the same transaction as the new insert. token_hash is the hex
-- SHA-256 of the raw token; the raw token exists only in the email body.
CREATE TABLE "staff_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invitations_email_normalized_check" CHECK ("staff_invitations"."email" = lower("staff_invitations"."email")),
	CONSTRAINT "staff_invitations_role_check" CHECK ("staff_invitations"."role" IN ('Admin', 'Teacher', 'Proctor', 'Grader', 'Maintainer')),
	CONSTRAINT "staff_invitations_token_hash_shape_check" CHECK (char_length("staff_invitations"."token_hash") = 64),
	CONSTRAINT "staff_invitations_consumed_not_revoked_check" CHECK (NOT ("staff_invitations"."consumed_at" IS NOT NULL AND "staff_invitations"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_token_hash_unique" ON "staff_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_org_email_open_unique" ON "staff_invitations" USING btree ("organization_id","email") WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "staff_invitations_org_created_at_idx" ON "staff_invitations" USING btree ("organization_id","created_at","id");--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- password_reset_tokens: single-use, expiring email-reset tokens for an
-- EXISTING user. At most one unconsumed token per user (partial unique
-- index); issuing consumes the previous open token in the same transaction
-- (newest-token-wins). Consumption requires the user to still be active.
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_shape_check" CHECK (char_length("password_reset_tokens"."token_hash") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_user_open_unique" ON "password_reset_tokens" USING btree ("user_id") WHERE "consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_created_at_idx" ON "password_reset_tokens" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
