-- F-004: Add defensive indexes for common admin query patterns.
-- audit_logs listing is filtered by organization and ordered by created_at;
-- questions listing is filtered by organization + course.
-- Both previously triggered sequential scans at scale.

CREATE INDEX IF NOT EXISTS "audit_logs_org_created_at_idx"
  ON "audit_logs" ("organization_id", "created_at");

CREATE INDEX IF NOT EXISTS "questions_org_course_idx"
  ON "questions" ("organization_id", "course_id");
