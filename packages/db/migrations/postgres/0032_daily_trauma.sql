CREATE TABLE "backup_operational_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"desired_rpo_seconds" integer NOT NULL,
	"desired_retention_days" integer NOT NULL,
	"desired_drill_cadence_days" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_operational_policy_rpo_check" CHECK ("backup_operational_policy"."desired_rpo_seconds" BETWEEN 300 AND 604800),
	CONSTRAINT "backup_operational_policy_retention_check" CHECK ("backup_operational_policy"."desired_retention_days" BETWEEN 1 AND 3650),
	CONSTRAINT "backup_operational_policy_cadence_check" CHECK ("backup_operational_policy"."desired_drill_cadence_days" BETWEEN 1 AND 365)
);
--> statement-breakpoint
ALTER TABLE "backup_operational_policy" ADD CONSTRAINT "backup_operational_policy_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_operational_policy_org_unique" ON "backup_operational_policy" USING btree ("organization_id");