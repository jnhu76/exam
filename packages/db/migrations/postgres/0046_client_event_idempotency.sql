-- 0046_client_event_idempotency.sql
--
-- #863 (A1-F6 ≡ A2-F6) — client_events upload idempotency.
--
-- The web buffer resends a whole batch when the POST /client-events response
-- is lost (ACK lost) or when any planned sub-request fails, so a batch that
-- already committed was ingested again — duplicate rows in low-trust
-- telemetry, skewing counts and investigations. Every layer was append-only:
-- the wire schema had no client key, the repo was a pure INSERT, and the
-- table had no unique constraint.
--
-- This migration adds the client-generated `event_id` key and enforces
-- one-row-per-(organization_id, user_id, event_id). The authenticated user
-- boundary is part of the key BY MANDATE (#863 reconciliation note): an
-- eventId-only unique index could collide or merge events across users.
-- Legacy rows and legacy clients (event_id NULL) stay outside the
-- constraint — PostgreSQL unique indexes treat NULLs as distinct, so
-- append-only behavior is preserved verbatim for senders without the field.
--
-- Dedup window = row existence = the existing 30-day retention horizon
-- (clientEventRetention). There is deliberately no second dedup ledger: the
-- row IS the single fact, and after retention deletes it a resend inserts
-- fresh.

ALTER TABLE "client_events" ADD COLUMN "event_id" text;
CREATE UNIQUE INDEX "client_events_org_user_event_id_uidx"
  ON "client_events" ("organization_id", "user_id", "event_id");
