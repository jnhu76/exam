-- 0039 — Question rich content slots (#301, B′ additive projection model).
--
-- questions.content_document: authoritative ContentDocumentV1 for Rich
-- questions. NULL → Plain (`content` is the authority); non-null → Rich
-- (`content` is the server-derived plain-text projection of the document).
-- Nullable by design: historical rows are Plain without backfill.
--
-- questions.answer_mode: author-defined answer input mode, only meaningful
-- for text_response. NULL → plain (legacy + default). The CHECK guards the
-- stored value and is intentionally null-safe so the plain default needs no
-- backfill.
ALTER TABLE "questions" ADD COLUMN "content_document" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "answer_mode" text;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_answer_mode_check" CHECK ("questions"."answer_mode" in ('plain', 'rich'));
