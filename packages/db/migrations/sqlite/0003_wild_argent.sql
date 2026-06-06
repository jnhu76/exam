CREATE UNIQUE INDEX `candidate_fields_org_name_unique` ON `candidate_fields` (`organization_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_profiles_org_user_unique` ON `candidate_profiles` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `exam_attempts_org_enrollment_attempt_unique` ON `exam_attempts` (`organization_id`,`enrollment_id`,`attempt_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `exam_enrollments_org_exam_candidate_unique` ON `exam_enrollments` (`organization_id`,`exam_id`,`candidate_id`);