-- J5-I1A1 Recovery Queue: org-wide keyset ordering `(created_at DESC, id DESC)`.
-- The default page and the cursor page both scan this index (B-tree backward
-- scan); without it the org-wide queue would degrade to org-range scan + sort
-- as incident volume grows.
CREATE INDEX "exam_incidents_org_created_at_id_idx" ON "exam_incidents" USING btree ("organization_id","created_at","id");
