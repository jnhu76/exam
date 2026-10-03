-- 0044_answer_save_receipts.sql
--
-- #669 Phase D2 — SaveAnswer replay-receipt mechanism repair (PC-F06 / #673 C5).
--
-- Phase C proved the replay SEMANTICS correct and the MECHANISM expensive:
-- every accepted save rewrote the whole `exam_attempts.answers` JSONB, whose
-- per-question elements embed the full idempotency history (clientSeq /
-- clientSeqHistory) with a FULL ANSWER PAYLOAD COPY per accepted clientSeq —
-- O(N) duplicated payload bytes rewritten on every save, growing linearly
-- with the number of accepted saves.
--
-- This migration moves replay state into the append-only table
-- `exam_answer_save_receipts`: one compact immutable row per accepted
-- (organization, attempt, question, clientSeq) replay key. New receipts carry
-- a sha256 identity digest of the D1-accepted canonical answer instead of the
-- payload. Adding receipt N+1 no longer rewrites any prior state.
--
-- FROZEN GUARANTEE PRESERVED (#669 D2-A/D2-G): deployment must not cause
-- previously accepted clientSeq values on still-mutable Attempts to become
-- unknown. The backfill below copies EVERY legacy JSONB receipt (inline
-- clientSeq + clientSeqHistory entries) into the new table before the legacy
-- fields are stripped, in the same transaction, so no accepted replay key is
-- forgotten. Replay identity for backfilled rows is NOT hashed here: SQL
-- cannot reproduce the JS canonical serialization, so backfilled rows carry
-- the legacy payload in `legacy_answer` and derive identity at read time with
-- the same JS authority (bounded compatibility source — it never grows
-- post-deployment). Exactly one representation is present per row (CHECK).
--
-- Terminal attempts are backfilled too: uniformity beats status filtering,
-- receipts past terminal state are inert (§10 of the D2 contract allows
-- retaining them), and the composite FK cascade removes them with the
-- attempt.
--
-- Purely additive to the schema except for the one-time answers JSONB strip:
-- `clientSeq` / `clientSeqHistory` were write-format details of the save
-- protocol, never read by any other consumer, and never serialized to the
-- wire (the attempt response serializer picks the four AnswerRecord fields
-- explicitly).
--> statement-breakpoint

CREATE TABLE "exam_answer_save_receipts" (
  "organization_id" text NOT NULL,
  "attempt_id" text NOT NULL,
  "question_id" text NOT NULL,
  "client_seq" integer NOT NULL,
  "answer_identity" text,
  "legacy_answer" jsonb,
  "accepted_version" integer NOT NULL,
  "saved_at" timestamptz NOT NULL,
  CONSTRAINT "exam_answer_save_receipts_pk" PRIMARY KEY ("organization_id", "attempt_id", "question_id", "client_seq"),
  CONSTRAINT "exam_answer_save_receipts_client_seq_check" CHECK ("exam_answer_save_receipts"."client_seq" >= 0),
  CONSTRAINT "exam_answer_save_receipts_identity_repr_check" CHECK (
    ("exam_answer_save_receipts"."answer_identity" IS NOT NULL AND "exam_answer_save_receipts"."legacy_answer" IS NULL)
    OR ("exam_answer_save_receipts"."answer_identity" IS NULL AND "exam_answer_save_receipts"."legacy_answer" IS NOT NULL)
  )
);
--> statement-breakpoint

-- Receipts are protocol metadata of their attempt, not independent evidence:
-- they follow the attempt row's lifetime (cascade on delete), unlike
-- attempt_command_receipts which are audit-grade (no action). Reuses the
-- exam_attempts_org_id_unique composite key, same pattern as 0023/0024/0028.
ALTER TABLE "exam_answer_save_receipts" ADD CONSTRAINT "exam_answer_save_receipts_org_attempt_fk"
  FOREIGN KEY ("organization_id", "attempt_id") REFERENCES "exam_attempts"("organization_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Backfill: one row per accepted replay key from the legacy JSONB receipts.
-- Arm 1 — the inline `clientSeq` receipt on each answered element.
-- Arm 2 — each `clientSeqHistory` entry (jsonb_array_elements over a missing
-- or empty array yields zero rows). A PK violation here means a corrupt row
-- carried the same replay key twice — fail the migration (fail closed)
-- rather than silently picking a winner.
INSERT INTO "exam_answer_save_receipts"
  ("organization_id", "attempt_id", "question_id", "client_seq", "answer_identity", "legacy_answer", "accepted_version", "saved_at")
SELECT
  a."organization_id",
  a."id",
  elt->>'questionId',
  (elt->>'clientSeq')::integer,
  NULL,
  elt->'answer',
  (elt->>'version')::integer,
  (elt->>'savedAt')::timestamptz
FROM "exam_attempts" a
CROSS JOIN LATERAL jsonb_array_elements(a."answers") elt
WHERE elt ? 'clientSeq'
UNION ALL
SELECT
  a."organization_id",
  a."id",
  elt->>'questionId',
  (r->>'clientSeq')::integer,
  NULL,
  r->'answer',
  (r->>'version')::integer,
  (r->>'savedAt')::timestamptz
FROM "exam_attempts" a
CROSS JOIN LATERAL jsonb_array_elements(a."answers") elt
CROSS JOIN LATERAL jsonb_array_elements(elt->'clientSeqHistory') r;
--> statement-breakpoint

-- Strip the legacy receipt fields from the draft-answer JSONB so the table
-- converges on a single replay authority (the receipts table). Only rows that
-- actually carry receipt fields are rewritten. Element order is preserved.
-- `updated_at` is deliberately not bumped: this is a storage-format
-- migration, not a business mutation.
UPDATE "exam_attempts" a
SET "answers" = (
  SELECT coalesce(
    jsonb_agg(elt - 'clientSeq' - 'clientSeqHistory' ORDER BY ord),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(a."answers") WITH ORDINALITY AS t(elt, ord)
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(a."answers") elt
  WHERE elt ? 'clientSeq' OR elt ? 'clientSeqHistory'
);
