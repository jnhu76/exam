-- P5-N1-I2: link operational Email outbox rows to their Inbox notification.
--
-- Adds two nullable columns to email_outbox:
--   1. notification_id   — nullable FK -> notifications.id. Set on operational
--      Emails (result_published -> grade_notification) so an Email can be
--      traced back to the Inbox notification that triggered it. Identity-flow
--      Emails (registration_welcome etc.) keep this null.
--   2. recipient_user_id — nullable FK -> users.id. Lets a future recipient-
--      scoped query join without resolving through the notification. Nullable
--      for identity-flow Emails with no user binding.
--
-- Both columns are nullable and additive — existing rows (P5-0 test/dev
-- fixtures, identity-flow Emails) remain valid with NULL values.

ALTER TABLE "email_outbox" ADD COLUMN "notification_id" text;
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "recipient_user_id" text;
--> statement-breakpoint

ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_notification_id_notifications_id_fk"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_recipient_user_id_users_id_fk"
  FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id")
  ON DELETE no action ON UPDATE no action;
