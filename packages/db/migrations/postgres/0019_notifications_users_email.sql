-- P5-N1: notification inbox foundation + optional users.email recipient source.
--
-- Adds:
--   1. users.email — optional, nullable, normalized notification recipient
--      email. NOT for login, NOT unique, NOT verified (P5-N1-R0 §13). Blank
--      input maps to NULL at the contract layer.
--   2. notifications — the first-class PostgreSQL Inbox (P5-N1-R0 §12.1).
--      10-column minimal table; organization + recipient scoped; stable
--      created_at DESC + id DESC ordering; unread index on read_at; dedupe
--      via a partial UNIQUE on (org, recipient, dedupe_key).
--
-- This migration is owned by P5-N1-I1. email_outbox.notification_id /
-- recipient_user_id linkage is a separate concern (P5-N1-I2) and is NOT
-- added here.

-- 1. users.email (optional recipient source)
ALTER TABLE "users" ADD COLUMN "email" text;
--> statement-breakpoint

-- 2. notifications table
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"action_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"dedupe_key" text
);
--> statement-breakpoint

-- 3. FKs: organization + recipient user
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- 4. Stable list order: organization + recipient + created_at DESC + id DESC
CREATE INDEX "notifications_org_recipient_created_at_id_idx"
  ON "notifications" ("organization_id", "recipient_user_id", "created_at", "id");
--> statement-breakpoint

-- 5. Unread count: organization + recipient + read_at (null = unread)
CREATE INDEX "notifications_org_recipient_read_at_idx"
  ON "notifications" ("organization_id", "recipient_user_id", "read_at");
--> statement-breakpoint

-- 6. Dedupe: partial UNIQUE on (org, recipient, dedupe_key) where key is set
CREATE UNIQUE INDEX "notifications_org_recipient_dedupe_key_unique"
  ON "notifications" ("organization_id", "recipient_user_id", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;
