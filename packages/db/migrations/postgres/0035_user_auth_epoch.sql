-- #325 (S1): durable per-user auth epoch — revocable JWT credential authority.
--
-- users.auth_epoch is the current valid credential generation for that user.
-- JWTs carry an `authEpoch` claim; authentication accepts a token only when
-- the claim equals the persisted epoch. Logout and password
-- changes/resets advance the epoch, instantly invalidating every JWT issued
-- under the previous generation (all-tab / all-device semantics for v0.x).
--
-- One bounded scalar per user replaces any session/blacklist table: state is
-- durable in the existing users row, so revocation survives restart by
-- construction. Existing rows start at epoch 0, matching every JWT issued
-- before this column existed... but those legacy JWTs lack the `authEpoch`
-- claim entirely and fail closed at verify time (upgrading to the revocation
-- contract outranks preserving up to 24h of unverifiable credentials);
-- affected users simply sign in again once.

ALTER TABLE "users" ADD COLUMN "auth_epoch" integer DEFAULT 0 NOT NULL;
