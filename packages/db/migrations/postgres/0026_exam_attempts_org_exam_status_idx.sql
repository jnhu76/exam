-- J5-I1B4 Recovery Exam aggregate: attempt status distribution `GROUP BY status`
-- over `(organization_id, exam_id, status)`. Without this index the
-- distribution read would degrade to an org+exam range scan + aggregate as
-- attempt volume grows (contract §6.5). Additive index; no column edits,
-- no data backfill.
CREATE INDEX "exam_attempts_org_exam_status_idx" ON "exam_attempts" USING btree ("organization_id","exam_id","status");
